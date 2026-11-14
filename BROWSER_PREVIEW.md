# ELECTRO Sandy browser preview

This preview serves the same `app/src/main/assets/www/index.html` used by the Android WebView app.

## Start

Run `npm install`, then `npm run dev -- --port 4173` and open the URL printed by Vite.

You can also open this repository branch in StackBlitz:
`https://stackblitz.com/github/electrosandy/electro-sandy-android/tree/fix/cloud-sync-storage-deletions-main`

## Scope and safety

- Browser storage belongs to the browser preview origin and is separate from the installed Android app's WebView storage.
- Use test/demo records only in the browser preview.
- The Android bridge is not available in a normal browser. Native biometric authentication, Android camera barcode scanning, Android file saving, native sharing/printing, and Firebase calls routed through the Android bridge must still be tested in the Android app on a real device.
- Browser printing and browser-based file/image selection may work through standard browser APIs, but do not prove the native Android implementation.
- This preview does not publish or change the production app, Firebase configuration, or the `main` branch.
