# Bugs found

Real bugs only (tech.md). Each entry gives the seed, what broke, the regression test and the fix commit, cited by its subject line.

## 2026-11-16 - Comfort grid: samples at a cell edge counted one cell off

- Seed: none. Not found by fast-check: a Node script compared `min(floor(v * n), n - 1)` with the edges `k / n` at every grid size from 1 to 256, the range validateTuning allows for `gridCols` and `gridRows`.
- What broke: `cellIndex` in `packages/marrow/src/core/comfortGrid.ts` (task 6.1; the bug never reached a commit) found a sample's cell with `min(floor(v * n), n - 1)`, while `cellRectCamera` puts the edge between cells k - 1 and k at `k / n`. The two are rounded separately and sometimes disagree by one cell, so a cell could become valid from samples outside its own rectangle, against design §9.2.
  - At the shipped 24 rows, the largest double below the row edges 5, 10, 17, 20 and 23 was counted in the row after the edge, not the row before it. For example, y = 0.20833333333333331, the double just below 5 / 24, was counted in row 5 although it lies in row 4's rectangle. The shipped 32 columns agreed at every edge.
  - At 167 of the 256 sizes, a point exactly on an edge was counted in the cell before it: at 22 columns, x = 15 / 22 was counted in column 14, not 15; at 49, (1 / 49) * 49 = 0.9999999999999999. At 212 sizes the largest double below an edge was counted in the cell after it, and 218 sizes had at least one of the two.
- Fix: `cellIndex` takes `i = floor(v * n)`, moves it down by one if `v < i / n` and up by one if `v >= (i + 1) / n`, then applies `min(i, n - 1)`. Req 11.2 and design §9.2 each gained one sentence: the cell of a point is the cell whose half-open rectangle, as computed, contains it, with x = 1 and y = 1 in the last cell.
- Regression tests, in `packages/marrow/src/core/comfortGrid.test.ts`, each run for every `gridCols` and every `gridRows` that validateTuning allows: a point exactly on each internal edge is counted in the next cell; the largest double below each internal edge is counted in the cell before it; and each of those points, plus 0, the largest double below 1 and 1, is counted in the cell whose `cellRectCamera` rectangle holds it. All six failed before the fix, at 167, 212 and 218 sizes for each axis, and pass after it.
- Fix commit: "Add comfort grid".
