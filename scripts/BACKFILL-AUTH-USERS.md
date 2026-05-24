# Backfill Firestore users from Firebase Auth

Use this one-time script if accounts exist in Firebase Authentication but are missing from Firestore `users`.

This script is safe for your requirement:
- It only writes to `users/{uid}`.
- It does not modify predictions, matches, config, or leaderboard entries directly.
- Existing `users` docs are merged (not replaced).

## Prerequisites

1. Download a Firebase service account key JSON for your project from Google Cloud Console.
2. Have Node.js 18+ installed.

## Run

From project root:

```bash
npm install firebase-admin
node scripts/backfill-auth-users.mjs --service-account ./service-account.json --project savage-tournament-predictor
```

If `--project` is omitted, project ID is read from the service account file.

## After run

1. Open Admin page and click Load Users.
2. Open Leaderboard and confirm all accounts appear.

## Notes

- Usernames are generated from email prefix when missing.
- You can manually rename usernames in Firestore afterwards if needed.
