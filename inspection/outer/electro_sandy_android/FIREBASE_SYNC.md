# ELECTRO Sandy — Firebase sync

## Firebase project
- Project ID: `electro-sandy`
- Android application ID: `com.electrosandy.app.fresh`
- Authentication: Email/Password
- Database: Cloud Firestore (Standard)

## Security rules
The `firestore.rules` file limits each signed-in account to its own `shops/{uid}` data. It accepts exactly the 12 synchronization categories, validates snapshot metadata and chunk sizes, and denies access outside the shop snapshot paths. The Java layer additionally verifies chunk indexes, IDs, uniqueness, and completeness before publishing or restoring a snapshot.

The repository rules file is **not automatically published** to Firebase when this repository changes. The live Firebase rules must be reviewed and published separately. Never replace them with public/test-mode rules.

## What is synchronized
The app synchronizes these 12 work-data categories:
- Products, orders, customers, purchases
- Cash entries and cash closings
- Stock audits, seller profile, activity log
- Warranties, suppliers, returns

Local PINs, local user accounts, biometric settings, device preferences, and local backup history are intentionally excluded.

## Manual upload and restore
- A manual upload publishes a new snapshot only after all 12 categories and every chunk have been verified.
- Restore validates the snapshot structure and chunk completeness before replacing local work records.
- Export a local backup before manual restore because restore replaces the corresponding work data on this device.
- Cloud snapshots are retained. Automatic deletion is disabled to avoid accidentally deleting a recovery point; storage usage and a safe retention policy need separate review.

## Optional automatic synchronization
Automatic synchronization is opt-in and device-specific:
1. Sign in to the Firebase sync account as an administrator.
2. Perform the first manual upload or restore to establish the device's base snapshot.
3. Enable automatic synchronization on that device.
4. Local changes to the watched work-data categories are marked dirty and uploaded after a debounce period (about 25 seconds after the latest change).
5. While the app is active and the Firebase listener receives a newer cloud snapshot, the app downloads it automatically only when there are no pending local changes and automatic synchronization is enabled.

The device stores the Firebase account UID associated with its baseline. Signing in to a different account disables automatic synchronization and requires a fresh manual upload or restore before automatic synchronization can be enabled again. The upload uses a Firestore transaction to compare the cloud pointer with the device's known base snapshot. If another device has already published a newer snapshot, the transaction rejects the stale upload rather than overwriting that newer pointer. If local and remote changes conflict, automatic synchronization pauses and asks the user to review the data.

## Important limitations
- This is not a record-by-record merge engine. Simultaneous changes are detected as a conflict; they are not automatically merged.
- The Firestore listener is active only while the app session is running. This is not background synchronization after the app is closed.
- The automatic-sync code has not been considered production-verified until it has passed an Android build and real-device tests with at least two devices/accounts as applicable.
- The app's Android system backup is disabled in the manifest to reduce the risk of backing up local business data and PIN-related app storage. Use the app's explicit export and Firebase backup features instead.
- A JavaScript syntax check does not prove that the Android project compiles or that Firebase operations work at runtime.

## Validation checklist
Before treating automatic synchronization as production-ready, verify:
- A clean build of the Android project.
- Manual upload and restore after the latest app changes.
- Automatic upload after a local sale, purchase, and stock change.
- Automatic download of a remote update while the receiving app is open and has no local pending edits.
- Conflict detection when both devices have local changes.
- Logout, login, and app restart without stale listeners or duplicate uploads.
- Restore rollback behavior when local storage is full or cloud data is incomplete.
