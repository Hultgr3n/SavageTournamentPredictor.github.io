// ============================================================
//  admin.js  –  Logic for admin.html
// ============================================================

const API_BASE = 'https://worldcup26.ir';
let adminUser = null;

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
  if (settings.lockDate) {
    // Convert Firestore Timestamp → datetime-local value
    const d = settings.lockDate.toDate();
    const pad = n => String(n).padStart(2, '0');
    document.getElementById('lock-date').value =
      `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  document.getElementById('locked-toggle').checked = !!settings.locked;
  if (settings.apiToken) {
    document.getElementById('api-token-input').value = settings.apiToken;
  }
}

// ── Lock settings ───────────────────────────────────────
async function saveLockSettings() {
  const dateVal = document.getElementById('lock-date').value;
  const locked  = document.getElementById('locked-toggle').checked;
  const update  = { locked };
  if (dateVal) {
    update.lockDate = firebase.firestore.Timestamp.fromDate(new Date(dateVal));
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
  } else {
    document.getElementById('api-token-result').textContent = '⚠️ ' + (res?.message || JSON.stringify(res));
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
    document.getElementById('api-token-result').textContent = '⚠️ ' + (res?.message || JSON.stringify(res));
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
  const teamList = Array.isArray(teamsData) ? teamsData : teamsData.data || [];
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

  const gameList = Array.isArray(gamesData) ? gamesData : gamesData.data || [];
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
      batch.set(docRef, {
        id:       String(g.id),
        homeTeam: homeTeamObj.name_en || `Team ${g.home_team_id}`,
        awayTeam: awayTeamObj.name_en || `Team ${g.away_team_id}`,
        homeFlag: homeTeamObj.flag   || '',
        awayFlag: awayTeamObj.flag   || '',
        group:    g.group  || '',
        type:     typeMap[String(g.type).toLowerCase()] || g.type || 'group',
        matchday: Number(g.matchday) || 0,
        date:     g.local_date || '',
        actualHome: g.home_score !== undefined ? Number(g.home_score) : null,
        actualAway: g.away_score !== undefined ? Number(g.away_score) : null,
        finished:   !!g.finished,
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

  const gameList = Array.isArray(gamesData) ? gamesData : gamesData.data || [];
  let updated = 0;
  const CHUNK = 400;
  for (let i = 0; i < gameList.length; i += CHUNK) {
    const batch = db.batch();
    for (const g of gameList.slice(i, i + CHUNK)) {
      const docRef = db.collection('matches').doc(String(g.id));
      batch.update(docRef, {
        actualHome: g.home_score !== undefined ? Number(g.home_score) : null,
        actualAway: g.away_score !== undefined ? Number(g.away_score) : null,
        finished:   !!g.finished
      }).catch(() => {});  // ignore if doc doesn't exist yet
      updated++;
    }
    await batch.commit().catch(() => {});
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

  const rows = users.map(u => `
    <tr>
      <td>${escHtml(u.username || '—')}</td>
      <td>${escHtml(u.uid)}</td>
      <td>${u.isAdmin ? '✅ Admin' : 'User'}</td>
      <td>
        <button class="btn btn-sm btn-outline-${u.isAdmin ? 'danger' : 'success'}"
                onclick="toggleAdmin('${u.uid}', ${!u.isAdmin})">
          ${u.isAdmin ? 'Remove Admin' : 'Make Admin'}
        </button>
      </td>
    </tr>`).join('');

  document.getElementById('users-table').innerHTML = `
    <table class="table table-sm">
      <thead><tr><th>Username</th><th>UID</th><th>Role</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function toggleAdmin(uid, makeAdmin) {
  await db.collection('users').doc(uid).update({ isAdmin: makeAdmin });
  showToast(`User updated.`);
  loadUsers();
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
    return await res.json();
  } catch (ex) {
    setApiStatus('❌ Network error: ' + ex.message);
    return null;
  }
}
