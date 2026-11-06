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
- **Home server:** the current Linux dev laptop (Docker, 8 cores, 15 GB RAM), also called "the old laptop" in older issues, will host the routing engine, optional run sync and possibly a Strava token proxy. Needs remote access while out running (Tailscale / Cloudflare Tunnel preferred over open ports). See #26.

## Known risks
- Samsung battery optimisation kills background apps. Need to prompt the user to exempt the app and test on the real device.
- Background location permission needs clear UX (a Play Store review would apply only if the app were ever published, which is not planned).

## Integrations
### Strava
- **Phase 2 is parked (#86):** creating a Strava API application requires a paid Strava subscription (€10.99/month or €69.99/year), which is not being bought. #13–#17 stay open and `blocked`. Runs reach Strava as a GPX through the Android share sheet until that changes. The notes below describe the integration as planned, for whenever it is unparked.
- Strava API v3, OAuth2, scope `activity:write`.
- Upload GPX/FIT via `POST /uploads`.
- New API apps are limited to a single athlete (me) until approved by Strava – fine for personal use.
- Follow Strava brand guidelines ("Connect with Strava", "Powered by Strava") if published.
- Always keep a GPX export as a non-lock-in fallback.

### CityStrides
- No public write API known, and no direct GPX upload: it ingests runs through Strava or Garmin Connect. With Phase 2 - Strava parked (#86) our runs cannot reach it without a Garmin detour, so verifying the Strava path (#17) is parked too.
- It does have Node Hunter (a red dot per unfinished node) and a manual Route Builder, and it is good at city boundaries, completion percentages and street lists. It has no automatic loop over unrun streets for a target distance and no guidance during a run: that gap is what #30, #31 and #32 build.
- We compute coverage in the app ourselves, minimal scope (#29, decided 2026-11-03); see the next section.

## Street coverage & route suggestions (Phase 4)
- Street data: OpenStreetMap (regional extract on the home server).
- Map-match GPS traces to OSM ways to know which streets are covered, with self-hosted GraphHopper (chosen in the #25 spike, see #91). The comparison tooling is in `scripts/map-matching-spike/`.
- The in-app coverage view stays minimal (#29): a run vs. unrun colour layer, no boundaries, percentages or street lists. Coverage exists mainly to feed route suggestions (#31).
- Routing/loop generation: OpenRouteService, GraphHopper or Valhalla (round-trip routes by distance), weighted towards unrun segments. Not decided yet; GraphHopper will already be running for matching.
- Services run via Docker Compose on the home server (#27).

## Phases
Work items live in GitHub issues, grouped by milestone: https://github.com/Marc-Elz/run-tracker/milestones (the issue list is the source of truth, not this file).
1. **Phase 1 - MVP:** record a run (GPS, distance, pace, time), show on map, save locally in SQLite, export GPX.
1.5. **Phase 1.5 - Run experience:** make a run nicer to do, starting with audio cues (#61).
2. **Phase 2 - Strava:** OAuth + upload after a run (CityStrides follows via Strava). Parked, see #86.
3. **Phase 3 - History:** run list, detail, heatmap, stats, backup, optional sync to the home server.
4. **Phase 4 - Smart features:** home server + routing services, street coverage via map-matching, then route suggestions favouring new streets.
5. **Phase 5 - Training programs:** scheduled workouts and planned vs. done tracking.

Outside the phases, the **Refinements** milestone (created 2026-10-28) holds low-priority bugs and polish that don't block recording a run or the next feature. A bug that risks losing run data stays in the current phase.

## Decisions
- Vue 3 + Capacitor for the app; native fallback only for tracking if needed.
- GitHub Issues + branches + PRs, no CI (workflow rules are in `CLAUDE.md`).
- Dev laptop as home server; automatic sync to it is a nice-to-have, manual backup file comes first (#23).
- Units are metric (km, min/km).
- Personal use only, never published on the Play Store (decided 2026-10-26). The generic app id stays, and the Play Store review concerns for background location and the Strava brand guidelines do not apply. Revisit only if that changes.
- Location permission is "while using" only: the foreground service keeps GPS running with the screen off, so "Allow all the time" is not requested (#3).
- Plugins in use: `@capacitor-community/background-geolocation`, `@capacitor-community/sqlite`, `@capacitor-community/keep-awake`, `@capacitor/share` and `@capacitor/filesystem` (GPX export). The paid Transistorsoft plugin was not needed so far; the long screen-off run test (#3) is what would change that. `@capacitor-community/text-to-speech` joins them with the audio cues (#61, PR #72).
- Raw GPS fixes are stored unfiltered; filtering happens at read time in pure functions (#38), so the rules can change without losing data.
- Phase numbers and names stay as they are, and Phase 1.5 - Run experience was added for #61 (decided 2026-10-26). The number is not the work order: History (Phase 3) is built before Strava (Phase 2), see the next line.
- Priorities after Phase 1 (decided 2026-10-26): the primary goal is to record a run, see it in the app's history and export it to Strava. Order: close Phase 1 with one device pass and the outdoor run, then History (#18, #19, #20), then the rest of Phase 3 (backup #23 before the heatmap and stats). Strava (Phase 2) sat between them in this order until it was parked on 2026-11-03 (#86). Audio cues (#61, Phase 1.5) are wanted and get planned once the Phase 1 gate is closed. Phase 4 is lower priority: it is where the app gets more interesting, but it starts only after the map-matching spike (#25) and the #29 decision. Phase 5 is parked.
- Strava client secret (#12, decided 2026-11-03): a small token-exchange proxy as a serverless function (free tier), so the secret never ships in the app or the repo. The app only knows a proxy URL with two calls (exchange the code, refresh the token), so the proxy can move to the home server later (#26) by changing the URL. Uploads go straight from the app to Strava.
- No shoe or gear tracking. Strava offers it as an optional field, but I don't use it.
- Phase 1 is code-complete; the remaining boxes need device checks (#3, #5, #7, #10).
- With the screen off, Android froze the WebView's JavaScript about a minute later (found on the phone during #61), stalling the run timer, GPS fix handling and spoken cues. While a run is on, `RunPowerPlugin.setKeepWebViewAlive` keeps the page running (PR #72, verified on the phone for 5 min with the screen off, #73). If this stops working on a phone or Android version, the fallback is moving cue timing and speech into native code. Audio cues use `localStorage` for their two settings and a native audio-focus request so music ducks during a cue.
- Phase 2 - Strava is parked (decided 2026-11-03, #86): creating a Strava API application requires a paid Strava subscription (€10.99/month or €69.99/year; the API itself is free once the app exists), and that is not worth it for a personal app whose runs already reach Strava as a GPX through the share sheet (#7, #20). #13–#17 stay open and `blocked`, waiting on a subscription rather than on code. The #12 serverless token-proxy decision stands for whenever it is unparked.
- In-app street coverage (#29, decided 2026-11-03): build it ourselves, minimal scope - map-matched coverage plus a run vs. unrun colour layer, no boundaries, percentages or street lists. The data is needed for route suggestions (#31) anyway, the heatmap (#21) draws GPS traces and so can never show an unrun street, and CityStrides can no longer receive our runs now that Strava is parked (#86). The boundaries-and-stats part is what CityStrides does well and #31 does not need; add it later only if I want it.
- Map matching (#91, decided 2026-11-04, from the #25 spike): self-hosted GraphHopper. On 4 real walks reviewed by hand it followed the walked route most closely and did not claim a street I had turned back on, which Valhalla did. On-phone matching was rejected on paper, and hosted APIs because I want to run and understand the service myself, it fits the home server plan, and traces stay on my own machine. Expect some credit for a nearby way; based on walks only, so revisit if real runs match noticeably worse.
- Training programs (#95, decided 2026-11-06): a week/session template like a Run2Day schedule (weeks 1..N, ordered sessions of structured steps), not a dated agenda. Sessions have no calendar date, so a missed day needs no rescheduling; the next undone session is the one to run (#40). A comeback run after a gap is #96.

## Pending decisions
- **Voice quality for audio cues** (#75): keep the system voice / pick an installed voice in Settings / bundled clips / cloud TTS.
- **How much run recording moves to native code** (#83): decide on the screen-off evidence from #73.

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
