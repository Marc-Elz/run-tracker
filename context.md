# Run Tracker – Project Context

## Goal
A run-tracking mobile app for my Samsung (Android) phone. Core: record runs with GPS.
Longer-term: view routes/streets I've run, and get suggested routes so I don't repeat the same ones.
Sharing runs to Strava should be as easy as possible.

## Purpose
Personal-use app that doubles as a portfolio project; the source will be shared with potential employers. So the process is part of the deliverable, not only the code:
- Work is organised as issues, plans, PRs and tests, and stays readable on GitHub (issues have acceptance criteria and a "verify" method per item; PRs say what was and was not tried on a device).
- Every decision is tracked: a `decision` issue while open, then recorded under Decisions below with the why.
- I should be able to explain every part of the code. Prefer simple, conventional solutions I understand over clever ones; no code I couldn't defend in an interview.
- Code follows common standards: strict TypeScript, lint and type-check clean, logic in pure tested functions, small modules, conventional naming, no secrets in the repo.

## Tech decisions
- **Frontend:** Vue 3 (+ TypeScript, Vite)
- **Mobile wrapper:** Capacitor (native Android shell around the Vue app). Alternatives considered: Ionic Vue, Quasar, NativeScript-Vue.
- **Background GPS:** native plugin with Android foreground service (`@capacitor-community/background-geolocation`, or Transistorsoft's paid plugin if reliability is poor).
- **Local storage:** SQLite on device (runs, GPS points).
- **Maps:** MapLibre GL JS with a tile provider that has a free tier (MapTiler / Stadia). Not OSM's own tile servers.
- **Fallback:** if Capacitor tracking is unreliable, write only the tracking part natively (Kotlin) or move to Flutter.
- **App id:** `com.runtracker.app` (deliberately generic, no personal name). Must be unique and becomes permanent if ever published, so revisit before a first Play Store upload.
- **Scaffold:** Vue 3 + TS + Vite with Vue Router, Pinia, Vitest, ESLint/oxlint, Prettier; Capacitor 8 with the Android platform.
- **Keep screen on:** `@capacitor-community/keep-awake` while a run is active.
- **Home server:** an old laptop (Linux + Docker) will host the routing engine, optional run sync and possibly a Strava token proxy. Needs remote access while out running (Tailscale / Cloudflare Tunnel preferred over open ports). See #26.

## Known risks
- Samsung battery optimisation kills background apps. Need to prompt the user to exempt the app and test on the real device.
- Background location permission needs clear UX (a Play Store review would apply only if the app were ever published, which is not planned).

## Integrations
### Strava
- Strava API v3, OAuth2, scope `activity:write`.
- Upload GPX/FIT via `POST /uploads`.
- New API apps are limited to a single athlete (me) until approved by Strava – fine for personal use.
- Follow Strava brand guidelines ("Connect with Strava", "Powered by Strava") if published.
- Always keep a GPX export as a non-lock-in fallback.

### CityStrides
- No public write API known. It syncs from Strava, so uploading to Strava gets runs into CityStrides automatically. Still to verify with a real run (#17).
- Whether we build our own in-app "streets I've run" view or keep relying on CityStrides is **not decided**: see #29. Building it means no app switching and the coverage data is needed for route suggestions anyway, but it is likely more complex than it looks (boundaries, partial streets, matching quality, rendering).

## Street coverage & route suggestions (Phase 4)
- Street data: OpenStreetMap (regional extract on the home server).
- Map-match GPS traces to OSM ways to know which streets are covered (approach chosen in the spike, #25: Valhalla / GraphHopper / on-phone).
- Routing/loop generation: OpenRouteService, GraphHopper or Valhalla (round-trip routes by distance), weighted towards unrun segments.
- Services run via Docker Compose on the home server (#27).

## Phases
Work items live in GitHub issues, grouped by milestone: https://github.com/Marc-Elz/run-tracker/milestones (the issue list is the source of truth, not this file).
1. **Phase 1 - MVP:** record a run (GPS, distance, pace, time), show on map, save locally in SQLite, export GPX.
2. **Phase 2 - Strava:** OAuth + upload after a run (CityStrides follows via Strava).
3. **Phase 3 - History:** run list, detail, heatmap, stats, backup, optional sync to the home server.
4. **Phase 4 - Smart features:** home server + routing services, street coverage via map-matching, then route suggestions favouring new streets.
5. **Phase 5 - Training programs:** scheduled workouts and planned vs. done tracking.

## Decisions
- Vue 3 + Capacitor for the app; native fallback only for tracking if needed.
- GitHub Issues + branches + PRs, no CI (workflow rules are in `CLAUDE.md`).
- Old laptop as home server; automatic sync to it is a nice-to-have, manual backup file comes first (#23).
- Units are metric (km, min/km).
- Personal use only, never published on the Play Store (decided 2026-10-26). The generic app id stays, and the Play Store review concerns for background location and the Strava brand guidelines do not apply. Revisit only if that changes.
- Location permission is "while using" only: the foreground service keeps GPS running with the screen off, so "Allow all the time" is not requested (#3).
- Plugins in use: `@capacitor-community/background-geolocation`, `@capacitor-community/sqlite`, `@capacitor-community/keep-awake`, `@capacitor/share` and `@capacitor/filesystem` (GPX export). The paid Transistorsoft plugin was not needed so far; the long screen-off run test (#3) is what would change that.
- Raw GPS fixes are stored unfiltered; filtering happens at read time in pure functions (#38), so the rules can change without losing data.
- Phase 1 is code-complete; the remaining boxes need device checks (#3, #5, #7, #10).

## Pending decisions
- **Strava client secret** (#12): proxy on home server vs. embedded secret vs. serverless function. To be decided later; only blocks #13.
- **In-app street coverage view** (#29): skip / minimal / full. Decide after #17 and #25.

## Open questions
- App name?

## Environment
- Dev machines: Windows 11 PCs and a Linux home dev PC. **Docker Desktop is installed on all of them.**
- Needs Node.js and Android Studio (for building/running on device) on whichever machine builds the APK.
- Docker usage plan:
  - Good fit: self-hosted backing services for later phases (routing engine such as Valhalla/GraphHopper/OSRM, Overpass/OSM extract, any small API), via `docker-compose.yml` so the setup is identical on every PC.
  - Web dev server (Vite) can run in a container too, but is optional.
  - Android builds / on-device debugging: prefer native Android Studio + adb. USB device passthrough into containers is awkward on Windows (Docker Desktop/WSL2) and fine on Linux, so don't rely on Docker for device testing.
- Keep everything cross-platform: no Windows-only paths or scripts (use npm scripts, forward slashes, LF line endings via `.gitattributes`).
