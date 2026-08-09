// Fetches every game (across every gameweek) plus every league member's
// predictions, then builds one long table grouped into gameweek sections.
// Each cell's TEXT COLOUR reflects the outcome once a game is played:
//   black  = game not played yet
//   red    = wrong outcome entirely
//   yellow = correct outcome, but not the exact score
//   green  = perfect score

const tableHead = document.querySelector('#all-scores-table thead tr');
const tableBody = document.getElementById('all-scores-body');

async function loadAllScores() {
    tableBody.innerHTML = '<tr><td class="loading-msg">Loading...</td></tr>';

    try {
        const res = await fetch('/api/all-scores');
        const data = await res.json();

        if (!res.ok) {
            tableBody.innerHTML = `<tr><td class="loading-msg">${data.error || 'Failed to load'}</td></tr>`;
            return;
        }

        renderTable(data.games, data.users, data.predictions);

    } catch (err) {
        tableBody.innerHTML = '<tr><td class="loading-msg">Network error — try again</td></tr>';
    }
}

function buildPredictionMap(predictions) {
    const map = {};
    for (const p of predictions) {
        map[`${p.gameid}-${p.userid}`] = p;
    }
    return map;
}

function renderTable(games, users, predictions) {
    let headerHtml = '<th class="fixture-col-header">Fixture</th>';
    for (const user of users) {
        headerHtml += `<th>${user.username}</th>`;
    }
    tableHead.innerHTML = headerHtml;

    if (games.length === 0) {
        tableBody.innerHTML = '<tr><td class="loading-msg">No fixtures yet</td></tr>';
        return;
    }

    const predictionMap = buildPredictionMap(predictions);
    const columnCount = users.length + 1;

    let bodyHtml = '';
    let lastGameweekSeen = null;

    for (const game of games) {
        if (game.gameweek !== lastGameweekSeen) {
            bodyHtml += `
                <tr class="gameweek-header-row">
                    <td colspan="${columnCount}">Gameweek ${game.gameweek}</td>
                </tr>
            `;
            lastGameweekSeen = game.gameweek;
        }

        const hasResult = game.hometeamscore !== null && game.awayteamscore !== null;

        // Result now shown INLINE with the team names, rather than on
        // a separate line — "Arsenal 2 - 1 Coventry City" once played,
        // or just "Arsenal vs Coventry City" before kickoff.
        const fixtureLine = hasResult
            ? `${game.hometeamname} ${game.hometeamscore} - ${game.awayteamscore} ${game.awayteamname}`
            : `${game.hometeamname} vs ${game.awayteamname}`;

        bodyHtml += `
            <tr>
                <td class="fixture-col">
                    <div>${fixtureLine}</div>
                    <div class="fixture-date">${game.date}</div>
                </td>
        `;

        for (const user of users) {
            const prediction = predictionMap[`${game.id}-${user.id}`];

            if (!prediction || prediction.hometeamscore === null || prediction.awayteamscore === null) {
                bodyHtml += `<td class="prediction-cell no-prediction">—</td>`;
                continue;
            }

            const wildcardBadge = prediction.wildcardused === 'yes'
                ? '<span class="wildcard-badge" title="Wildcard used">★</span>'
                : '';

            const pointsLine = prediction.leaguescore !== null
                ? `<span class="points-earned">${prediction.leaguescore}pts</span>`
                : '';

            // Outcome colour only applies once the game has a real
            // result — otherwise the cell stays the default (black),
            // since there's nothing to judge yet.
            let cellClass = 'prediction-cell';
            if (hasResult) {
                const isPerfect = prediction.hometeamscore === game.hometeamscore
                                && prediction.awayteamscore === game.awayteamscore;
                const predictedOutcome = Math.sign(prediction.hometeamscore - prediction.awayteamscore);
                const actualOutcome = Math.sign(game.hometeamscore - game.awayteamscore);
                const isCorrectOutcome = predictedOutcome === actualOutcome;

                if (isPerfect) cellClass += ' outcome-perfect';
                else if (isCorrectOutcome) cellClass += ' outcome-correct';
                else cellClass += ' outcome-wrong';
            }

            bodyHtml += `
                <td class="${cellClass}">
                    ${prediction.hometeamscore} - ${prediction.awayteamscore}${wildcardBadge}
                    ${pointsLine}
                </td>
            `;
        }

        bodyHtml += '</tr>';
    }

    tableBody.innerHTML = bodyHtml;
}

loadAllScores();