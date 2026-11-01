---
target: design/motifs
total_score: 14
max_score: 28
na_heuristics: 3,5,9
p0_count: 0
p1_count: 2
target_identity: "file:/home/chips/git/codehood/codehood/src/pages/design/motifs.astro"
target_fingerprint: "sha256:e90c3dc1bac1b1c0e8d38c15b724230cba788f7b9ee8240d57fd2b0d3eb07dba"
target_path: /home/chips/git/codehood/codehood/src/pages/design/motifs.astro
timestamp: 2026-10-30T22-27-23Z
slug: src-pages-design-motifs-astro
---
Method: dual-agent (A: design review · B: detector + browser)

Score 14/28 (50%, Acceptable). n/a: 3, 5, 9.
| # | Heuristic | Score | Key issue |
|1|Status|3|ok|
|2|Real world|2|top walls without labels|
|3|Control|n/a|static showcase|
|4|Consistency|1|page walls use wallOf, not TileWall; stripes vs checkerboard; quiet strip contradicts docs|
|5|Error prevention|n/a||
|6|Recognition|2|usage rules only in docs/ui/identity.md|
|7|Flexibility|1|no seed/tone variations side by side|
|8|Aesthetic|3|loudest element has least explanation|
|9|Recovery|n/a||
|10|Help|2|no do/don't, primitives never shown alone|

Priority issues
- [P1] Tile grammar is not Bulcão: mismatched radii (12,20,8,15x10) and centered figures, no shapes across seams; mostly symmetric figures (~17 distinct states). Fix: shared radius grid at edge midpoints/corners, 1-2 asymmetric modules, drop ellipse.
- [P1] Too many colours per wall (5 random) and soft tone via opacity .45 gives pastel/mud in dark. Fix: one figure colour per wall + rare accent; contrast via ground/figure pair, not opacity.
- [P2] Reference walls (wallOf) do not match TileWall; rotation (i*7+3)%4 with 12 cols depends only on column -> vertical stripes; designs repeat every 3 rows; ground i%3 makes beige columns; tiles scale to ~30px on mobile. Fix: render TileWall full/soft with labeled seeds + row of primitives in 4 turns.
- [P2] Course tiles at 18px are noise; grounds[i%2] paints columns; editions unrelated; Avatar reuses generator. Fix: single tile below 32px, checkerboard ground, seed without edition, distinct avatar form.
- [P3] identity.md forbids thin strips but CenteredLayout quiet renders one.

Detector: file scan clean; URL scan 8 findings, only line-length (Sketch paragraph ~motifs.astro:184) real; nested-cards x4, cream-palette, kicker-above-heading, repeating-stripes-gradient are false positives.

Minor: missing space before <code>docs/ui/identity.md</code>; mobile header pill wraps; Sketch duplicate ids #sketch-a/#sketch-b; ipê bouquets read as sunflowers at small size; athos sketch too dense at quarter width.
