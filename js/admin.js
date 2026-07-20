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

// ── Sync scores only (never rewrites fixture structure) ──
// Matches API results to Firestore docs by kickoff time (minute precision),
// preferring the lower Firestore doc ID when duplicates share a kickoff.
// This routes scores to the original bracket-position docs even when the
// API uses different IDs for the confirmed fixtures.
async function syncScoresOnlyFromApi() {
  const token = document.getElementById('api-token-input').value.trim();
  if (!token) { showToast('Save an API key first.', 'warning'); return; }
  setApiStatus('⏳ Syncing scores only (team assignments unchanged)…');

  const gamesData = await safeApiFetch(`${API_BASE}/matches`, 'GET', null, token);
  if (!gamesData) { setApiStatus('❌ Failed to fetch data from API.'); return; }

  const gameList = extractList(gamesData, ['games', 'data', 'matches', 'results', 'items']);
  if (gameList.length === 0) { setApiStatus('❌ No games returned from API.'); return; }

  // Build kickoff-minute → Firestore doc ID map.
  // When the API created a duplicate confirmed doc (e.g. id=82 for what we call M73),
  // both docs share the same kickoffUtc. We prefer the LOWER numeric doc ID because
  // that is the original bracket-position placeholder that BRACKET_MATCH_IDS refers to.
  const toKickoffMin = (s) => {
    const t = new Date(String(s || '')).getTime();
    return (Number.isFinite(t) && t > 0) ? String(Math.floor(t / 60000)) : '';
  };

  const matchesSnap = await db.collection('matches').get();
  const kickoffMinToDocId = new Map();
  const docsSorted = matchesSnap.docs.slice().sort((a, b) => {
    const na = Number(a.id), nb = Number(b.id);
    return (!isNaN(na) && !isNaN(nb)) ? na - nb : a.id.localeCompare(b.id);
  });
  docsSorted.forEach(doc => {
    const k = toKickoffMin(doc.data().kickoffUtc);
    if (k && !kickoffMinToDocId.has(k)) kickoffMinToDocId.set(k, doc.id);
  });

  let updated = 0;
  const CHUNK = 400;
  for (let i = 0; i < gameList.length; i += CHUNK) {
    const batch = db.batch();
    for (const g of gameList.slice(i, i + CHUNK)) {
      const apiKickoff = g.kickoff_utc || g.kickoffUtc || g.local_date || g.date || '';
      const kickoffMin = toKickoffMin(apiKickoff);
      const apiId = String(g.id ?? g.match_number ?? g.matchId ?? g.match_id ?? '');
      // Prefer kickoff-based lookup; fall back to API ID if no match found
      const docId = (kickoffMin && kickoffMinToDocId.has(kickoffMin))
        ? kickoffMinToDocId.get(kickoffMin)
        : apiId;
      if (!docId) continue;
      const isFinished = toMatchFinished(g)
        && toMaybeNumber(g.home_score) !== null
        && toMaybeNumber(g.away_score) !== null;
      batch.set(db.collection('matches').doc(docId), {
        actualHome: toMaybeNumber(g.home_score),
        actualAway: toMaybeNumber(g.away_score),
        finished: isFinished
      }, { merge: true });
      updated++;
    }
    await batch.commit();
  }
  await db.collection('config').doc('settings').set(
    { lastSync: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  setApiStatus(`✅ Scores synced for ${updated} matches. Fixture structure unchanged.`);
  showToast('Scores synced!');
}

// ── Diagnose knockout match IDs ──────────────────────────
// Shows every non-group Firestore doc so you can see the actual doc IDs
// the API assigned and cross-reference with the expected bracket positions.
async function diagnoseKnockoutIds() {
  const statusEl = document.getElementById('diagnose-output');
  statusEl.textContent = '⏳ Loading…';
  const snap = await db.collection('matches').get();
  const rows = [];
  snap.forEach(doc => {
    const d = doc.data();
    if (d.type && d.type !== 'group') {
      rows.push({ id: doc.id, type: d.type || '?', kickoffUtc: d.kickoffUtc || '',
        home: d.homeTeam || '', away: d.awayTeam || '',
        finished: d.finished || false, aH: d.actualHome, aA: d.actualAway });
    }
  });
  rows.sort((a, b) => { const na = Number(a.id), nb = Number(b.id);
    return (!isNaN(na) && !isNaN(nb)) ? na - nb : a.id.localeCompare(b.id); });
  if (rows.length === 0) { statusEl.textContent = 'No knockout matches found.'; return; }
  statusEl.textContent = rows.map(r =>
    `ID:${r.id.padEnd(4)} | ${r.type.padEnd(8)} | ${(r.kickoffUtc||'').slice(0,16).padEnd(16)} | ${(r.home||'TBD').padEnd(22)} vs ${(r.away||'TBD')}${r.finished ? ` [✓ ${r.aH}-${r.aA}]` : ''}`
  ).join('\n');
}

// ── Reset a corrupted match fixture ────────────────────────
// Wipes team names and scores for one match so the bracket resolves
// teams from group standings. User predictions are untouched.
async function resetFixture() {
  const matchId = document.getElementById('reset-match-id').value.trim();
  if (!matchId) { showToast('Enter a match ID.', 'warning'); return; }
  const statusEl = document.getElementById('reset-status');
  statusEl.textContent = '⏳ Resetting…';
  await db.collection('matches').doc(matchId).set({
    homeTeam: '',
    awayTeam: '',
    homeFlag: '',
    awayFlag: '',
    finished: false,
    actualHome: null,
    actualAway: null,
    winnerTeam: '',
    winner_team_name: '',
    winner: '',
    winnerName: ''
  }, { merge: true });
  statusEl.textContent = `✅ Match ${matchId} reset. Team names now resolve from group standings.`;
  showToast(`Match ${matchId} fixture reset.`);
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
  try {
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
        // Group stage: both score fields present
        const hasScore = p.home !== null && p.away !== null &&
                         p.home !== undefined && p.away !== undefined &&
                         p.home !== '' && p.away !== '';
        // Knockout stage: winner side recorded (winnerSide written by save fn,
        // winnerSideDemo written by the demo/edit flow)
        const hasWinner = p.winnerSide === 'home' || p.winnerSide === 'away' ||
                          p.winnerSideDemo === 'home' || p.winnerSideDemo === 'away';
        if (hasScore || hasWinner) {
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



    const fmtTs = (ts) => {
      if (!ts) return '—';
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const koVisitedCount = usersWithStats.filter(u => !!u.knockoutLastUpdated).length;

    document.getElementById('users-summary').innerHTML = `
      <div class="alert alert-info mb-0">
        <strong>Accounts:</strong> ${usersWithStats.length}
        &nbsp;|&nbsp; <strong>Started predictions:</strong> ${startedCount}
        &nbsp;|&nbsp; <strong>Completed all matches:</strong> ${completedCount}
        &nbsp;|&nbsp; <strong>Total matches loaded:</strong> ${totalMatches}
        &nbsp;|&nbsp; <strong>KO stage visited:</strong> ${koVisitedCount}/${usersWithStats.length}
      </div>`;

    const rows = usersWithStats.map(u => `
      <tr>
        <td>${escHtml(u.username || '—')}</td>
        <td>${escHtml(u.uid)}</td>
        <td>${u.isAdmin ? '✅ Admin' : 'User'}</td>
        <td>${u.completedPredictions}/${totalMatches || 0}</td>
        <td>${u.hasStarted ? (u.isFullyComplete ? '✅ Complete' : '🟡 In progress') : '—'}</td>
        <td>${fmtTs(u.lastLogin)}</td>
        <td>${u.knockoutLastUpdated ? '✅ ' + fmtTs(u.knockoutLastUpdated) : '❌ Not visited'}</td>
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
        <thead><tr><th>Username</th><th>UID</th><th>Role</th><th>Predictions</th><th>Status</th><th>Last Login</th><th>KO Updated</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (err) {
    console.error('Load users failed:', err);
    showToast(`Load users failed: ${err?.message || 'Unknown error'}`, 'danger');
  }
}

async function addUserManually() {
  const uidInput = document.getElementById('manual-user-uid');
  const usernameInput = document.getElementById('manual-user-username');
  const uid = String(uidInput?.value || '').trim();
  const usernameRaw = String(usernameInput?.value || '').trim();
  const username = usernameRaw.replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 20);

  if (!uid) {
    showToast('Enter a UID from Firebase Authentication.', 'warning');
    return;
  }
  if (!username || username.length < 3) {
    showToast('Enter a valid username (3-20 chars, letters/numbers/_/-).', 'warning');
    return;
  }

  const normalized = username.toLowerCase();

  try {
    const existingName = await db.collection('usernames').doc(normalized).get();
    if (existingName.exists && (existingName.data() || {}).uid !== uid) {
      showToast('That username is already mapped to another account.', 'warning');
      return;
    }

    await db.collection('users').doc(uid).set({
      username,
      isAdmin: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      manualAdd: true
    }, { merge: true });

    await db.collection('usernames').doc(normalized).set({ uid }, { merge: true });

    showToast(`Added user ${username} (${uid}).`);
    if (uidInput) uidInput.value = '';
    if (usernameInput) usernameInput.value = '';
    await loadUsers();
  } catch (err) {
    console.error('Manual add failed:', err);
    showToast(`Manual add failed: ${err?.message || 'Unknown error'}`, 'danger');
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
    finished: toMatchFinished(g) && toMaybeNumber(g.home_score) !== null && toMaybeNumber(g.away_score) !== null,
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
