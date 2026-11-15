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

## 2026-11-16 - Spec marrow-input: questions, answers, requirements

- Kiro feature used: spec, requirements phase of the new spec `marrow-input` (model: Claude Opus 5.5)
- What was built:
  - Questions before requirements, as the prompt asked: 6 conflicts between the prompt and steering and 41 open questions (input, signal processing, calibration and placement, dwell, tracking lifecycle, help policy, React UI, playground), each with a recommended answer, saved in `.kiro/specs/marrow-input/questions.md`.
  - My answers: all recommendations accepted, with five changes. A "Use the whole screen" control on the calibration screen in simulated-input mode only. An exact head-offset formula. Every value in `tuning.ts` labelled `tune` or `rule: change only with the user's approval`. Component tests approved in principle, with the package list (versions and licences) to be approved before install. The `@mediapipe/tasks-vision` version to be approved in design.md, and the WASM and model vendored in the app's public files with source URL, download date, licence and SHA-256 in `docs/licenses.md`.
  - `.kiro/specs/marrow-input/requirements.md`: 28 requirements in EARS wording with 258 numbered acceptance criteria, 27 of them "FOR ALL" properties meant for fast-check, covering steering section 10 invariants 1, 2, 5 and 6. Four appendices: the steering numbers used, labelled tune or rule; 15 numbers that are new relative to steering; invariant coverage; and the decisions behind the document, including 11 choices that neither steering nor my answers settle. `questions.md` was deleted once its answers were folded in.
  - The requirements follow the palette and placeholder rule I added to `art-and-motion.md` outside Kiro during this session: grey ramp and `lanternWarm` only, `--marrow-*` CSS properties in shared components.
  - requirements.md is not approved yet. No code, dependency or test changed.
- What Kiro got wrong or I changed, and why:
  - Kiro's first reply used its whole output budget on internal reasoning and produced no message and no file. On the retry it saved the open questions to `questions.md` first, then asked them in chat.
  - Kiro's summary of requirements.md said 30 criteria start with "FOR ALL". A recount during this wrap-up found 27; the first count had included three mentions in the prose. The numbers in this entry come from the recount.
  - The head-offset formula I gave, sign(d) * (|d| - 0.05) / (0.25 - 0.05), has the opposite sign inside the dead zone (d = 0.01 gives -0.2). Kiro wrote max(0, |d| - 0.05) in Requirement 9.3, which gives 0 inside the dead zone and the same values outside it, and flagged the change for my confirmation.
  - The prompt called every number in `interaction-invariants.md` a tuning value. Steering marks only some *(tune)*, and steering wins, so the unmarked values are listed as rules (Appendix A).
  - I named six new numbers. Appendix B lists 15: Kiro added the calibration hand-hint delay, the inference-rate cap, the default volume, the debug overlay window, the preview width, the playground slots and tones, and the gain cap and ramp.
- Evidence: commit subjects "Fill palette and type in art-and-motion steering from the approved mockups" and "Add marrow-input spec: requirements". No tests were added; requirements.md is not yet approved.
