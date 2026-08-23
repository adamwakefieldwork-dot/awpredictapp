// Fetches the league leaderboard and renders it as an AG Grid.
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
//
// WILDCARDS are tracked separately (Wildcards Used / Wildcards Won)
// since a wildcard only has two outcomes — perfect win or lose — with
// no "right outcome but wrong score" middle tier. correctcount (from
// the server) already excludes wildcard predictions, so wrongcount
// here has to explicitly account for wildcard attempts to stay accurate.

const statusEl = document.getElementById('dashboard-status');
const gridContainer = document.getElementById('dashboard-grid');

let gridApi = null;

async function loadDashboard() {
    statusEl.textContent = 'Loading...';
    statusEl.style.display = 'block';
    gridContainer.style.display = 'none';

    try {
        const res = await fetch('/api/dashboard');
        const data = await res.json();

        if (!res.ok) {
            statusEl.textContent = data.error || 'Failed to load';
            return;
        }

        if (data.leaderboard.length === 0) {
            statusEl.textContent = 'No members in this league yet';
            return;
        }

        buildGrid(data.leaderboard);

        statusEl.style.display = 'none';
        gridContainer.style.display = 'block';

    } catch (err) {
        statusEl.textContent = 'Network error — try again';
    }
}

function buildGrid(leaderboard) {
    // --- ROW DATA ---
    // Rank is derived from array position (already sorted server-side
    // by totalpoints descending) — same logic as the old forEach/index
    // version, just building plain row objects instead of HTML strings.
    const rowData = leaderboard.map((player, index) => {
        const rank = index + 1;

        // wrongcount: start from everything played, remove all perfects
        // (wildcard or not) and all non-wildcard corrects, then remove
        // every wildcard ATTEMPT entirely (win or lose isn't a "wrong"
        // in the normal sense) and add back just the wildcard WINS
        // (already counted in perfectcount, so they'd otherwise be
        // double-subtracted here).
        const wrongCount = player.gamesplayedpredicted
            - player.perfectcount
            - player.correctcount
            - player.wildcardsused
            + player.wildcardscorrect;

        const perfectAccuracy = player.gamesplayedpredicted > 0
            ? Math.round((player.perfectcount / player.gamesplayedpredicted) * 100)
            : null;

        const outcomeAccuracy = player.gamesplayedpredicted > 0
            ? Math.round(((player.perfectcount + player.correctcount) / player.gamesplayedpredicted) * 100)
            : null;

        return {
            rank,
            username: player.username,
            totalpoints: player.totalpoints,
            perfectcount: player.perfectcount,
            correctcount: player.correctcount,
            wrongcount: wrongCount,
            wildcardsused: player.wildcardsused,
            wildcardscorrect: player.wildcardscorrect,
            perfectAccuracyText: perfectAccuracy !== null ? `${perfectAccuracy}%` : '—',
            outcomeAccuracyText: outcomeAccuracy !== null ? `${outcomeAccuracy}%` : '—'
        };
    });

    // --- COLUMN DEFINITIONS ---
    const columnDefs = [
        { field: 'rank', headerName: 'Rank', width: 90, sortable: false, filter: false, cellClass: 'rank-col' },
        { field: 'username', headerName: 'Player', flex: 1, minWidth: 140, sortable: false, filter: false, cellClass: 'player-col' },
        { field: 'totalpoints', headerName: 'Points', width: 100, sortable: false, filter: false, cellClass: 'points-col' },
        { field: 'perfectcount', headerName: 'Perfect', width: 100, sortable: false, filter: false },
        { field: 'correctcount', headerName: 'Correct', width: 100, sortable: false, filter: false },
        { field: 'wrongcount', headerName: 'Wrong', width: 100, sortable: false, filter: false },
        { field: 'wildcardsused', headerName: 'Wildcards Used', width: 130, sortable: false, filter: false },
        { field: 'wildcardscorrect', headerName: 'Wildcards Won', width: 130, sortable: false, filter: false },
        { field: 'perfectAccuracyText', headerName: 'Perfect %', width: 110, sortable: false, filter: false },
        { field: 'outcomeAccuracyText', headerName: 'Outcome %', width: 120, sortable: false, filter: false }
    ];

    // --- GRID SETUP ---
    const gridOptions = {
        columnDefs,
        rowData,
        rowHeight: 48,
        headerHeight: 44,
        domLayout: 'autoHeight', // grid grows to fit its rows rather than scrolling internally — fine for a leaderboard-sized list
        defaultColDef: {
            resizable: true
        },
        // Top 3 ranks get medal-coloured backgrounds. Set via inline
        // style (not a CSS class) — AG Grid applies its own row
        // striping internally, which can fight with class-based colour
        // overrides at similar CSS specificity. An inline style always
        // wins over any stylesheet rule, so this avoids that entirely.
        getRowStyle: (params) => {
            if (params.data.rank === 1) return { background: '#f5d67b' };   // gold
            if (params.data.rank === 2) return { background: '#d4d4d4' };   // silver
            if (params.data.rank === 3) return { background: '#dba36a' };   // bronze
            return { background: '#ffffff' };
        }
    };

    if (gridApi) {
        gridApi.destroy();
    }

    gridApi = agGrid.createGrid(gridContainer, gridOptions);
}

loadDashboard();