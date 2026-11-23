# Run Tracker

Run-tracking Android app (Samsung phone): Vue 3 + TypeScript + Vite wrapped in Capacitor. Solo project, developed on several PCs (Windows 11 and Linux, Docker Desktop on all).

Personal-use app and portfolio project (source shared with employers): the issue/plan/PR/test trail and tracked decisions are part of the deliverable, and I must be able to explain all the code. See "Purpose" in `context.md`.

Background, decisions and open questions: `context.md` (read it when a task needs the why, not every time). Work items: GitHub Issues and milestones, not a file. Priority lives only in the Priority field of the repo's GitHub Project board (`gh project item-list 3 --owner Marc-Elz`, #155): P0 = being worked on now or blocks the current goal, P1 = next, P2 = later, empty = parked (Strava). No priority labels.

## Commands
- `npm run dev` web dev server (browser only; no real GPS, a dev-only GPS simulator exists)
- `npm run type-check`, `npm run lint`, `npm run format:check`, `npm run test:unit` run all four before opening a PR (`npm run format` fixes formatting)
- `npm run test:browser` Playwright smoke test of the browser-only flows (tabs, simulated run, GPX download, Settings). Not part of the pre-PR checks and not run by default: use it only when a change touches those flows, or to tick a browser-only checkbox. Needs `npx playwright install chromium` once per PC. Don't reach for Playwright otherwise; unit tests and the checks above come first.
- `npm run android:run` build, sync and launch on a connected phone (`android:sync`, `android:open` also exist)
- `npm run android:run:dev` same, but installs the dev copy ("Run Tracker DEV", `com.runtracker.app.dev`) next to the normal app, with its own empty database (#184). Use it for PR builds so the copy being tested stays on the phone. In Android Studio pick the `liveDebug` or `devDebug` build variant.
- `npm run doctor` checks this PC (Node, git, gh, Android SDK/Java/adb, phone, Docker)
- New or unfamiliar PC: use the `startup-runtracker` skill

## Workflow
- Every issue gets its own branch (`feat/<n>-slug`, `task/<n>-slug`, `docs/slug`) and a PR with `Closes #<n>`. Use `Refs #<n>` when the issue must stay open until something is verified. Templates are in `.github/`.
- Leave PRs open for me to merge. Squash merge is the default. Never push to `main` directly.
- When a PR that changes the app is ready for review, put the main checkout (not a worktree) on a detached HEAD at the PR's latest pushed commit (`git fetch origin`, `git checkout --detach origin/<branch>`), so I can `npm run` there with my `.env.local`. Say if `package.json` changed (`npm install` needed). If the main checkout has local changes or is on another branch, don't touch it: give me those commands instead, plus `git checkout main` to go back. A worktree-isolated session leaves its worktree (keep) after pushing to do this.
- Trace what a PR finds. For each thing found while working on a PR that changes the code (from my manual testing, or noticed by Claude: a failing check, a bug in nearby code, a follow-up the PR leaves): if it is within the PR's scope, fix it on the PR and post one short PR comment, **Found** (what, and how: device, `adb logcat`, browser) and **Outcome** (fixed in `<sha>`). If it is not, file an issue in the same turn that names the PR or issue it came from in its first lines; GitHub links it on that PR's timeline, so no PR comment is needed. Never leave a finding unfixed and unfiled. If the plan changed, add a one-line deviation to the plan comment on the issue. Skip small tweaks and wording changes. Lasting decisions still go to `context.md` (see Record decisions); no separate decisions or implementation file. `context.md` holds no progress status (what is done or next): that lives in milestones and issues.
- CI: `.github/workflows/ci.yml` runs type-check, lint, the Prettier check, unit tests and the build on every PR and push to `main` (#158). The pre-PR hook still runs the checks locally first.
- Prefer not to stack PRs. If one issue needs another's code, base it on that branch, say so in the PR, and expect to merge `main` into it after the first PR is squash-merged.
- Keep checkboxes honest. When I report a device result or a PR is merged, update the issue's boxes, its plan comment and the PR text in the same turn. Tick only what was actually verified (a unit test, Playwright or a device run, say which), and leave a short "To call this done" note on the issue for anything still open.
- Issue labels: `feature`, `task`, `bug`; areas `tracking` (GPS recording, run data, history), `training` (programs, sessions, steps, exercise plans), `audio` (spoken cues, voices, music ducking), `strava`, `maps`, `infra`, more than one when an issue spans them; `usability` marks a change that makes the app easier to use, next to its area; `decision` means a choice is needed before work can start. Don't start an issue that depends on an undecided `decision` issue. `blocked` means the work is decided but waits on another open issue, named in the issue's "Depends on" list; don't start it. When an issue is merged and closed, in the same turn remove `blocked` from every issue that depended on it and had no other open blocker. An issue stays open only for work still to do: move deferred pieces to the issue that will really do them instead of leaving the original open.
- Record decisions as they happen. When a choice with lasting effect is made (a library, a data format, a trade-off between options), in the same turn: add **Decision / Why / Alternatives rejected** as a comment on the `decision` issue and close it (use the Decision template; open one if none exists and the choice affects more than one issue), then add one line with the issue number to `context.md` under Decisions. Small choices local to one issue go in that plan's "Decisions" line instead. If a choice is mine to make (it changes scope, cost, security or what I'd have to explain), stop and ask me with a recommendation; don't decide it silently.
- Commits end with the Co-Authored-By line given by the harness.

## Conventions
- Cross-platform: Windows and Linux. npm scripts, forward slashes, LF line endings (`.gitattributes`). No Windows-only scripts.
- Metric units (km, min/km).
- Native behaviour (background GPS, keep-awake, battery optimisation) can only be verified on the real phone. Say plainly in the PR when something was not tried on a device.
- Map tiles need a MapTiler key: copy `.env.example` to `.env.local` (gitignored) on each PC and add a free key. Without it the run map shows the route on a plain background. The key is bundled into the app, so it is not a secret; the provider lives only in `src/lib/mapStyle.ts`.
- All PCs that install to the phone must use the same debug keystore (`~/.android/debug.keystore`, kept out of the repo, copied by hand; `npm run doctor` shows its SHA256). A different key forces an uninstall, which deletes the saved runs. Never accept an uninstall without exporting first (#76).
- Every git worktree needs its own `npm install` (and its own `.env.local`). Without a `node_modules` of its own it resolves packages from the parent repo, and the Vite dev server then refuses to serve MapLibre's worker file, so the map throws `e.endsWith is not a function` (#90).
- Don't commit secrets. The Strava client secret handling is an open decision (#12).
- App id is `com.runtracker.app`; keep personal names out of the repo.

## Skill settings
Read by the `plan-feature`, `wireframe` and `fix-bug` skills and the `plan-reviewer` agent (copied from the coding-harness repo; improve them there).
- Keep the skills, hooks and agents aimed at run-tracker development and token-lean: project facts go in this section, not in the skill files; short skill descriptions; small changes get no plan; reviewer agents only where a skill says; rules that must always run go in a hook, not a skill.
- Tracker: GitHub Issues, `gh issue view <n> --comments`.
- Plans, wireframes and bug write-ups go in a comment on the issue (`gh issue comment <n> --body-file <file>`), not in committed files. Draft the file in the scratchpad.
- Default branch `main`; branch naming as in Workflow.
- Checks: `npm run type-check`, `npm run lint`, `npm run format:check`, `npx vitest run`. A hook runs them before `gh pr create` and blocks the PR on failure.
- Device-only: background GPS, keep-awake, permission prompts, battery optimisation, anything under `android/`. In the browser, approximate GPS with `src/lib/simulateGps.ts`; on the phone, read `adb logcat`.
- Planning hazards: Android permissions and manifest changes; Samsung battery optimisation killing the app mid-run (no lost run data); foreground-service notification; GPS noise, gaps and accuracy; no network while running; storage migrations once SQLite lands (#5); secrets (#12).
- UI target: Android phone, portrait, 360–412 px wide, dark mode. Run screens must be readable at a glance while running: large numbers, one-thumb reach, big touch targets, high contrast in sunlight.
- Reviewer: spawn `plan-reviewer` only for large issues, e.g. background GPS (#3), SQLite (#5), Strava OAuth (#13), street coverage (#28).
