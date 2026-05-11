// ============================================================
//  app.js  –  Shared utilities used by every page
// ============================================================

/* ---------- Auth helpers ---------- */

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

/** Returns true if predictions are currently locked (global lock date has passed). */
function isPredictionLocked(settings) {
  if (!settings.locked) return false;
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
