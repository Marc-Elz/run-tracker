# Run Tracker

[![CI](https://github.com/Marc-Elz/run-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/Marc-Elz/run-tracker/actions/workflows/ci.yml)

Run-tracking Android app built with Vue 3 + Capacitor. See [context.md](context.md) for goals and decisions.

**[Try the live demo](https://marc-elz.github.io/run-tracker/)**: the app in a browser, with sample runs, a sample training program and simulated GPS. A reload starts over. See [How the demo differs](#how-the-demo-differs) for what only the phone can do.

## How the demo differs

The demo is the same code as the phone app, built for the browser. It differs only where the code checks whether it runs inside the Android app (`Capacitor.isNativePlatform()`), and in a few additions behind a demo-only build flag (`VITE_DEMO`).

**Simulated**
- **GPS:** a simulated runner circles a ~170 m loop in central Amsterdam at 5:30 min/km, one fix per second (`src/lib/simulateGps.ts`). There's no permission prompt and no real GPS noise or gaps. After a few minutes in a hidden tab, browsers slow its timers, so the simulated run falls behind; the phone keeps tracking in the background.
- **Storage:** runs and training programs are kept in memory instead of SQLite, and start from 12 sample runs and a "5K builder" program each time the page loads (`src/demo/`). Settings (spoken cues, followed program, step announcements) are in the browser's storage and survive a reload.
- **Map:** a keyless OpenStreetMap map (via [Protomaps](https://protomaps.com)) covering only Utrecht and the Amsterdam loop, instead of MapTiler, which needs an API key.

**Replaced by the browser's version**
- **Spoken cues:** the browser's speech voice instead of the phone's text-to-speech; on some desktops there is none. Other audio isn't lowered while it speaks.
- **Vibration:** the browser's vibration API. Desktops ignore it; Chrome on Android vibrates.
- **GPX export and backups:** a file download instead of Android's share sheet.
- **Back:** the browser's back button follows the page history; the Android back-button handling is off.

**Not in the demo**
- Keeping the screen awake and the app alive during a run.
- The battery-optimisation request, the notification permission and the ongoing notification during a run.
- Settings' tracking checks (location, notifications, battery), which only show on the phone.
- Refreshing when the app returns to the foreground, and recovering a run after the app was killed.

**Demo-only additions:** a banner saying GPS is simulated, the sample data, and on wide screens a phone-width column.

**How it's built:** every push to `main` that passes CI publishes it to GitHub Pages (`.github/workflows/ci.yml`). The sample data is `src/demo/demo-backup.json`, made with `node scripts/make-test-backup.mjs src/demo/demo-backup.json 12 400 --demo`. The map comes from the separate [run-tracker-demo-map](https://github.com/Marc-Elz/run-tracker-demo-map) repo, made with `node scripts/make-demo-map.mjs <clone of run-tracker-demo-map>`. That repo holds the map data under its own licences (ODbL, OFL), so none of it is in this repo.

## Status

Restarted in October 2026 as a portfolio project, with the longer-term goal of becoming an app I would actually use for my own runs. It is built with Claude Code as an agentic workflow (issues, plans and pull requests; see `CLAUDE.md` and `.claude/`).

- **Done:** Phase 1 (MVP) is code-complete: record a run with GPS in the background, show it on a map, store it in SQLite and export it as GPX. The remaining checks are on-device.
- **In progress / next:** run history, then Strava upload.
- **Later:** street coverage and route suggestions backed by a home server, and training programs.
- **Personal use:** not planned for the Play Store.

The roadmap lives in the [milestones](https://github.com/Marc-Elz/run-tracker/milestones).

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
