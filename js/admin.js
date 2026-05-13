// ============================================================
//  admin.js  –  Logic for admin.html
// ============================================================

const API_BASE = 'https://resultsapi.philip-hultgren.workers.dev';
let adminUser = null;
let removeUserModal = null;

(async () => {
  adminUser = await requireAuth();
  if (!adminUser.isAdmin) {
    alert('Access denied. Admins only.');
    window.location.href = 'predictions.html';
    return;
  }
  buildNav(adminUser.username, true);
  await loadCurrentSettings();
})();

// ── Load existing settings ──────────────────────────────
async function loadCurrentSettings() {
  const settings = await loadSettings();
  const pad = n => String(n).padStart(2, '0');
  
  if (settings.groupLockDate) {
    const d = settings.groupLockDate.toDate();
    document.getElementById('group-lock-date').value =
      `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  
  if (settings.knockoutLockDate) {
    const d = settings.knockoutLockDate.toDate();
    document.getElementById('knockout-lock-date').value =
      `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  
  document.getElementById('locked-toggle').checked = !!settings.locked;
  if (settings.apiToken) {
    document.getElementById('api-token-input').value = settings.apiToken;
  }
}

// ── Lock settings ───────────────────────────────────────
async function saveLockSettings() {
  const groupLockVal    = document.getElementById('group-lock-date').value;
  const knockoutLockVal = document.getElementById('knockout-lock-date').value;
  const locked          = document.getElementById('locked-toggle').checked;
  const update          = { locked };
  
  if (groupLockVal) {
    update.groupLockDate = firebase.firestore.Timestamp.fromDate(new Date(groupLockVal));
  }
  if (knockoutLockVal) {
    update.knockoutLockDate = firebase.firestore.Timestamp.fromDate(new Date(knockoutLockVal));
  }
  
  await db.collection('config').doc('settings').set(update, { merge: true });
  showToast('Lock settings saved.');
}

// ── API Token ───────────────────────────────────────────
async function apiRegister() {
  const name     = document.getElementById('api-name').value.trim();
  const email    = document.getElementById('api-email').value.trim();
  const password = document.getElementById('api-password').value;
  if (!name || !email || !password) { showToast('Fill in name, email, password first.', 'warning'); return; }
  const res = await safeApiFetch(`${API_BASE}/auth/register`, 'POST', { name, email, password });
  if (res?.token) {
    document.getElementById('api-token-input').value = res.token;
    document.getElementById('api-token-result').textContent = '✅ Registered & token received!';
  } else if ((res?.message || '').toLowerCase().includes('already')) {
    document.getElementById('api-token-result').textContent = 'ℹ️ Account already exists. Trying login...';
    await apiLogin();
  } else if (res === null || res?.rawText === 'null') {
    // Some API instances return literal "null" for duplicate/invalid register attempts.
    document.getElementById('api-token-result').textContent = 'ℹ️ Register returned null. Trying login with the same email/password...';
    await apiLogin();
  } else {
    const msg = res?.message || res?.rawText || `HTTP ${res?.status || 'unknown'} from API`;
    document.getElementById('api-token-result').textContent = '⚠️ ' + msg;
  }
}

async function apiLogin() {
  const email    = document.getElementById('api-email').value.trim();
  const password = document.getElementById('api-password').value;
  if (!email || !password) { showToast('Enter email and password.', 'warning'); return; }
  const res = await safeApiFetch(`${API_BASE}/auth/authenticate`, 'POST', { email, password });
  if (res?.token) {
    document.getElementById('api-token-input').value = res.token;
    document.getElementById('api-token-result').textContent = '✅ Logged in, token received!';
  } else {
    const msg = res?.message || res?.rawText || `HTTP ${res?.status || 'unknown'} from API`;
    document.getElementById('api-token-result').textContent = '⚠️ ' + msg;
  }
}

async function saveApiToken() {
  const token = document.getElementById('api-token-input').value.trim();
  if (!token) { showToast('Token is empty.', 'warning'); return; }
  await db.collection('config').doc('settings').set({ apiToken: token }, { merge: true });
  showToast('API token saved.');
}

// ── Initialize ALL matches from API ─────────────────────
async function initMatchesFromApi() {
  const token = document.getElementById('api-token-input').value.trim();
  if (!token) { showToast('Save an API token first.', 'warning'); return; }
  setApiStatus('⏳ Fetching teams and matches…');

  const [teamsData, gamesData] = await Promise.all([
    safeApiFetch(`${API_BASE}/get/teams`, 'GET', null, token),
    safeApiFetch(`${API_BASE}/get/games`, 'GET', null, token)
  ]);

  if (!teamsData || !gamesData) {
    setApiStatus('❌ Failed to fetch data from API. Check token and try again.');
    return;
  }

  // Build team lookup map (id → team object)
  const teams = {};
  const teamList = extractList(teamsData, ['teams', 'data', 'results', 'items']);
  teamList.forEach(t => { teams[String(t.id)] = t; });

  // Map API type → our type
  const typeMap = {
    'group': 'group',
    'round_of_32': 'round32', 'r32': 'round32',
    'round_of_16': 'round16', 'r16': 'round16',
    'quarter_final': 'qf', 'quarterfinal': 'qf',
    'semi_final': 'sf', 'semifinal': 'sf',
    'final': 'final'
  };

  const gameList = extractList(gamesData, ['games', 'data', 'matches', 'results', 'items']);
  if (gameList.length === 0) { setApiStatus('❌ No games returned from API.'); return; }

  setApiStatus(`⏳ Writing ${gameList.length} matches to Firestore…`);

  // Batch write in chunks of 400
  const CHUNK = 400;
  for (let i = 0; i < gameList.length; i += CHUNK) {
    const batch = db.batch();
    for (const g of gameList.slice(i, i + CHUNK)) {
      const homeTeamObj = teams[String(g.home_team_id)] || {};
      const awayTeamObj = teams[String(g.away_team_id)] || {};
      const docRef = db.collection('matches').doc(String(g.id));
      const actualHome = toMaybeNumber(g.home_score);
      const actualAway = toMaybeNumber(g.away_score);
      const finished = toBool(g.finished);
      batch.set(docRef, {
        id:       String(g.id),
        homeTeam: g.home_team_name_en || homeTeamObj.name_en || `Team ${g.home_team_id}`,
        awayTeam: g.away_team_name_en || awayTeamObj.name_en || `Team ${g.away_team_id}`,
        homeFlag: homeTeamObj.flag   || '',
        awayFlag: awayTeamObj.flag   || '',
        group:    g.group  || '',
        type:     typeMap[String(g.type).toLowerCase()] || g.type || 'group',
        matchday: Number(g.matchday) || 0,
        date:     g.local_date || '',
        actualHome,
        actualAway,
        finished,
        sortOrder:  Number(g.id) || 0
      }, { merge: false });
    }
    await batch.commit();
  }
  setApiStatus(`✅ ${gameList.length} matches initialized!`);
  showToast(`${gameList.length} matches loaded into Firestore.`);
}

// ── Sync live scores from API ────────────────────────────
async function syncScoresFromApi() {
  const token = document.getElementById('api-token-input').value.trim();
  if (!token) { showToast('Save an API token first.', 'warning'); return; }
  setApiStatus('⏳ Syncing scores…');

  const gamesData = await safeApiFetch(`${API_BASE}/get/games`, 'GET', null, token);
  if (!gamesData) { setApiStatus('❌ Failed to fetch games.'); return; }

  const gameList = extractList(gamesData, ['games', 'data', 'matches', 'results', 'items']);
  let updated = 0;
  const CHUNK = 400;
  for (let i = 0; i < gameList.length; i += CHUNK) {
    const batch = db.batch();
    for (const g of gameList.slice(i, i + CHUNK)) {
      const docRef = db.collection('matches').doc(String(g.id));
      batch.set(docRef, {
        actualHome: toMaybeNumber(g.home_score),
        actualAway: toMaybeNumber(g.away_score),
        finished:   toBool(g.finished)
      }, { merge: true });
      updated++;
    }
    await batch.commit();
  }
  await db.collection('config').doc('settings').set(
    { lastSync: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  setApiStatus(`✅ Synced ${updated} match scores.`);
  showToast('Scores synced!');
}

// ── Manual score entry ──────────────────────────────────
async function saveManualScore() {
  const matchId  = document.getElementById('manual-match-id').value.trim();
  const home     = parseInt(document.getElementById('manual-home').value, 10);
  const away     = parseInt(document.getElementById('manual-away').value, 10);
  const finished = document.getElementById('manual-finished').checked;
  if (!matchId) { showToast('Enter a match ID.', 'warning'); return; }
  if (isNaN(home) || isNaN(away)) { showToast('Enter valid scores.', 'warning'); return; }
  await db.collection('matches').doc(matchId).set(
    { actualHome: home, actualAway: away, finished }, { merge: true });
  document.getElementById('manual-status').textContent = `✅ Match ${matchId} updated.`;
  showToast(`Match ${matchId} score saved.`);
}

// ── User Management ─────────────────────────────────────
async function loadUsers() {
  const snap = await db.collection('users').get();
  const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));

  const matchSnap = await db.collection('matches').get();
  const totalMatches = matchSnap.size;

  const usersWithStats = await Promise.all(users.map(async (u) => {
    const predSnap = await db.collection('predictions').doc(u.uid).collection('matches').get();
    const totalPredictions = predSnap.size;
    let completedPredictions = 0;

    predSnap.forEach((doc) => {
      const p = doc.data() || {};
      if (p.home !== null && p.away !== null && p.home !== undefined && p.away !== undefined && p.home !== '' && p.away !== '') {
        completedPredictions++;
      }
    });

    return {
      ...u,
      totalPredictions,
      completedPredictions,
      hasStarted: totalPredictions > 0,
      isFullyComplete: totalMatches > 0 && completedPredictions >= totalMatches
    };
  }));

  const startedCount = usersWithStats.filter(u => u.hasStarted).length;
  const completedCount = usersWithStats.filter(u => u.isFullyComplete).length;

  document.getElementById('users-summary').innerHTML = `
    <div class="alert alert-info mb-0">
      <strong>Accounts:</strong> ${usersWithStats.length}
      &nbsp;|&nbsp; <strong>Started predictions:</strong> ${startedCount}
      &nbsp;|&nbsp; <strong>Completed all matches:</strong> ${completedCount}
      &nbsp;|&nbsp; <strong>Total matches loaded:</strong> ${totalMatches}
    </div>`;

  const rows = usersWithStats.map(u => `
    <tr>
      <td>${escHtml(u.username || '—')}</td>
      <td>${escHtml(u.uid)}</td>
      <td>${u.isAdmin ? '✅ Admin' : 'User'}</td>
      <td>${u.completedPredictions}/${totalMatches || 0}</td>
      <td>${u.hasStarted ? (u.isFullyComplete ? '✅ Complete' : '🟡 In progress') : '—'}</td>
      <td>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-outline-${u.isAdmin ? 'danger' : 'success'}"
                  onclick="toggleAdmin('${u.uid}', ${!u.isAdmin})">
            ${u.isAdmin ? 'Remove Admin' : 'Make Admin'}
          </button>
          <button class="btn btn-sm btn-outline-danger"
                  onclick="openRemoveUserModal('${u.uid}', '${escHtml(u.username || '—')}')"
                  ${u.uid === adminUser.uid ? 'disabled title="You cannot remove your own account."' : ''}>
            Remove User
          </button>
        </div>
      </td>
    </tr>`).join('');

  document.getElementById('users-table').innerHTML = `
    <table class="table table-sm">
      <thead><tr><th>Username</th><th>UID</th><th>Role</th><th>Predictions</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function toggleAdmin(uid, makeAdmin) {
  await db.collection('users').doc(uid).update({ isAdmin: makeAdmin });
  showToast(`User updated.`);
  loadUsers();
}

function openRemoveUserModal(uid, username) {
  document.getElementById('remove-user-uid').value = uid;
  document.getElementById('remove-user-label').textContent = `${username} (${uid})`;

  if (!removeUserModal) {
    removeUserModal = new bootstrap.Modal(document.getElementById('remove-user-modal'));
  }
  removeUserModal.show();
}

async function confirmRemoveUser() {
  const uid = document.getElementById('remove-user-uid').value;
  if (!uid) return;
  if (uid === adminUser.uid) {
    showToast('You cannot remove your own account.', 'warning');
    return;
  }

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const username = userSnap.exists ? (userSnap.data()?.username || '') : '';

  const predSnap = await db.collection('predictions').doc(uid).collection('matches').get();
  if (!predSnap.empty) {
    const CHUNK = 400;
    const docs = predSnap.docs;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = db.batch();
      for (const d of docs.slice(i, i + CHUNK)) {
        batch.delete(d.ref);
      }
      await batch.commit();
    }
  }

  await db.collection('predictions').doc(uid).delete().catch(() => {});

  if (username) {
    await db.collection('usernames').doc(String(username).toLowerCase()).delete().catch(() => {});
  } else {
    const usernameSnap = await db.collection('usernames').where('uid', '==', uid).get();
    if (!usernameSnap.empty) {
      const CHUNK = 400;
      const docs = usernameSnap.docs;
      for (let i = 0; i < docs.length; i += CHUNK) {
        const batch = db.batch();
        for (const d of docs.slice(i, i + CHUNK)) {
          batch.delete(d.ref);
        }
        await batch.commit();
      }
    }
  }

  await userRef.delete();

  if (removeUserModal) removeUserModal.hide();
  showToast('User removed.');
  await loadUsers();
}

// ── Helpers ─────────────────────────────────────────────
function setApiStatus(msg) {
  document.getElementById('api-status').textContent = msg;
}

async function safeApiFetch(url, method, body, token) {
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body)  opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { rawText: text };
    }
    if (!res.ok) {
      return {
        status: res.status,
        message: data?.message || data?.error || data?.rawText || res.statusText,
        rawText: data?.rawText || text
      };
    }
    return data;
  } catch (ex) {
    setApiStatus('❌ Network error: ' + ex.message);
    return { message: 'Network error: ' + ex.message };
  }
}

function extractList(payload, keys) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  // Some endpoints can wrap one level deeper, e.g. { teams: { teams: [...] } }
  for (const key of keys) {
    const nested = payload[key];
    if (nested && typeof nested === 'object') {
      for (const nestedKey of keys) {
        if (Array.isArray(nested[nestedKey])) return nested[nestedKey];
      }
    }
  }
  return [];
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes' || v === 'finished';
  }
  return false;
}

function toMaybeNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === '' || v === 'null' || v === 'undefined' || v === '-') return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
