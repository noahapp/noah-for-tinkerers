#!/usr/bin/env python
"""Canonical generator for the Noah brand mark.

This is the SINGLE SOURCE OF TRUTH for the icon geometry. To change the
mark — even by a degree of tilt or a pixel of stroke width — edit the
parameters in PARAMS below and re-run:

    ~/.claude-python/bin/python brand/build.py
    bash brand/sync.sh

That regenerates both SVG sources (bare + plated) and propagates them
to every surface (website favicon, in-page logo, desktop icon variants).

Why this exists: we kept ending up with four different "Noah" marks
across surfaces because the geometry was duplicated as inline CSS, as
hand-written SVG paths, and as platform-specific raster icons. From
this point forward, only this script writes the SVG, only sync.sh
copies it outward, and no surface hand-codes the arcs.
"""
from __future__ import annotations

import math
import pathlib


# ── Brand parameters. Edit here and re-run to update everywhere. ───
PARAMS = {
    "arc_degrees": 180,    # visible arc length per ring
    "tilt_degrees": -20,   # per-ring rotation around its own center
    "stroke": 10.24,       # 0.08 of the 128-unit canvas
    "ring_radius": 33.28,  # 0.26 of canvas
    "dot_radius": 8.96,    # 0.07 of canvas
    "cool_center": (56.32, 58.88),   # NW of canvas center
    "warm_center": (71.68, 69.12),   # SE of canvas center
    "plate_corner_radius": 28,       # rounded-square plate
    "symbol_scale_on_plate": 0.71875,  # 92/128 — symbol fills 72% of plate
}

COOL_COLOR = "#5b9bd5"  # aurora-start
WARM_COLOR = "#8b5cf6"  # aurora-end
DOT_COLOR = "#6366f1"   # aurora-mid


def _arc_endpoints(cx, cy, r, arc_center_angle, arc_degrees):
    """Return (start_xy, end_xy) for a 180°-symmetric arc around arc_center_angle."""
    half = arc_degrees / 2.0
    start = math.radians(arc_center_angle - half)
    end = math.radians(arc_center_angle + half)
    return (
        (cx + math.cos(start) * r, cy + math.sin(start) * r),
        (cx + math.cos(end) * r, cy + math.sin(end) * r),
    )


def _symbol_inner(p):
    """The arcs + dot, sized to fit a 128-unit viewBox at full scale."""
    cool_start, cool_end = _arc_endpoints(*p["cool_center"], p["ring_radius"], 225, p["arc_degrees"])
    warm_start, warm_end = _arc_endpoints(*p["warm_center"], p["ring_radius"], 45, p["arc_degrees"])
    large_arc = 1 if p["arc_degrees"] > 180 else 0
    r = p["ring_radius"]
    sw = p["stroke"]
    tilt = p["tilt_degrees"]
    ccx, ccy = p["cool_center"]
    wcx, wcy = p["warm_center"]
    return f"""    <g transform="rotate({tilt} {ccx} {ccy})">
      <path d="M {cool_start[0]:.2f} {cool_start[1]:.2f} A {r:.2f} {r:.2f} 0 {large_arc} 1 {cool_end[0]:.2f} {cool_end[1]:.2f}"
            fill="none" stroke="{COOL_COLOR}" stroke-width="{sw}" stroke-linecap="round"
            filter="url(#glowCool)"/>
    </g>
    <g transform="rotate({tilt} {wcx} {wcy})">
      <path d="M {warm_start[0]:.2f} {warm_start[1]:.2f} A {r:.2f} {r:.2f} 0 {large_arc} 1 {warm_end[0]:.2f} {warm_end[1]:.2f}"
            fill="none" stroke="{WARM_COLOR}" stroke-width="{sw}" stroke-linecap="round"
            filter="url(#glowWarm)"/>
    </g>
    <circle cx="64" cy="64" r="{p['dot_radius']}" fill="{DOT_COLOR}"/>"""


_FILTERS = """  <defs>
    <filter id="glowCool" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="1.8" result="b"/>
      <feColorMatrix in="b" type="matrix"
        values="0 0 0 0 0.357
                0 0 0 0 0.608
                0 0 0 0 0.835
                0 0 0 0.5 0" result="c"/>
      <feMerge><feMergeNode in="c"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glowWarm" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="1.8" result="b"/>
      <feColorMatrix in="b" type="matrix"
        values="0 0 0 0 0.545
                0 0 0 0 0.361
                0 0 0 0 0.965
                0 0 0 0.5 0" result="c"/>
      <feMerge><feMergeNode in="c"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>"""


def build_bare(p) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="Noah">
  <title>Noah</title>
{_FILTERS}
  </defs>
{_symbol_inner(p)}
</svg>
"""


def build_plated(p) -> str:
    s = p["symbol_scale_on_plate"]
    # Symbol viewBox is 128 units; scaled by s, it covers 128·s units.
    # Center inside the 128-unit plate by translating (128 - 128·s)/2.
    translate = (128 - 128 * s) / 2
    rx = p["plate_corner_radius"]
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="Noah">
  <title>Noah</title>
{_FILTERS}
    <linearGradient id="plateWash" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="{COOL_COLOR}" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="{WARM_COLOR}" stop-opacity="0.10"/>
    </linearGradient>
  </defs>

  <rect width="128" height="128" rx="{rx}" fill="#ffffff"/>
  <rect width="128" height="128" rx="{rx}" fill="url(#plateWash)"/>

  <g transform="translate({translate:.2f} {translate:.2f}) scale({s})">
{_symbol_inner(p)}
  </g>
</svg>
"""


if __name__ == "__main__":
    here = pathlib.Path(__file__).parent
    (here / "noah-icon.svg").write_text(build_bare(PARAMS))
    (here / "noah-icon-plated.svg").write_text(build_plated(PARAMS))
    print(f"wrote {here}/noah-icon.svg")
    print(f"wrote {here}/noah-icon-plated.svg")
