# Brand mark — single source of truth

The Noah brand mark lives **here**, and only here. Every surface that
displays the icon (website favicon, in-page logo, desktop splash and
dock, Windows taskbar, iOS home screen, Android launcher) is rendered
from these two SVGs.

If you want to change the mark — even by a degree of tilt — edit
`build.py` and re-run `bash brand/sync.sh`. Do not hand-edit any other
file. Anything else is a downstream artifact and will be overwritten.

## Files

| File                       | Purpose                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `build.py`                 | Canonical generator. All geometry lives in its `PARAMS` dict.       |
| `noah-icon.svg`            | Bare symbol — transparent corners. For web + in-app + splash.       |
| `noah-icon-plated.svg`     | Same symbol on a rounded white plate. For dock / taskbar / mobile.  |
| `render-targets.py`        | Renders every output file from the two SVGs (PNG/.icns/.ico).       |
| `sync.sh`                  | Top-level entry point — runs build.py then render-targets.py.       |

## Updating the mark

1. Edit `PARAMS` in `build.py` (e.g. change `tilt_degrees`).
2. Run `bash brand/sync.sh` from anywhere. That:
   - Regenerates `noah-icon.svg` + `noah-icon-plated.svg` here,
   - Pushes the bare SVG to the website favicon + in-page logo,
   - Pushes the bare SVG to the desktop's splash + favicon + in-app NoahIcon,
   - Renders every plated PNG variant (desktop dock, Windows tiles, iOS,
     Android), every adaptive-foreground PNG (Android adaptive icons),
     and assembles `icon.icns` (macOS) + `icon.ico` (Windows).
3. **Refresh consumers** (the script reminds you at the end):
   - **Website**: `wrangler pages deploy public --project-name=onnoah-app`
     from `~/src/onnoah.app/`.
   - **Desktop dev**: stop `pnpm tauri dev`, restart it. The new
     `icon.icns` only gets baked into the .app bundle at process-start
     time, so an already-running dev session keeps showing the old icon.
   - **Desktop release**: rebuild + cut a release. Existing installs
     keep their old icon until users update.

## Consumers (the full list)

Everything below is auto-written by `render-targets.py` — do not edit
these files by hand.

**Website** (`/Users/x/src/onnoah.app/public/`)
- `favicon.svg` — browser tab icon
- `noah-icon.svg` — referenced by the in-page `NoahLogo` component

**Desktop public** (`/Users/x/src/noah/apps/desktop/public/`) — served by Vite
- `icon-32.png` — `<link rel="icon">` for the Tauri webview
- `noah-icon.png` — `<img>` in the splash screen

**Desktop in-app** (`/Users/x/src/noah/apps/desktop/src/assets/`)
- `noah-icon.svg` — imported by `NoahIcon.tsx` (header + onboarding)

**Desktop Tauri icons** (`/Users/x/src/noah/apps/desktop/src-tauri/icons/`)
- `icon.png`, `icon.icns`, `icon.ico`, `32x32.png`, `64x64.png`,
  `128x128.png`, `128x128@2x.png` — desktop dock & system tray
- `Square*Logo.png`, `StoreLogo.png` — Windows Store tiles
- `ios/AppIcon-*.png` — iOS home screen, Spotlight, Settings, App Store
- `android/mipmap-*/ic_launcher{,_round,_foreground}.png` — Android launcher
- `source-aurora.svg` — auto-synced copy of `noah-icon-plated.svg`
  (kept for Tauri tooling that expects this filename)

## Why this exists

We previously kept ending up with four-plus different "Noah" marks
across surfaces because the geometry was duplicated as inline CSS, as
hand-written SVG paths, and as platform-specific raster icons baked at
different times by different tools. This directory plus `sync.sh` makes
divergence impossible: every consuming surface reads from one generator.
