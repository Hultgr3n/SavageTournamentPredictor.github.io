// ============================================================
//  app.js  –  Shared utilities used by every page
// ============================================================

/* ---------- Auth helpers ---------- */

function sanitizeUsernameCandidate(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_\-]/g, '')
    .slice(0, 20);
}

function usernameFromAuthUser(user) {
  if (!user) return '';
  const fromEmail = String(user.email || '').split('@')[0] || '';
  const clean = sanitizeUsernameCandidate(fromEmail);
  if (clean.length >= 3) return clean;
  return `user-${String(user.uid || '').slice(0, 8)}`;
}

/**
 * Ensure logged-in users have a profile in /users and a registry entry in /usernames.
 * This safely backfills legacy accounts missing profile records.
 */
async function ensureLoggedInUserProfile(user, preferredUsername = '') {
  if (!user || !user.uid) return null;

  const uid = user.uid;
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const existing = userSnap.exists ? (userSnap.data() || {}) : {};

  let username = sanitizeUsernameCandidate(preferredUsername);
  if (!username) username = sanitizeUsernameCandidate(existing.username || '');

  if (!username) {
    const usernameSnap = await db.collection('usernames').where('uid', '==', uid).limit(1).get();
    if (!usernameSnap.empty) {
      username = sanitizeUsernameCandidate(usernameSnap.docs[0].id);
    }
  }

  if (!username) username = usernameFromAuthUser(user);

  const profileUpdate = { username };
  if (!userSnap.exists) {
    profileUpdate.isAdmin = false;
    profileUpdate.createdAt = firebase.firestore.FieldValue.serverTimestamp();
  }
  await userRef.set(profileUpdate, { merge: true });

  const normalized = username.toLowerCase();
  if (normalized) {
    const regRef = db.collection('usernames').doc(normalized);
    const regSnap = await regRef.get();
    const regUid = regSnap.exists ? (regSnap.data() || {}).uid : null;

    if (!regSnap.exists) {
      await regRef.set({ uid });
    } else if (!regUid) {
      await regRef.set({ uid }, { merge: true });
    }
  }

  return username;
}

/**
 * Require login. If not logged in, redirect to index.html.
 * Returns a Promise<{uid, username, isAdmin}>.
 */
function requireAuth() {
  return new Promise((resolve) => {
    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        window.location.href = 'index.html';
        return;
      }
      try {
        await ensureLoggedInUserProfile(user);
      } catch (err) {
        console.error('Profile self-heal failed:', err);
      }
      // Track last login time (fire-and-forget)
      db.collection('users').doc(user.uid)
        .set({ lastLogin: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
        .catch(err => console.warn('lastLogin update failed:', err));
      const snap = await db.collection('users').doc(user.uid).get();
      const data = snap.data() || {};
      resolve({ uid: user.uid, username: data.username || user.email, isAdmin: !!data.isAdmin });
    });
  });
}

/** Build the top navigation bar. Call from each page after requireAuth. */
function buildNav(username, isAdmin) {
  const nav = document.getElementById('app-nav');
  if (!nav) return;
  nav.innerHTML = `
    <nav class="navbar navbar-dark bg-success navbar-expand-sm px-3">
      <a class="navbar-brand fw-bold" href="predictions.html">⚽ Savage Predictor 2026</a>
      <div class="collapse navbar-collapse">
        <ul class="navbar-nav ms-auto align-items-center gap-2">
          <li class="nav-item"><a class="nav-link" href="predictions.html">Predictions</a></li>
          <li class="nav-item"><a class="nav-link" href="leaderboard.html">Leaderboard</a></li>
          ${isAdmin ? '<li class="nav-item"><a class="nav-link" href="admin.html">Admin</a></li>' : ''}
          <li class="nav-item">
            <span class="text-light me-2">👤 ${escHtml(username)}</span>
            <button class="btn btn-outline-light btn-sm" onclick="signOut()">Logout</button>
          </li>
        </ul>
      </div>
    </nav>`;
}

function signOut() {
  auth.signOut().then(() => { window.location.href = 'index.html'; });
}

/* ---------- Scoring ---------- */

/**
 * Calculate points for a single match prediction vs actual result.
 * Returns null if the match isn't finished yet.
 * Max 3 pts: 1 for each correct goal total, 1 for correct outcome (W/D/L).
 */
function calcPoints(predHome, predAway, actHome, actAway, finished) {
  if (!finished || actHome === null || actAway === null) return null;
  if (predHome === null || predAway === null || predHome === undefined || predAway === undefined) return null;
  let pts = 0;
  if (Number(predHome) === Number(actHome)) pts++;
  if (Number(predAway) === Number(actAway)) pts++;
  const outcome = (h, a) => h > a ? 'H' : h < a ? 'A' : 'D';
  if (outcome(predHome, predAway) === outcome(actHome, actAway)) pts++;
  return pts;
}

/* ---------- Misc ---------- */

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:1rem;right:1rem;z-index:9999;';
    document.body.appendChild(container);
  }
  const id = 'toast-' + Date.now();
  container.insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast align-items-center text-bg-${type} border-0 show mb-2" role="alert">
      <div class="d-flex">
        <div class="toast-body">${escHtml(msg)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`);
  setTimeout(() => document.getElementById(id)?.remove(), 3500);
}

/** Load settings doc from Firestore. */
async function loadSettings() {
  const snap = await db.collection('config').doc('settings').get();
  return snap.exists ? snap.data() : {};
}

/** Returns true if predictions are currently locked (supports stage-specific locks). */
function isPredictionLocked(settings, stage = null) {
  // Global override lock
  if (settings.locked) return true;

  // Stage-specific locks (group or knockout)
  if (stage === 'group' && settings.groupLockDate) {
    return new Date() >= settings.groupLockDate.toDate();
  }
  if (stage === 'knockout' && settings.knockoutLockDate) {
    return new Date() >= settings.knockoutLockDate.toDate();
  }

  // Legacy support: if old lockDate exists, use it for backward compatibility
  if (settings.lockDate) {
    return new Date() >= settings.lockDate.toDate();
  }

  return false;
}

/** Format a Firestore Timestamp or Date nicely. */
function fmtDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Format a date/time string to European format (DD/MM/YYYY HH:mm). */
function formatDateToEuropean(dateStr) {
  if (!dateStr) return '';
  const parsed = new Date(String(dateStr).trim());
  if (isNaN(parsed.getTime())) return String(dateStr);
  // Display in Central European (Summer) Time — UTC+2 in summer, UTC+1 in winter.
  // Intl.DateTimeFormat handles DST automatically.
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(parsed);
  const p = {};
  for (const { type, value } of parts) p[type] = value;
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}
