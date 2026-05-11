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

/** Format a date/time string to European format (DD/MM/YYYY HH:mm). */
function formatDateToEuropean(dateStr) {
  if (!dateStr) return '';

  const raw = String(dateStr).trim();

  // ISO-like: YYYY-MM-DD[ HH:mm]
  const isoLike = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (isoLike) {
    const [, year, month, day, hour = '00', minute = '00'] = isoLike;
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`.trim();
  }

  // Slash or dash date: MM/DD/YYYY or DD/MM/YYYY (with optional HH:mm)
  const slashLike = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (slashLike) {
    const [, part1, part2, year, hour = '00', minute = '00'] = slashLike;
    const p1 = Number(part1);
    const p2 = Number(part2);

    // Prefer converting from US input (MM/DD/YYYY). If clearly already EU (DD/MM), preserve it.
    const month = p1 > 12 ? p2 : p1;
    const day = p1 > 12 ? p1 : p2;

    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`.trim();
  }

  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return raw;

  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();
  const hour = String(parsed.getHours()).padStart(2, '0');
  const minute = String(parsed.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hour}:${minute}`;
}
