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
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BUCKET = "noah-downloads";
const REPO = process.env.NOAH_RELEASE_REPO ?? "xuy/noah";
const CHANNEL = process.env.NOAH_UPDATE_CHANNEL ?? "byok";
const LATEST_JSON_ASSET = `${CHANNEL}-latest.json`;
const MIRROR_STABLE_INSTALLERS = process.env.NOAH_MIRROR_STABLE_INSTALLERS === "1";

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

function runCapture(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { ...opts });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(stderr || `${command} exited ${code}`)),
    );
  });
}

function contentTypeFor(name) {
  if (name.endsWith(".json")) return "application/json; charset=utf-8";
  return ASSETS[name] ?? "application/octet-stream";
}

async function main() {
  const tag =
    process.argv[2] ||
    (await runCapture("gh", [
      "release", "view", "--repo", REPO, "--json", "tagName", "-q", ".tagName",
    ])).trim();
  const dir = await mkdtemp(path.join(tmpdir(), "noah-r2-"));
  console.log(`==> Mirroring ${REPO} ${tag} → R2 (${BUCKET}/${CHANNEL})`);

  let synced = 0;

  await run("gh", ["release", "download", tag, "--repo", REPO, "-D", dir, "--clobber"]);
  const files = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  for (const name of files) {
    const src = path.join(dir, name);
    if (!existsSync(src)) continue;

    if (name === LATEST_JSON_ASSET) {
      await run("npx", [
        "wrangler", "r2", "object", "put", `${BUCKET}/${CHANNEL}/latest.json`,
        `--file=${src}`, "--content-type=application/json; charset=utf-8", "--remote",
      ]);
      console.log(`    R2: ${CHANNEL}/latest.json`);
      synced++;
      continue;
    }

    await run("npx", [
      "wrangler", "r2", "object", "put", `${BUCKET}/${CHANNEL}/${tag}/${name}`,
      `--file=${src}`, `--content-type=${contentTypeFor(name)}`, "--remote",
    ]);
    console.log(`    R2: ${CHANNEL}/${tag}/${name}`);
    synced++;

    if (MIRROR_STABLE_INSTALLERS && ASSETS[name]) {
      await run("npx", [
        "wrangler", "r2", "object", "put", `${BUCKET}/${name}`,
        `--file=${src}`, `--content-type=${ASSETS[name]}`, "--remote",
      ]);
      console.log(`    R2: ${name}`);
      synced++;
    }
  }

  await rm(dir, { recursive: true, force: true });
  console.log(`==> Done — ${synced} R2 object(s) mirrored.`);
}

main().catch((e) => {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
});
