// ============================================================
//  leaderboard.js  –  Logic for leaderboard.html
// ============================================================

(async () => {
  const me = await requireAuth();
  buildNav(me.username, me.isAdmin);
  await buildLeaderboard(me.uid);
})();

async function buildLeaderboard(myUid) {
  const container = document.getElementById('leaderboard-container');

  // 1. Load all finished matches (we need their actual scores)
  const matchSnap = await db.collection('matches').get();
  const matches = {};
  matchSnap.forEach(d => { matches[d.id] = d.data(); });
  const finishedMatches = Object.entries(matches).filter(([, m]) => m.finished);

  if (finishedMatches.length === 0) {
    container.innerHTML = '<div class="alert alert-info">No matches have been played yet. Check back once games start!</div>';
    return;
  }

  // 2. Load all users
  const usersSnap = await db.collection('users').get();
  const users = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));

  // 3. For each user, load their predictions and compute total points
  const rows = await Promise.all(users.map(async (u) => {
    const predSnap = await db.collection('predictions').doc(u.uid).collection('matches').get();
    const preds = {};
    predSnap.forEach(d => { preds[d.id] = d.data(); });

    let totalPts = 0;
    let predicted = 0;
    let exactScores = 0;

    for (const [matchId, m] of finishedMatches) {
      const pred = preds[matchId];
      if (!pred) continue;
      const pts = calcPoints(pred.home, pred.away, m.actualHome, m.actualAway, true);
      if (pts === null) continue;
      totalPts += pts;
      predicted++;
      if (pts === 3 && Number(pred.home) === Number(m.actualHome) && Number(pred.away) === Number(m.actualAway)) {
        exactScores++;
      }
    }

    return {
      uid: u.uid,
      username: u.username || 'Unknown',
      totalPts,
      predicted,
      exactScores,
      gamesPlayed: finishedMatches.length
    };
  }));

  // 4. Sort by total pts desc, then exact scores as tiebreaker
  rows.sort((a, b) => b.totalPts - a.totalPts || b.exactScores - a.exactScores);

  // 5. Render table
  const rankEmoji = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;

  const tableRows = rows.map((r, i) => {
    const isMe = r.uid === myUid;
    return `<tr class="${isMe ? 'table-success fw-bold' : ''}">
      <td>${rankEmoji(i)}</td>
      <td>${escHtml(r.username)}${isMe ? ' <span class="badge bg-success">You</span>' : ''}</td>
      <td class="text-center fw-bold fs-5">${r.totalPts}</td>
      <td class="text-center">${r.predicted}/${r.gamesPlayed}</td>
      <td class="text-center">${r.exactScores}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="table-responsive">
      <table class="table table-hover align-middle">
        <thead class="table-dark">
          <tr>
            <th>#</th>
            <th>Player</th>
            <th class="text-center">Points</th>
            <th class="text-center">Predicted</th>
            <th class="text-center">Exact Scores 🎯</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <p class="text-muted small">Points: 1 per correct goal, 1 for correct outcome (W/D/L). Max 3 per match.
    Exact score = both goals + outcome correct. Tiebreaker: most exact scores.</p>`;

  document.getElementById('last-updated').textContent =
    `Based on ${finishedMatches.length} finished match(es). Refreshes on page load.`;
}
