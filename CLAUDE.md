# Run Tracker

Run-tracking Android app (Samsung phone): Vue 3 + TypeScript + Vite wrapped in Capacitor. Solo project, developed on several PCs (Windows 11 and Linux, Docker Desktop on all).

Background, decisions and open questions: `context.md` (read it when a task needs the why, not every time). Work items: GitHub Issues and milestones, not a file.

## Commands
- `npm run dev` web dev server (browser only; no real GPS, a dev-only GPS simulator exists)
- `npm run type-check`, `npm run lint`, `npm run test:unit` run all three before opening a PR
- `npm run test:browser` Playwright smoke test of the browser-only flows (tabs, simulated run, GPX download, Settings). Not part of the pre-PR checks and not run by default: use it only when a change touches those flows, or to tick a browser-only checkbox. Needs `npx playwright install chromium` once per PC. Don't reach for Playwright otherwise; unit tests and the checks above come first.
- `npm run android:run` build, sync and launch on a connected phone (`android:sync`, `android:open` also exist)
- `npm run doctor` checks this PC (Node, git, gh, Android SDK/Java/adb, phone, Docker)
- New or unfamiliar PC: use the `startup-runtracker` skill

## Workflow
- Every issue gets its own branch (`feat/<n>-slug`, `task/<n>-slug`, `docs/slug`) and a PR with `Closes #<n>`. Use `Refs #<n>` when the issue must stay open until something is verified. Templates are in `.github/`.
- Leave PRs open for me to merge. Squash merge is the default. Never push to `main` directly.
- No CI on purpose; checks run locally.
- Prefer not to stack PRs. If one issue needs another's code, base it on that branch, say so in the PR, and expect to merge `main` into it after the first PR is squash-merged.
- Keep checkboxes honest. When I report a device result or a PR is merged, update the issue's boxes, its plan comment and the PR text in the same turn. Tick only what was actually verified (a unit test, Playwright or a device run, say which), and leave a short "To call this done" note on the issue for anything still open.
- Issue labels: `feature`, `task`, `bug`; areas `tracking`, `strava`, `maps`, `infra`; `decision` means a choice is needed before work can start. Don't start an issue that depends on an undecided `decision` issue.
- Commits end with the Co-Authored-By line given by the harness.

## Conventions
- Cross-platform: Windows and Linux. npm scripts, forward slashes, LF line endings (`.gitattributes`). No Windows-only scripts.
- Metric units (km, min/km).
- Native behaviour (background GPS, keep-awake, battery optimisation) can only be verified on the real phone. Say plainly in the PR when something was not tried on a device.
- Don't commit secrets. The Strava client secret handling is an open decision (#12).
- App id is `com.runtracker.app`; keep personal names out of the repo.

## Skill settings
Read by the `plan-feature`, `wireframe` and `fix-bug` skills and the `plan-reviewer` agent (copied from the coding-harness repo; improve them there).
- Keep the skills, hooks and agents aimed at run-tracker development and token-lean: project facts go in this section, not in the skill files; short skill descriptions; small changes get no plan; reviewer agents only where a skill says; rules that must always run go in a hook, not a skill.
- Tracker: GitHub Issues, `gh issue view <n> --comments`.
- Plans, wireframes and bug write-ups go in a comment on the issue (`gh issue comment <n> --body-file <file>`), not in committed files. Draft the file in the scratchpad.
- Default branch `main`; branch naming as in Workflow.
- Checks: `npm run type-check`, `npm run lint`, `npx vitest run`. A hook runs them before `gh pr create` and blocks the PR on failure.
- Device-only: background GPS, keep-awake, permission prompts, battery optimisation, anything under `android/`. In the browser, approximate GPS with `src/lib/simulateGps.ts`; on the phone, read `adb logcat`.
- Planning hazards: Android permissions and manifest changes; Samsung battery optimisation killing the app mid-run (no lost run data); foreground-service notification; GPS noise, gaps and accuracy; no network while running; storage migrations once SQLite lands (#5); secrets (#12).
- UI target: Android phone, portrait, 360–412 px wide, dark mode. Run screens must be readable at a glance while running: large numbers, one-thumb reach, big touch targets, high contrast in sunlight.
- Reviewer: spawn `plan-reviewer` only for large issues, e.g. background GPS (#3), SQLite (#5), Strava OAuth (#13), street coverage (#28).
