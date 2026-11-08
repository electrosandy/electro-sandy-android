# ELECTRO Sandy

Android application for managing sales, inventory, customers, suppliers, purchases, returns, cash/bank balances and reports.

## Source layout
The Android Studio project is at the repository root:
- `app/` — Android WebView host, app assets and Firebase configuration.
- `tests/` — financial regression and static integrity tests.
- `firestore.rules` — rules to review and publish in the Firebase console.

## Build
Use Android Studio with JDK 17 and Gradle 8.9, or run:
```sh
gradle assembleDebug
```
The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

## Important
- The application ID is `com.electrosandy.app.fresh` so this build can be installed beside the previous app without overwriting its local data.
- Debug APKs are for testing and direct installation, not Google Play release distribution.
- Firebase Firestore rules must be reviewed and published separately; repository changes do not publish them.
- Cloud sync is snapshot-based, not record-level merging. Verify with two real devices before relying on automatic sync.
- Back up business data before restore or reinstall.
