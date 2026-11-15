# Kiro journal

Entries are appended. Earlier entries are never rewritten.

## 2026-11-15 - Setup session: steering, git, GitHub About

- Kiro feature used: vibe chat (steering written and reviewed with Kiro)
- What was built: the steering files in `.kiro/steering/` (product, structure, tech, interaction invariants, performance budget, art and motion, accessibility and copy). Git repository and GitHub About set up.
- What Kiro got wrong or I changed, and why: Kiro found 13 ambiguities in the steering. Each one was resolved by editing the steering, so the rules are written down before any code exists.
- Evidence: commit 59f1798 (initial commit: steering, licence, readme)

## 2026-11-15 - Monorepo scaffold

- Kiro feature used: vibe chat
- What was built: npm workspaces `packages/marrow`, `packages/world-view` and `apps/garden-of-echoes`, with `tests/` and `docs/`. TypeScript strict with a shared base config. Every dependency rule from `structure.md` enforced twice: ESLint `no-restricted-imports` zones and `tests/dependency-graph.test.ts`, which parses the real imports (one app, seven package entry points, pure zones, Pixi only in `world-view/src/pixi`, no story words or player-facing text in packages). Vite + React page showing only "Garden of Echoes", with `BASE_PATH` read in the Vite config. Vitest and fast-check with one test per workspace. Playwright with one dev server and one smoke test (Chromium only). Root scripts named as in `tech.md`: `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `simulate`. Exact version pins, `engines` Node `^22.13 || >=24`, `.nvmrc` 24, `docs/licenses.md`, README install, run and check sections. GitHub About description and topics updated with `gh`.
- What Kiro got wrong or I changed, and why:
  - The competition category changed from Skeleton Crew to Costume Contest before the first scaffold commit. The plan went from two apps plus a starter template to one app. The second app (`whisper-hall`) and `templates/marrow-app` were scaffolded and then removed, and `lantern-garden` was renamed `garden-of-echoes`, so none of them appear in the commit.
  - Kiro first ran commands with the terminal in `.kiro\steering`. I told it to run everything from the repository root and create nothing inside `.kiro\`.
  - `npm run simulate` is a placeholder that prints "not implemented yet" and exits 1, because `packages/marrow/src/sim` is empty and no feature code was in scope.
  - `@eslint/js` is not in the approved list, so ESLint uses only the typescript-eslint recommended rules plus the zones.
  - The first `engines` value (`>=22.12`) was looser than what ESLint 10 supports (`^22.13 || >=24`). I changed it to match ESLint.
  - `npm audit` reports 7 moderate findings in typescript-eslint's `minimatch`. The suggested fix is a downgrade outside the approved versions, so it was not applied.
  - `npm install` left three `extraneous` entries for the removed workspaces in `package-lock.json`. They were deleted by hand and `npm ci --dry-run` passes.
- Evidence: commit subject "Scaffold monorepo: Marrow packages and the Garden of Echoes app". Tests: `tests/dependency-graph.test.ts` (11 tests), `packages/marrow/src/smoke.test.ts`, `packages/world-view/src/smoke.test.ts`, `apps/garden-of-echoes/src/smoke.test.ts`, `tests/e2e/garden-of-echoes.spec.ts`. Two temporary probes failed both ESLint and the dependency test, then were removed: the app importing `marrow/src/core/index`, and a package importing from the app. No failing fast-check seed.

## 2026-11-15 - Deploy to GitHub Pages
- Kiro feature used: vibe chat
- What was built: `.github/workflows/deploy.yml`. On every push to `main` it runs `npm ci`, typecheck, lint and test on Node 24, builds `apps/garden-of-echoes` with `BASE_PATH=/<repository name>/`, and deploys `apps/garden-of-echoes/dist` to GitHub Pages in a separate job. The live URL is in the README and set as the repository website with `gh repo edit`. README section "How this was built" added.
- What Kiro got wrong or I changed, and why:
  - `gh` was not on the PATH of the Kiro terminal, so Kiro called it by its full install path.
  - PowerShell reported the successful `git push` as an error because git writes progress to stderr. The push had worked.
  - The requested README section listed spec-driven development and agent hooks, but `.kiro/specs` and `.kiro/hooks` do not exist yet. The text says so instead of claiming them.
  - The Pages source was switched to GitHub Actions by hand in the repository settings, as Kiro had listed it as a manual step.
  - The run shows a Node 20 deprecation warning for `actions/configure-pages@v5` and an `upload-artifact` dependency. Both are forced onto Node 24 by GitHub, so nothing was changed.
- Evidence: commit 2060076 "Deploy to GitHub Pages with GitHub Actions". Workflow run 43765797193, both jobs succeeded. https://stavroska.github.io/marrow-garden-of-echoes/ returns HTTP 200.
