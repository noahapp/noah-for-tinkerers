#!/usr/bin/env node
// Mirror the stable installer assets from the latest GitHub release into the
// Cloudflare R2 bucket that onnoah.app/download/X streams from.
//
// Why this exists separately from release.mjs: the Mac release runs locally
// and only has the .dmg on disk, so release.mjs mirrors that one inline. The
// Windows/Linux installers are built by GitHub Actions and land on the release
// ~10 min later — run this once that CI is green to push them to R2 (it also
// re-pushes the Mac .dmg, idempotently). Safe to run anytime.
//
// Usage:  node scripts/r2-sync.mjs [tag]      (default: latest release)
// Requires: gh (authenticated) and wrangler (authenticated to the CF account
// owning the noah-downloads bucket).

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BUCKET = "noah-downloads";
const REPO = "xuy/noah";

// Stable asset name → R2 content-type.
const ASSETS = {
  "Noah.dmg": "application/x-apple-diskimage",
  "Noah.msi": "application/octet-stream",
  "Noah-setup.exe": "application/octet-stream",
  "Noah.AppImage": "application/octet-stream",
};

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

async function main() {
  const tag = process.argv[2] || null; // null → latest
  const dir = await mkdtemp(path.join(tmpdir(), "noah-r2-"));
  console.log(`==> Mirroring ${tag ?? "latest"} release assets → R2 (${BUCKET})`);

  let synced = 0;
  for (const [name, contentType] of Object.entries(ASSETS)) {
    const dest = path.join(dir, name);
    try {
      const dlArgs = ["release", "download", ...(tag ? [tag] : []), "--repo", REPO,
        "--pattern", name, "--output", dest, "--clobber"];
      await run("gh", dlArgs);
    } catch {
      console.log(`    skip ${name} — not on the release yet`);
      continue;
    }
    if (!existsSync(dest)) {
      console.log(`    skip ${name} — download produced no file`);
      continue;
    }
    await run("npx", [
      "wrangler", "r2", "object", "put", `${BUCKET}/${name}`,
      `--file=${dest}`, `--content-type=${contentType}`, "--remote",
    ]);
    console.log(`    R2: ${name} ✓`);
    synced++;
  }

  await rm(dir, { recursive: true, force: true });
  console.log(`==> Done — ${synced}/${Object.keys(ASSETS).length} assets mirrored to R2.`);
}

main().catch((e) => {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
});
