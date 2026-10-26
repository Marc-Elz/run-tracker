# Run Tracker

Run-tracking Android app built with Vue 3 + Capacitor. See [context.md](context.md) for goals and decisions.

## Prerequisites (Windows and Linux)
- Node.js 20+ and npm
- Android Studio (includes the Android SDK and a JDK)
- USB debugging enabled on the phone (Settings > Developer options), `adb` on your PATH

## New PC? Check your setup
```sh
git clone https://github.com/Marc-Elz/run-tracker.git && cd run-tracker
nvm use          # Node version from .nvmrc
npm install
npm run doctor   # checks Node, git, gh, Docker, Android SDK/Java/adb and a connected phone, with fix hints
```
With Claude Code in this repo, say "set up this PC" and the `startup-runtracker` project skill (`.claude/skills/startup-runtracker`) does this for you. It also helps you pick up open work and wrap up when switching PCs.

## Develop
```sh
npm install
npm run dev            # web dev server in the browser
npm run type-check
npm run lint
npm run test:unit
```

## Architecture
A Vue 3 single-page app (TypeScript, Vite) running inside a Capacitor WebView on Android. The same code also runs in a desktop browser, with a GPS simulator, so most work does not need the phone.

```
src/
  views/        screens: Run, Run summary, History, Settings
  components/   TabBar, RouteMap (MapLibre), ConfirmDialog
  stores/run.ts Pinia store: the run state machine (idle, running, paused, finished)
  composables/  small Vue hooks around app events (resume, back button, keep-awake)
  lib/          logic with no Vue in it
    geo, runStats, runSummary, gpx, format   pure functions: distance, filtering, pace, GPX
    gps, runPower, shareRun, trackingStatus  wrappers around native plugins, with a browser fallback
    mapStyle                                 the one place that names the map tile provider
    db/                                      RunRepository interface, SQLite and in-memory implementations, migrations
android/        the Capacitor Android project, plus RunPowerPlugin.java (foreground notification, battery exemption)
```

How a run flows:
1. `gps.ts` receives location fixes from the background-geolocation plugin, which runs in an Android foreground service so tracking continues with the screen off.
2. The run store writes every raw fix to SQLite as it arrives (through the `RunRepository` interface), so a killed app can recover the run on the next launch.
3. Distance, pace and the exported GPX are computed from the stored raw fixes by the same pure functions in `runStats.ts` (accuracy cutoff, jump and jitter filtering). The raw data is never altered, so the filtering rules can change later without losing data.
4. The finished run is shown on a map (`runSummary.ts` builds the route lines, `RouteMap.vue` draws them) and exported as GPX through the Android share sheet.

Design choices worth knowing:
- Logic lives in pure functions and thin native wrappers, so it can be unit-tested without a phone.
- Native plugins sit behind small TypeScript modules with a browser fallback. The app runs in a browser and the tests mock the plugins.
- The database sits behind a repository interface (SQLite on the phone, in memory in the browser and in tests). Runs get UUIDs on the phone and timestamps are UTC epoch milliseconds, so a later sync to a server needs no changes to the data.
- The map provider is isolated in `src/lib/mapStyle.ts` so it can be swapped.

Decisions and their reasons are kept in [context.md](context.md) and in the `decision` issues on GitHub.

## Testing
```sh
npm run type-check   # vue-tsc, strict TypeScript
npm run lint         # oxlint and ESLint
npm run test:unit    # Vitest
npm run test:browser # Playwright smoke test of the browser flows, run on demand
```
- **Unit tests (Vitest)** cover the run maths, GPX output, the database layer (migrations, repository), the store, the views and the native wrappers with the plugins mocked. They live next to the code in `__tests__` folders and run in a few seconds.
- **Browser smoke test (Playwright)** walks through the tabs, a simulated run, the GPX download and Settings. It is not part of the pre-PR checks, to keep them fast.
- **On-device checks** cover what only the real phone can show: background GPS with the screen off, the foreground notification, permission prompts and battery optimisation. Each issue lists these as separate acceptance criteria and a box is only ticked after the check was done, saying which one (unit test, browser or device).
- There is no CI. A hook in `.claude/hooks` runs type-check, lint and the unit tests before a pull request is opened.

## How the work is organised
Every piece of work is a GitHub issue with acceptance criteria, each marked with how it is verified. Bigger features get a plan comment on the issue before any code. Each issue has its own branch and a pull request that says what was and was not tried on a device. Choices that need a decision are `decision` issues and are recorded with their reasons once made. Issues are grouped into milestones, one per phase.

## Run on a device
```sh
npm run android:run    # build web app, sync to Android, install and launch on a connected device
npm run android:open   # or open the project in Android Studio
```

Run `npm run android:sync` after changing web code or installing Capacitor plugins.
