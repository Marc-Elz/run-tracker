# Run Tracker – Project Context

## Goal
A run-tracking mobile app for my Samsung (Android) phone. Core: record runs with GPS.
Longer-term: view routes/streets I've run, and get suggested routes so I don't repeat the same ones.
Sharing runs to Strava should be as easy as possible.

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

## Workflow
- Work is tracked in **GitHub Issues** (no TASKS.md). Types via labels: `feature`, `task`, `bug`; areas: `tracking`, `strava`, `maps`, `infra`; `decision` = needs a decision before work can start.
- Milestones = the phases below.
- Every issue is done on its own branch (`feat/<n>-slug`, `task/<n>-slug`, `docs/slug`) and merged through a PR containing `Closes #<n>`, even though this is a solo project.
- No CI on GitHub (decided). Checks run locally: `npm run type-check`, `npm run lint`, `npm run test:unit`. GitHub Free cannot enforce branch protection on private repos, so the PR habit is voluntary.
- Issue and PR templates live in `.github/`.
- Stacked PRs are fine when one issue needs another's code: base the PR on the other branch and merge in order.

## Known risks
- Samsung battery optimisation kills background apps. Need to prompt the user to exempt the app and test on the real device.
- Background location permission needs clear UX (and Play Store review if ever published).

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

## Phases and issues
1. **Phase 1 – MVP:** record a run (GPS, distance, pace, time), show on map, save locally in SQLite, export GPX.
   - #2 Vue + Capacitor scaffold, #3 background GPS, #4 live run screen, #5 SQLite storage, #6 run summary map, #7 GPX export, #10 settings/permissions screen, #11 bottom navigation
2. **Phase 2 – Strava:** OAuth + upload after a run (CityStrides follows via Strava).
   - #12 secret-handling decision, #13 OAuth login, #14 upload a run, #15 upload status/retry, #16 auto-upload and details, #17 verify CityStrides
3. **Phase 3 – History:** run list, detail, heatmap, stats, backup, optional sync.
   - #18 history list, #19 run detail, #20 rename/delete, #21 heatmap, #22 totals/stats, #23 backup/restore file, #24 automatic sync to home server (optional extra)
4. **Phase 4 – Smart features:** street coverage via map-matching, then route suggestions favouring new streets.
   - #25 map-matching spike, #26 home server setup, #27 Docker Compose for routing/OSM, #28 street coverage computation, #29 coverage view decision, #30 round-trip suggestions, #31 favour unrun streets, #32 follow a route during a run

## Decisions
- Vue 3 + Capacitor for the app; native fallback only for tracking if needed.
- GitHub Issues + branches + PRs, no CI.
- Old laptop as home server; automatic sync to it is a nice-to-have, manual backup file comes first (#23).
- Units are metric (km, min/km).

## Pending decisions
- **Strava client secret** (#12): proxy on home server vs. embedded secret vs. serverless function. To be decided later; only blocks #13.
- **In-app street coverage view** (#29): skip / minimal / full. Decide after #17 and #25.

## Open questions
- Publish on the Play Store eventually, or personal use only?
- App name?

## Environment
- Dev machines: Windows 11 PCs and a Linux home dev PC. **Docker Desktop is installed on all of them.**
- Needs Node.js and Android Studio (for building/running on device) on whichever machine builds the APK.
- Docker usage plan:
  - Good fit: self-hosted backing services for later phases (routing engine such as Valhalla/GraphHopper/OSRM, Overpass/OSM extract, any small API), via `docker-compose.yml` so the setup is identical on every PC.
  - Web dev server (Vite) can run in a container too, but is optional.
  - Android builds / on-device debugging: prefer native Android Studio + adb. USB device passthrough into containers is awkward on Windows (Docker Desktop/WSL2) and fine on Linux, so don't rely on Docker for device testing.
- Keep everything cross-platform: no Windows-only paths or scripts (use npm scripts, forward slashes, LF line endings via `.gitattributes`).
