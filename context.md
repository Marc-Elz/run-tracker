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
- No public write API known. It syncs from Strava, so uploading to Strava gets runs into CityStrides automatically. (Verify on their site.)
- Therefore: don't build our own "streets run" view initially; rely on CityStrides.

## Later: street coverage & route suggestions
- Street data: OpenStreetMap (Overpass API or regional extract).
- Map-match GPS traces to OSM ways to know which streets are covered.
- Routing/loop generation: OpenRouteService, GraphHopper or Valhalla (round-trip routes by distance), weighted towards unrun segments.

## Phases
1. **MVP:** record run (GPS, distance, pace, time), show on map, save locally in SQLite, export GPX.
2. **Strava:** OAuth + automatic upload after a run (CityStrides follows for free).
3. **History:** run list + heatmap of past routes.
4. **Smart features:** street coverage via map-matching, then route suggestions favouring new streets.

## Open questions
- Publish on the Play Store eventually, or personal use only?
- App name?
- Units/locale (km, min/km) – assume metric.

## Environment
- Windows 11, dev folder `C:\Users\Marc-E\Documents\projects\run-tracker`
- Needs Node.js and Android Studio (for building/running on device).
