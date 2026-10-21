# Run Tracker

Run-tracking Android app built with Vue 3 + Capacitor. See [context.md](context.md) for goals and decisions.

## Prerequisites (Windows and Linux)
- Node.js 20+ and npm
- Android Studio (includes the Android SDK and a JDK)
- USB debugging enabled on the phone (Settings > Developer options), `adb` on your PATH

## Develop
```sh
npm install
npm run dev            # web dev server in the browser
npm run type-check
npm run lint
npm run test:unit
```

## Run on a device
```sh
npm run android:run    # build web app, sync to Android, install and launch on a connected device
npm run android:open   # or open the project in Android Studio
```

Run `npm run android:sync` after changing web code or installing Capacitor plugins.
