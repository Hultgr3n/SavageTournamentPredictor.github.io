// ============================================================
//  admin.js  –  Logic for admin.html
// ============================================================

const API_BASE = 'https://api.wc2026api.com';
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

async function saveApiToken() {
  const token = document.getElementById('api-token-input').value.trim();
  if (!token) { showToast('Token is empty.', 'warning'); return; }
  await db.collection('config').doc('settings').set({ apiToken: token }, { merge: true });
  showToast('API key saved.');
}

// ── Initialize ALL matches from API ─────────────────────
async function initMatchesFromApi() {
  const token = document.getElementById('api-token-input').value.trim();
  if (!token) { showToast('Save an API key first.', 'warning'); return; }
  setApiStatus('⏳ Fetching teams and matches…');

  const [teamsData, gamesData] = await Promise.all([
    safeApiFetch(`${API_BASE}/teams`, 'GET', null, token),
    safeApiFetch(`${API_BASE}/matches`, 'GET', null, token)
  ]);

  if (!teamsData || !gamesData) {
    setApiStatus('❌ Failed to fetch data from API. Check API key and try again.');
    return;
  }

  const existingMatchesSnap = await db.collection('matches').get();
  const existingMatches = existingMatchesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

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
      const docRef = db.collection('matches').doc(String(g.id));
      batch.set(docRef, buildMatchDoc(g, teams, typeMap), { merge: false });
    }
    await batch.commit();
  }

  await migratePredictionsIfNeeded(existingMatches, gameList);

  setApiStatus(`✅ ${gameList.length} matches initialized!`);
  showToast(`${gameList.length} matches loaded into Firestore.`);
}

// ── Sync live scores from API ────────────────────────────
async function syncScoresFromApi() {
  const token = document.getElementById('api-token-input').value.trim();
  if (!token) { showToast('Save an API key first.', 'warning'); return; }
  setApiStatus('⏳ Syncing fixtures and scores…');

  const [teamsData, gamesData] = await Promise.all([
    safeApiFetch(`${API_BASE}/teams`, 'GET', null, token),
    safeApiFetch(`${API_BASE}/matches`, 'GET', null, token)
  ]);
  if (!teamsData || !gamesData) { setApiStatus('❌ Failed to fetch data from API.'); return; }

  const teams = {};
  const teamList = extractList(teamsData, ['teams', 'data', 'results', 'items']);
  teamList.forEach(t => { teams[String(t.id)] = t; });

  const typeMap = {
    'group': 'group',
    'round_of_32': 'round32', 'r32': 'round32',
    'round_of_16': 'round16', 'r16': 'round16',
    'quarter_final': 'qf', 'quarterfinal': 'qf',
    'semi_final': 'sf', 'semifinal': 'sf',
    'final': 'final'
  };

  const gameList = extractList(gamesData, ['games', 'data', 'matches', 'results', 'items']);
  let updated = 0;
  const CHUNK = 400;
  for (let i = 0; i < gameList.length; i += CHUNK) {
    const batch = db.batch();
    for (const g of gameList.slice(i, i + CHUNK)) {
      const docRef = db.collection('matches').doc(String(g.id));
      batch.set(docRef, buildMatchDoc(g, teams, typeMap), { merge: true });
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
async function backfillMissingUsers(silent = false) {
  const [usersSnap, usernamesSnap, predictionsSnap, predictionMatchesSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('usernames').get(),
    db.collection('predictions').get(),
    db.collectionGroup('matches').get()
  ]);

  const existingUserIds = new Set(usersSnap.docs.map(d => d.id));
  const usernameByUid = new Map();

  usernamesSnap.forEach((doc) => {
    const data = doc.data() || {};
    const uid = data.uid;
    if (!uid) return;
    if (!usernameByUid.has(uid)) {
      usernameByUid.set(uid, doc.id);
    }
  });

  const missingUserIds = new Set();
  usernameByUid.forEach((_username, uid) => {
    if (!existingUserIds.has(uid)) missingUserIds.add(uid);
  });
  predictionsSnap.forEach((doc) => {
    if (!existingUserIds.has(doc.id)) missingUserIds.add(doc.id);
  });
  predictionMatchesSnap.forEach((doc) => {
    const uid = doc.ref.parent?.parent?.id;
    if (uid && !existingUserIds.has(uid)) {
      missingUserIds.add(uid);
    }
  });

  const diagnostics = {
    users: usersSnap.size,
    usernames: usernamesSnap.size,
    predictionsRoot: predictionsSnap.size,
    predictionEntries: predictionMatchesSnap.size,
    missingUsers: missingUserIds.size
  };

  if (missingUserIds.size === 0) {
    if (!silent) {
      showToast(
        `No missing users found. users=${diagnostics.users}, usernames=${diagnostics.usernames}, prediction owners=${diagnostics.predictionsRoot}, prediction entries=${diagnostics.predictionEntries}`,
        'info'
      );
    }
    return 0;
  }

  const ids = Array.from(missingUserIds);
  const CHUNK = 400;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = db.batch();
    for (const uid of ids.slice(i, i + CHUNK)) {
      const fallbackName = `legacy-${uid.slice(0, 8)}`;
      const username = String(usernameByUid.get(uid) || fallbackName)
        .replace(/[^A-Za-z0-9_\-]/g, '')
        .slice(0, 20) || fallbackName;

      batch.set(db.collection('users').doc(uid), {
        username,
        isAdmin: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        legacyBackfill: true
      }, { merge: true });
    }
    await batch.commit();
  }

  if (!silent) {
    showToast(`Backfilled ${ids.length} missing account${ids.length === 1 ? '' : 's'}.`);
  }
  return ids.length;
}

async function backfillUsers() {
  try {
    const created = await backfillMissingUsers(false);
    if (created > 0) {
      await loadUsers();
    }
  } catch (err) {
    console.error('Backfill failed:', err);
    showToast(`Backfill failed: ${err?.message || 'Unknown error'}`, 'danger');
  }
}

async function loadUsers() {
  try {
    const repaired = await backfillMissingUsers(true);
    if (repaired > 0) {
      showToast(`Recovered ${repaired} legacy account${repaired === 1 ? '' : 's'} into users list.`, 'info');
    }

    const [usersSnap, usernamesSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('usernames').get()
    ]);

    const usersByUid = new Map();
    usersSnap.forEach((d) => {
      usersByUid.set(d.id, { uid: d.id, ...d.data() });
    });

    // Fallback visibility: include accounts that still only exist in username registry.
    usernamesSnap.forEach((d) => {
      const data = d.data() || {};
      const uid = data.uid;
      if (!uid || usersByUid.has(uid)) return;
      usersByUid.set(uid, {
        uid,
        username: d.id,
        isAdmin: false,
        legacyBackfillPreview: true
      });
    });

    const users = Array.from(usersByUid.values());

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
  } catch (err) {
    console.error('Load users failed:', err);
    showToast(`Load users failed: ${err?.message || 'Unknown error'}`, 'danger');
  }
}

async function toggleAdmin(uid, makeAdmin) {
  await db.collection('users').doc(uid).set({ isAdmin: makeAdmin }, { merge: true });
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

function buildMatchDoc(g, teams, typeMap) {
  const homeTeamId = g.home_team_id ?? g.home_team?.id ?? g.home_team?.team_id ?? g.homeTeamId ?? g.homeTeam?.id ?? '';
  const awayTeamId = g.away_team_id ?? g.away_team?.id ?? g.away_team?.team_id ?? g.awayTeamId ?? g.awayTeam?.id ?? '';
  const homeTeamName = g.home_team_name_en || g.home_team || g.homeTeam || g.home_team_name || g.home_team?.name || g.home_team?.name_en || g.home_team?.team_name || '';
  const awayTeamName = g.away_team_name_en || g.away_team || g.awayTeam || g.away_team_name || g.away_team?.name || g.away_team?.name_en || g.away_team?.team_name || '';
  const homeTeamObj = teams[String(homeTeamId)] || {};
  const awayTeamObj = teams[String(awayTeamId)] || {};
  const group = g.group || g.group_name || homeTeamObj.group_name || awayTeamObj.group_name || '';
  const round = String(g.type || g.round || '').toLowerCase();
  const kickoffUtc = g.kickoff_utc || g.kickoffUtc || g.local_date || g.date || '';
  const matchId = String(g.id ?? g.match_number ?? g.matchId ?? g.match_id ?? '');

  return {
    id: matchId,
    homeTeam: homeTeamName || homeTeamObj.name || homeTeamObj.name_en || `Team ${homeTeamId}`,
    awayTeam: awayTeamName || awayTeamObj.name || awayTeamObj.name_en || `Team ${awayTeamId}`,
    homeTeamCode: g.home_team_code || homeTeamObj.code || '',
    awayTeamCode: g.away_team_code || awayTeamObj.code || '',
    homeFlag: g.home_team_flag || homeTeamObj.flag_url || homeTeamObj.flag || '',
    awayFlag: g.away_team_flag || awayTeamObj.flag_url || awayTeamObj.flag || '',
    group,
    type: typeMap[round] || round || 'group',
    matchday: Number(g.matchday || g.match_number) || 0,
    date: kickoffUtc,
    kickoffUtc,
    stadium: g.stadium || '',
    actualHome: toMaybeNumber(g.home_score),
    actualAway: toMaybeNumber(g.away_score),
    finished: toMatchFinished(g),
    sortOrder: Number(matchId) || Number(g.match_number) || 0
  };
}

function toMatchFinished(g) {
  if (g.status) return String(g.status).toLowerCase() === 'completed';
  if (g.phase) return ['ft', 'ft_pen', 'completed'].includes(String(g.phase).toLowerCase());
  return toBool(g.finished);
}

function matchFixtureKey(match) {
  const round = String(match.type || match.round || '').toLowerCase();
  const group = String(match.group || match.group_name || '').trim().toUpperCase();
  const home = normalizeFixtureText(match.homeTeam || match.home_team || match.home_team_name_en || match.home_team_name || '');
  const away = normalizeFixtureText(match.awayTeam || match.away_team || match.away_team_name_en || match.away_team_name || '');
  const matchday = String(match.matchday || match.match_number || '').trim();
  return [round, group, matchday, home, away].join('|');
}

function normalizeFixtureText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function migratePredictionsIfNeeded(oldMatches, newMatches) {
  const oldByKey = new Map();
  const oldById = new Map();
  for (const match of oldMatches) {
    oldById.set(String(match.id), match);
    oldByKey.set(matchFixtureKey(match), match);
  }

  const newByKey = new Map();
  for (const match of newMatches) {
    newByKey.set(matchFixtureKey(match), match);
  }

  const idChanges = [];
  for (const [key, newMatch] of newByKey.entries()) {
    const oldMatch = oldByKey.get(key);
    if (!oldMatch || String(oldMatch.id) === String(newMatch.id)) continue;
    idChanges.push({ oldId: String(oldMatch.id), newId: String(newMatch.id) });
  }

  if (idChanges.length === 0) {
    return;
  }

  const usersSnap = await db.collection('users').get();
  for (const userDoc of usersSnap.docs) {
    const predCol = db.collection('predictions').doc(userDoc.id).collection('matches');
    for (const { oldId, newId } of idChanges) {
      if (oldId === newId) continue;
      const oldPredSnap = await predCol.doc(oldId).get();
      if (!oldPredSnap.exists) continue;
      const newPredSnap = await predCol.doc(newId).get();
      if (newPredSnap.exists) {
        await predCol.doc(oldId).delete().catch(() => {});
        continue;
      }
      await predCol.doc(newId).set(oldPredSnap.data(), { merge: false });
      await predCol.doc(oldId).delete().catch(() => {});
    }
  }

  setApiStatus(`✅ Migrated predictions for ${idChanges.length} fixture IDs.`);
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
