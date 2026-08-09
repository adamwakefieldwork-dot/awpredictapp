// Fetches the league leaderboard and renders it as a ranked table.
// Rank is just the row's position after the server's ORDER BY —
// no separate rank calculation needed, the SQL already sorted
// everyone by totalpoints descending.
//
// Two accuracy metrics, both out of games actually played + predicted:
//   Perfect Accuracy  = perfect / gamesplayedpredicted
//                        ("how often do they nail the exact score?")
//   Outcome Accuracy  = (perfect + correct) / gamesplayedpredicted
//                        ("how often do they at least get the right
//                        result, even if the scoreline's off?")
// Perfect predictions count toward BOTH, since a perfect score is by
// definition also a correct outcome.

const tableBody = document.getElementById('dashboard-body');

async function loadDashboard() {
    tableBody.innerHTML = '<tr><td colspan="8" class="loading-msg">Loading...</td></tr>';

    try {
        const res = await fetch('/api/dashboard');
        const data = await res.json();

        if (!res.ok) {
            tableBody.innerHTML = `<tr><td colspan="8" class="loading-msg">${data.error || 'Failed to load'}</td></tr>`;
            return;
        }

        renderLeaderboard(data.leaderboard);

    } catch (err) {
        tableBody.innerHTML = '<tr><td colspan="8" class="loading-msg">Network error — try again</td></tr>';
    }
}

function renderLeaderboard(leaderboard) {
    if (leaderboard.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8" class="loading-msg">No members in this league yet</td></tr>';
        return;
    }

    let html = '';

    leaderboard.forEach((player, index) => {
        const rank = index + 1;
        const wrongCount = player.gamesplayedpredicted - player.perfectcount - player.correctcount;

        // Both accuracies guard against dividing by zero for a player
        // with no scored games yet — shown as "—" rather than 0% or NaN.
        const perfectAccuracy = player.gamesplayedpredicted > 0
            ? Math.round((player.perfectcount / player.gamesplayedpredicted) * 100)
            : null;

        const outcomeAccuracy = player.gamesplayedpredicted > 0
            ? Math.round(((player.perfectcount + player.correctcount) / player.gamesplayedpredicted) * 100)
            : null;

        html += `
            <tr>
                <td class="rank-col">${rank}</td>
                <td class="player-col">${player.username}</td>
                <td class="points-col">${player.totalpoints}</td>
                <td>${player.perfectcount}</td>
                <td>${player.correctcount}</td>
                <td>${wrongCount}</td>
                <td>${perfectAccuracy !== null ? perfectAccuracy + '%' : '—'}</td>
                <td>${outcomeAccuracy !== null ? outcomeAccuracy + '%' : '—'}</td>
            </tr>
        `;
    });

    tableBody.innerHTML = html;
}

loadDashboard();