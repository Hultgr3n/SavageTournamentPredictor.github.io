#!/usr/bin/env node

/**
 * One-time migration utility:
 * Backfill Firestore /users docs from Firebase Authentication users.
 *
 * Safety:
 * - Only writes to collection 'users'.
 * - Uses { merge: true } so existing fields are preserved.
 * - Does not modify predictions, matches, config, or usernames.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import admin from 'firebase-admin';

function sanitizeUsernameCandidate(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, '')
    .slice(0, 20);
}

function usernameFromAuthUser(userRecord) {
  const emailPrefix = String(userRecord.email || '').split('@')[0] || '';
  const clean = sanitizeUsernameCandidate(emailPrefix);
  if (clean.length >= 3) return clean;
  return `user-${String(userRecord.uid).slice(0, 8)}`;
}

function parseArgs(argv) {
  const args = { projectId: '', serviceAccountPath: '' };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--project' || v === '-p') args.projectId = argv[i + 1] || '';
    if (v === '--service-account' || v === '-s') args.serviceAccountPath = argv[i + 1] || '';
  }
  return args;
}

async function* listAllAuthUsers(auth) {
  let nextPageToken;
  do {
    const page = await auth.listUsers(1000, nextPageToken);
    for (const user of page.users) {
      yield user;
    }
    nextPageToken = page.pageToken;
  } while (nextPageToken);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.serviceAccountPath) {
    console.error('Missing --service-account <path-to-service-account-json>');
    process.exit(1);
  }

  const absServiceAccount = path.resolve(args.serviceAccountPath);
  if (!fs.existsSync(absServiceAccount)) {
    console.error(`Service account file not found: ${absServiceAccount}`);
    process.exit(1);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(absServiceAccount, 'utf8'));
  const projectId = args.projectId || serviceAccount.project_id;

  if (!projectId) {
    console.error('Project ID could not be determined. Pass --project <project-id>.');
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId
  });

  const db = admin.firestore();
  const auth = admin.auth();

  let seen = 0;
  let createdOrUpdated = 0;

  let batch = db.batch();
  let ops = 0;

  for await (const user of listAllAuthUsers(auth)) {
    seen++;
    const userRef = db.collection('users').doc(user.uid);

    const payload = {
      username: usernameFromAuthUser(user),
      isAdmin: false,
      authBackfill: true,
      authBackfillAt: admin.firestore.FieldValue.serverTimestamp()
    };

    batch.set(userRef, payload, { merge: true });
    ops++;
    createdOrUpdated++;

    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) {
    await batch.commit();
  }

  console.log(`Auth users scanned: ${seen}`);
  console.log(`Firestore users docs merged: ${createdOrUpdated}`);
  console.log('Done.');
}

main().catch((err) => {
  console.error('Backfill failed:', err?.message || err);
  process.exit(1);
});
