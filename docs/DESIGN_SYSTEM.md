# Design system

**Identity.** PulseGrid = a grid of nodes + a pulse line moving through it. The logo is original
SVG geometry (3×3 dot grid, single accent polyline), shipped as mark / full / mono variants in
`apps/web/public/brand/`.

**Tokens** (single source: `packages/config/src/brand.ts:colors`, mirrored as CSS variables in
`globals.css`, consumed by Tailwind as semantic names):

| Token | Value | Use |
|---|---|---|
| bg / bg-secondary / surface | #0b0f17 / #111827 / #161e2e | page / chrome / cards |
| border | #2a3648 | 1px lines everywhere |
| text / text-muted | #e6eaf2 / #8b98ad | copy |
| accent | #38bdf8 | actions, links, pulse |
| healthy / warning / critical | #34d399 / #fbbf24 / #f87171 | status semantics |

**Type.** Inter for UI, JetBrains Mono for ids/metrics/timestamps (`next/font`, self-hosted).

**Rules.** Status colors always pair with a text label (never color-only); pulse animation is
reserved for live status dots and respects `prefers-reduced-motion`; charts share one restrained
AreaChart treatment; density over decoration — this should read as an ops tool, not a marketing
site.
