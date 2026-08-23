// Fetches every game (across every gameweek) plus every league member's
// predictions, then renders it all as an AG Grid instead of a hand-built
// HTML table. AG Grid's column pinning is what fixes the clipping issue —
// Gameweek/Fixture/Result stay locked on the left while player columns
// scroll independently, no matter how many members are in the league.

const statusEl = document.getElementById('all-scores-status');
const gridContainer = document.getElementById('all-scores-grid');

let gridApi = null;

async function loadAllScores() {
    statusEl.textContent = 'Loading...';
    statusEl.style.display = 'block';
    gridContainer.style.display = 'none';

    try {
        const res = await fetch('/api/all-scores');
        const data = await res.json();

        if (!res.ok) {
            statusEl.textContent = data.error || 'Failed to load';
            return;
        }

        if (data.games.length === 0) {
            statusEl.textContent = 'No fixtures yet';
            return;
        }

        buildGrid(data.games, data.users, data.predictions);

        statusEl.style.display = 'none';
        gridContainer.style.display = 'block';

    } catch (err) {
        statusEl.textContent = 'Network error — try again';
    }
}

// ---------------------------------------------------------------------
// Converts a raw UTC date string like "2026-08-21T19:00:00Z" into a
// readable UK-format string, e.g. "Fri 21 Aug, 7:00 PM".
// ---------------------------------------------------------------------
function formatFixtureDate(utcDateString) {
    const date = new Date(utcDateString);

    const datePart = date.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
    });

    const timePart = date.toLocaleTimeString('en-GB', {
        hour: 'numeric',
        minute: '2-digit'
    });

    return `${datePart}, ${timePart}`;
}

function buildPredictionMap(predictions) {
    const map = {};
    for (const p of predictions) {
        map[`${p.gameid}-${p.userid}`] = p;
    }
    return map;
}

// ---------------------------------------------------------------------
// Turns the raw games/users/predictions arrays into AG Grid's expected
// shape: one column definition per fixed field + one per user, and one
// row object per game.
// ---------------------------------------------------------------------
function buildGrid(games, users, predictions) {
    const predictionMap = buildPredictionMap(predictions);

    // --- COLUMN DEFINITIONS ---
    const columnDefs = [
        {
            field: 'gameweek',
            headerName: 'GW',
            pinned: 'left',
            width: 70,
            sort: 'asc',
            sortIndex: 0,
            filter: 'agNumberColumnFilter'
        },
        {
            field: 'fixture',
            headerName: 'Fixture',
            pinned: 'left',
            width: 240,
            sortable: false,
            filter: false,
            cellRenderer: (params) => {
                const f = params.value;
                return `
                    <div class="fixture-cell-line">
                        <img class="team-crest-mini" src="${f.hometeamcrest ?? ''}" alt="${f.hometeamname} crest" onerror="this.style.visibility='hidden'">
                        <span>${f.hometeamname} vs ${f.awayteamname}</span>
                        <img class="team-crest-mini" src="${f.awayteamcrest ?? ''}" alt="${f.awayteamname} crest" onerror="this.style.visibility='hidden'">
                    </div>
                    <div class="fixture-cell-date">${f.dateLabel}</div>
                `;
            },
            autoHeight: true
        },
        {
            field: 'resultText',
            headerName: 'Result',
            pinned: 'left',
            width: 90,
            sortable: false,
            filter: false,
            cellClass: 'result-cell'
        }
    ];

    for (const user of users) {
        columnDefs.push({
            field: `user_${user.id}`,
            headerName: user.username,
            width: 120,
            sortable: false,
            filter: false,
            cellRenderer: (params) => {
                const p = params.value;
                if (!p) return '<span class="no-prediction">—</span>';

                return `
                    ${p.scoreText}${p.wildcardBadge}
                    ${p.pointsLine}
                `;
            },
            cellClass: (params) => {
                const p = params.value;
                return p ? p.outcomeClass : 'no-prediction';
            }
        });
    }

    // --- ROW DATA ---
    const rowData = games.map((game) => {
        const hasResult = game.hometeamscore !== null && game.awayteamscore !== null;

        const row = {
            gameweek: game.gameweek,
            fixture: {
                hometeamname: game.hometeamname,
                awayteamname: game.awayteamname,
                hometeamcrest: game.hometeamcrest,
                awayteamcrest: game.awayteamcrest,
                dateLabel: formatFixtureDate(game.date)
            },
            resultText: hasResult ? `${game.hometeamscore} - ${game.awayteamscore}` : ''
        };

        for (const user of users) {
            const prediction = predictionMap[`${game.id}-${user.id}`];

            if (!prediction || prediction.hometeamscore === null || prediction.awayteamscore === null) {
                row[`user_${user.id}`] = null;
                continue;
            }

            const wildcardBadge = prediction.wildcardused === 'yes'
                ? '<span class="wildcard-badge" title="Wildcard used">★</span>'
                : '';

            const pointsLine = prediction.leaguescore !== null
                ? `<span class="points-earned">${prediction.leaguescore}pts</span>`
                : '';

            let outcomeClass = 'prediction-cell';
            if (hasResult) {
                const isPerfect = prediction.hometeamscore === game.hometeamscore
                                && prediction.awayteamscore === game.awayteamscore;

                if (prediction.wildcardused === 'yes') {
                    // Wildcard predictions only have TWO outcomes, not three — an
                    // exact match wins, anything else (even a correctly-guessed
                    // result) loses. There's no "correct but not perfect" middle
                    // tier for a wildcard, unlike a normal prediction.
                    outcomeClass += isPerfect ? ' outcome-perfect' : ' outcome-wrong';
                } else {
                    const predictedOutcome = Math.sign(prediction.hometeamscore - prediction.awayteamscore);
                    const actualOutcome = Math.sign(game.hometeamscore - game.awayteamscore);
                    const isCorrectOutcome = predictedOutcome === actualOutcome;

                    if (isPerfect) outcomeClass += ' outcome-perfect';
                    else if (isCorrectOutcome) outcomeClass += ' outcome-correct';
                    else outcomeClass += ' outcome-wrong';
                }
            }

            row[`user_${user.id}`] = {
                scoreText: `${prediction.hometeamscore} - ${prediction.awayteamscore}`,
                wildcardBadge,
                pointsLine,
                outcomeClass
            };
        }

        return row;
    });

    // ---------------------------------------------------------------------
    // Builds a lookup of gameweek -> 0 or 1, alternating by the ORDER
    // gameweeks appear in rowData (already sorted ascending), not by the
    // gameweek number's own parity. E.g. if the actual gameweek numbers
    // present are [1, 2, 4, 5] (3 is missing), this still alternates
    // cleanly as white/grey/white/grey rather than grey/grey (since 2
    // and 4 are both even).
    // ---------------------------------------------------------------------
    const distinctGameweeksInOrder = [...new Set(rowData.map((row) => row.gameweek))];
    const gameweekBandLookup = {};
    distinctGameweeksInOrder.forEach((gw, index) => {
        gameweekBandLookup[gw] = index % 2;
    });

    // --- GRID SETUP ---
    const gridOptions = {
        columnDefs,
        rowData,
        rowHeight: 56,
        headerHeight: 44,
        defaultColDef: {
            resizable: true
        },
        // Alternates row shading based on VISUAL POSITION among gameweeks,
        // not the raw gameweek number's odd/even value. This guarantees
        // strict alternation (white, grey, white, grey...) even if
        // gameweek numbers have gaps.
        getRowStyle: (params) => {
            const isShaded = gameweekBandLookup[params.data.gameweek] === 1;
            return isShaded ? { background: '#e8edf2' } : { background: '#ffffff' };
        },
        // Secondary sort by kickoff date within the same gameweek, so
        // fixtures still appear in a sensible order without needing the
        // old banner-row grouping.
        onGridReady: (params) => {
            params.api.applyColumnState({
                state: [
                    { colId: 'gameweek', sort: 'asc', sortIndex: 0 }
                ]
            });
        }
    };

    if (gridApi) {
        gridApi.destroy();
    }

    gridApi = agGrid.createGrid(gridContainer, gridOptions);
}

loadAllScores();