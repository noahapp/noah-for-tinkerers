#!/usr/bin/env python3
"""Lint diagrams in Markdown files.

Two classes of problem break diagrams when they are rendered outside the
author's editor:

1. Width-unsafe characters. Monospace alignment only holds if every character
   occupies exactly one cell. Characters like `⇄`, `▲`, or full-width
   punctuation fall back to other fonts on GitHub and shift every column after
   them. Inside a box diagram, only ASCII and the box-drawing block
   (U+2500-U+257F) are allowed.

2. Structural misalignment. Every vertical border must be continuous: a
   character with a downward arm (│ ┌ ┐ ┬ ├ ┤ ┼) must meet a character with an
   upward arm (│ └ ┘ ┴ ├ ┤ ┼) in the same column of the next line. A border
   that drifts by one column breaks continuity and is reported.

Mermaid blocks are checked for label line breaks written as literal `\\n`
(Mermaid renders those as text; use `<br/>`), and rendered with mermaid-cli
when it is available (`npx -y @mermaid-js/mermaid-cli`).

Usage:
    python3 scripts/lint_diagrams.py [--mermaid] [paths...]

With no paths, lints every tracked .md file in the repository. Exits non-zero
if any diagram fails.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import subprocess
import sys
import tempfile
import unicodedata

BOX_CHARS = set(
    chr(c) for c in range(0x2500, 0x2580)
)
DOWN_ARM = set("│┌┐┬├┤┼╞╡╪║╔╗╠╣╬╦")
UP_ARM = set("│└┘┴├┤┼╞╡╪║╚╝╠╣╬╩")
# Arrowheads that legitimately terminate a vertical run, plus a horizontal
# border that absorbs a connector meeting a box edge.
DOWN_TERMINATORS = set("vV▼─═")
UP_TERMINATORS = set("^▲─═")

FENCE_RE = re.compile(r"^(```+|~~~+)\s*(\S*)\s*$")


def iter_fenced_blocks(lines):
    """Yield (start_line_index, language, block_lines) for each fenced block."""
    i = 0
    while i < len(lines):
        m = FENCE_RE.match(lines[i])
        if not m:
            i += 1
            continue
        fence, lang = m.group(1), m.group(2).lower()
        start = i + 1
        j = start
        # A closing fence uses the same marker character, is at least as long
        # as the opener, and carries nothing else on the line.
        def closes(line):
            stripped = line.strip()
            return (
                stripped.startswith(fence[0] * len(fence))
                and set(stripped) == {fence[0]}
            )
        while j < len(lines) and not closes(lines[j]):
            j += 1
        yield start, lang, lines[start:j]
        i = j + 1


def is_box_diagram(block):
    return any(ch in BOX_CHARS for line in block for ch in line)


def check_charset(block, start, path, errors):
    for offset, line in enumerate(block):
        for col, ch in enumerate(line):
            if ord(ch) < 128 or ch in BOX_CHARS:
                continue
            name = unicodedata.name(ch, f"U+{ord(ch):04X}")
            width = unicodedata.east_asian_width(ch)
            errors.append(
                f"{path}:{start + offset + 1}:{col + 1}: width-unsafe "
                f"character {ch!r} ({name}, east-asian width {width}) in box "
                f"diagram - use ASCII or box-drawing characters only"
            )


def check_vertical_continuity(block, start, path, errors):
    width = max((len(l) for l in block), default=0)
    grid = [l.ljust(width) for l in block]
    for r, line in enumerate(grid):
        for c, ch in enumerate(line):
            if ch in DOWN_ARM:
                below = grid[r + 1][c] if r + 1 < len(grid) else " "
                if below not in UP_ARM and below not in DOWN_TERMINATORS:
                    errors.append(
                        f"{path}:{start + r + 1}:{c + 1}: vertical border "
                        f"{ch!r} is not continued on the next line "
                        f"(found {below!r}) - the column below must contain "
                        f"one of {''.join(sorted(UP_ARM))} or an arrowhead"
                    )
            # A plain vertical bar may legitimately start below a text label
            # (a connector hanging off a caption), so the upward check only
            # applies to structural junction characters. Border drift is still
            # caught: the downward check on the line above fails first.
            if ch in UP_ARM and ch not in "│║":
                above = grid[r - 1][c] if r > 0 else " "
                if above not in DOWN_ARM and above not in UP_TERMINATORS:
                    errors.append(
                        f"{path}:{start + r + 1}:{c + 1}: vertical border "
                        f"{ch!r} does not connect to the line above "
                        f"(found {above!r})"
                    )


def check_mermaid(block, start, path, errors, render):
    src = "\n".join(block)
    for offset, line in enumerate(block):
        if "\\n" in line:
            errors.append(
                f"{path}:{start + offset + 1}: literal \\n in mermaid label "
                f"renders as text on GitHub - use <br/> instead"
            )
    if not render:
        return
    with tempfile.NamedTemporaryFile(
        "w", suffix=".mmd", delete=False
    ) as f:
        f.write(src)
        tmp = f.name
    out = tmp + ".svg"
    try:
        proc = subprocess.run(
            ["npx", "-y", "@mermaid-js/mermaid-cli", "-i", tmp, "-o", out],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout).strip().splitlines()[-3:]
            errors.append(
                f"{path}:{start + 1}: mermaid block failed to render: "
                + " / ".join(tail)
            )
    except (OSError, subprocess.TimeoutExpired) as exc:
        errors.append(f"{path}:{start + 1}: could not run mermaid-cli: {exc}")
    finally:
        for p in (tmp, out):
            pathlib.Path(p).unlink(missing_ok=True)


def lint_file(path, render_mermaid):
    errors = []
    lines = pathlib.Path(path).read_text(encoding="utf-8").splitlines()
    for start, lang, block in iter_fenced_blocks(lines):
        if lang == "mermaid":
            check_mermaid(block, start, path, errors, render_mermaid)
        elif is_box_diagram(block):
            check_charset(block, start, path, errors)
            check_vertical_continuity(block, start, path, errors)
    return errors


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("paths", nargs="*", help=".md files to lint")
    ap.add_argument(
        "--mermaid",
        action="store_true",
        help="also render mermaid blocks with mermaid-cli (slower)",
    )
    args = ap.parse_args()

    if args.paths:
        files = [pathlib.Path(p) for p in args.paths]
    else:
        repo = pathlib.Path(__file__).resolve().parent.parent
        tracked = subprocess.run(
            ["git", "-C", str(repo), "ls-files", "*.md"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.splitlines()
        files = [repo / p for p in tracked]

    all_errors = []
    checked = 0
    for f in files:
        if not f.is_file():
            continue
        checked += 1
        all_errors.extend(lint_file(f, args.mermaid))

    for e in all_errors:
        print(e)
    print(
        f"lint_diagrams: {checked} files checked, "
        f"{len(all_errors)} problem(s) found",
        file=sys.stderr,
    )
    return 1 if all_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
