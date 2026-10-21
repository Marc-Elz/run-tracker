# Run Tracker

Run-tracking Android app (Samsung phone): Vue 3 + TypeScript + Vite wrapped in Capacitor. Solo project, developed on several PCs (Windows 11 and Linux, Docker Desktop on all).

Background, decisions and open questions: `context.md` (read it when a task needs the why, not every time). Work items: GitHub Issues and milestones, not a file.

## Commands
- `npm run dev` web dev server (browser only; no real GPS, a dev-only GPS simulator exists)
- `npm run type-check`, `npm run lint`, `npm run test:unit` run all three before opening a PR
- `npm run android:run` build, sync and launch on a connected phone (`android:sync`, `android:open` also exist)
- `npm run doctor` checks this PC (Node, git, gh, Android SDK/Java/adb, phone, Docker)
- New or unfamiliar PC: use the `startup-runtracker` skill

## Workflow
- Every issue gets its own branch (`feat/<n>-slug`, `task/<n>-slug`, `docs/slug`) and a PR with `Closes #<n>`. Use `Refs #<n>` when the issue must stay open until something is verified. Templates are in `.github/`.
- Leave PRs open for me to merge. Squash merge is the default. Never push to `main` directly.
- No CI on purpose; checks run locally.
- Prefer not to stack PRs. If one issue needs another's code, base it on that branch, say so in the PR, and expect to merge `main` into it after the first PR is squash-merged.
- Issue labels: `feature`, `task`, `bug`; areas `tracking`, `strava`, `maps`, `infra`; `decision` means a choice is needed before work can start. Don't start an issue that depends on an undecided `decision` issue.
- Commits end with the Co-Authored-By line given by the harness.

## Conventions
- Cross-platform: Windows and Linux. npm scripts, forward slashes, LF line endings (`.gitattributes`). No Windows-only scripts.
- Metric units (km, min/km).
- Native behaviour (background GPS, keep-awake, battery optimisation) can only be verified on the real phone. Say plainly in the PR when something was not tried on a device.
- Don't commit secrets. The Strava client secret handling is an open decision (#12).
- App id is `com.runtracker.app`; keep personal names out of the repo.
