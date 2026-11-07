# ELECTRO Sandy — Firebase sync

## Firebase project
- Project ID: `electro-sandy`
- Android application ID: `com.electrosandy.app.fresh`
- Authentication: Email/Password
- Database: Cloud Firestore (Standard)

## Security rules
The `firestore.rules` file limits each signed-in account to its own `shops/{uid}` data and validates snapshot categories, metadata, and chunk sizes. The repository rules file is **not automatically published** to Firebase when this repository changes.

To publish it with the Firebase CLI, run from this Android project directory:

```sh
firebase deploy --only firestore:rules
```

Review the rules in the Firebase console after deployment. Do not replace them with public/test-mode rules.

## What is synchronized
The app uploads and restores manual snapshots for:
- Products, orders, customers, purchases
- Cash entries and cash closings
- Stock audits, seller profile, activity log
- Warranties, suppliers, returns

Local PINs, local user accounts, biometric settings, device preferences, and local backup history are intentionally excluded.

## Snapshot safety
- Data is split into small Firestore documents.
- A snapshot is published as current only after all 12 categories and every chunk have been verified.
- Restore checks chunk completeness and validates the parsed data before replacing local records.
- Restore should be preceded by exporting a local backup.
- Snapshots are retained in Firestore. Automatic deletion is intentionally not enabled: deleting nested Firestore collections incorrectly could destroy a valid recovery point. Review storage usage before defining a retention policy.

## Important limitation
This is **manual upload/restore**, not continuous real-time two-way synchronization. Two devices can each upload; the most recently committed snapshot becomes current. There is no automatic conflict merge.

The Firebase rules and app changes must still be tested against the live Firebase project and a real Android installation. A JavaScript syntax check alone does not prove the Android project compiles or that Firebase operations work at runtime.
