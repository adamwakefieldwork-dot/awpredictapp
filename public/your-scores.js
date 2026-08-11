// This whole file runs in the BROWSER. It never touches the database
// directly — every piece of data comes from server.js via fetch(), and
// every save goes back to server.js the same way. This file's only job
// is: ask for data, draw it on screen, and collect what the user types.

// currentGameweek is the one piece of "state" this page needs to track
// between renders. It starts at null because we don't know the right
// starting gameweek until the server tells us (see loadGameweek below).
let currentGameweek = null;
let minGameweek = null;
let maxGameweek = null;
let wildcardEnabled = false; // set from the league's own settings each load

// Grab references to the DOM elements we'll be updating repeatedly,
// so we don't have to re-query them every time.
const fixturesList = document.getElementById('fixtures-list');
const gameweekLabel = document.getElementById('gameweek-label');
const prevBtn = document.getElementById('prev-gameweek');
const nextBtn = document.getElementById('next-gameweek');
const saveBtn = document.getElementById('save-button');
const saveMessage = document.getElementById('save-message');

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

// ---------------------------------------------------------------------
// FETCH + RENDER a given gameweek's fixtures
// ---------------------------------------------------------------------
async function loadGameweek(gameweek) {
    fixturesList.innerHTML = '<p class="loading-msg">Loading fixtures...</p>';

    // If gameweek is null, we're asking the server to pick a sensible
    // default (e.g. the earliest gameweek that still has unplayed games).
    // Otherwise we ask for a specific one, passed as a query string param.
    const url = gameweek === null
        ? '/api/scores'
        : `/api/scores?gameweek=${gameweek}`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        if (!res.ok) {
            fixturesList.innerHTML = `<p class="loading-msg">${data.error || 'Failed to load fixtures'}</p>`;
            return;
        }

        // Remember what the server decided, so the arrows know their limits
        // and so Save knows which gameweek it's submitting for.
        currentGameweek = data.gameweek;
        minGameweek = data.minGameweek;
        maxGameweek = data.maxGameweek;
        wildcardEnabled = data.wildcardEnabled;

        renderGameweekLabel();
        renderFixtures(data.games);

    } catch (err) {
        fixturesList.innerHTML = '<p class="loading-msg">Network error — try again</p>';
    }
}

// ---------------------------------------------------------------------
// Update the "Gameweek X" label and disable arrows at the boundaries
// ---------------------------------------------------------------------
function renderGameweekLabel() {
    gameweekLabel.textContent = `Game Week ${currentGameweek}`;

    // Disable "previous" once we're at the earliest gameweek that exists
    // in the games table — nothing to navigate back to beyond that.
    prevBtn.disabled = (currentGameweek <= minGameweek);
    nextBtn.disabled = (currentGameweek >= maxGameweek);
}

// ---------------------------------------------------------------------
// Build the fixture rows from the games array the server sent us.
// This is the dynamic part — nothing here is written in the HTML file,
// because the number of games and their content depends on the database.
// ---------------------------------------------------------------------
function renderFixtures(games) {
    if (games.length === 0) {
        fixturesList.innerHTML = '<p class="loading-msg">No fixtures for this gameweek</p>';
        return;
    }

    // Build up one HTML string for all rows, then insert it once.
    // (Doing this in a loop with += is fine at this scale — 10 rows,
    // not 10,000 — so there's no real performance concern here.)
    let html = '';

        for (const game of games) {
        // A game is editable only if it hasn't finished AND we're not within
        // one hour of kickoff. Comparing raw Date objects (not localized
        // strings) means this works correctly regardless of the viewer's own
        // timezone — game.date is UTC, Date.now() is UTC under the hood, so
        // the one-hour cutoff lines up with the actual kickoff instant either way.
        const kickoff = new Date(game.date);
        const oneHourBeforeKickoff = new Date(kickoff.getTime() - 60 * 60 * 1000);
        const isEditable = game.status !== 'FINISHED' && Date.now() < oneHourBeforeKickoff.getTime();

        const date = formatFixtureDate(game.date);
        const homeVal = game.predictedHomeScore ?? '';
        const awayVal = game.predictedAwayScore ?? '';

        const wildcardCheckbox = wildcardEnabled
            ? `
                <label class="wildcard-toggle" title="Use wildcard scoring for this game">
                    <input
                        type="checkbox"
                        class="wildcard-checkbox"
                        ${game.wildcardUsed ? 'checked' : ''}
                        ${isEditable ? '' : 'disabled'}
                    >
                    <span class="wildcard-star">★</span>
                </label>
            `
            : '';

        html += `
            <div class="fixture-block">
                <div class="date-label">${date}</div>

                <div class="fixture-row" data-game-id="${game.id}" data-lock-at="${oneHourBeforeKickoff.getTime()}" data-status="${game.status}">
                    <img
                        class="team-crest"
                        src="${game.hometeamcrest ?? ''}"
                        alt="${game.hometeamname} crest"
                        onerror="this.style.visibility='hidden'"
                    >
                    <span class="home-team-name">${game.hometeamname}</span>

                    <input
                        type="number"
                        min="0"
                        class="score-input home-score-input"
                        value="${homeVal}"
                        ${isEditable ? '' : 'disabled'}
                    >

                    <span class="score-dash">-</span>

                    <input
                        type="number"
                        min="0"
                        class="score-input away-score-input"
                        value="${awayVal}"
                        ${isEditable ? '' : 'disabled'}
                    >

                    <span class="away-team-name">${game.awayteamname}</span>
                    <img
                        class="team-crest"
                        src="${game.awayteamcrest ?? ''}"
                        alt="${game.awayteamname} crest"
                        onerror="this.style.visibility='hidden'"
                    >
                </div>

                ${wildcardCheckbox}
            </div>
        `;
    }

    fixturesList.innerHTML = html;
}

// ---------------------------------------------------------------------
// LIVE LOCKOUT CHECK — runs periodically so a fixture locks itself
// (score inputs + wildcard checkbox) the moment it crosses the
// one-hour-before-kickoff cutoff, even if the user never reloads the
// page. This does NOT re-render anything — it only flips `disabled`
// on existing inputs, so nothing the user has already typed is lost.
// ---------------------------------------------------------------------
function checkLockouts() {
    const rows = document.querySelectorAll('.fixture-row');
    const now = Date.now();

    rows.forEach((row) => {
        const lockAt = Number(row.dataset.lockAt);
        const status = row.dataset.status;
        const shouldBeLocked = status === 'FINISHED' || now >= lockAt;

        if (!shouldBeLocked) return; // still editable, nothing to do

        const homeInput = row.querySelector('.home-score-input');
        const awayInput = row.querySelector('.away-score-input');

        // Only touch things that aren't ALREADY disabled — avoids
        // pointlessly reassigning the same value every tick.
        if (!homeInput.disabled) homeInput.disabled = true;
        if (!awayInput.disabled) awayInput.disabled = true;

        const block = row.closest('.fixture-block');
        const wildcardInput = block ? block.querySelector('.wildcard-checkbox') : null;
        if (wildcardInput && !wildcardInput.disabled) wildcardInput.disabled = true;
    });
}

// Check every 30 seconds — frequent enough that a fixture locks within
// half a minute of crossing the cutoff, without hammering the DOM.
setInterval(checkLockouts, 30000);

// ---------------------------------------------------------------------
// WILDCARD — enforce "only one per gameweek" the moment the user ticks
// a box, rather than waiting until Save to reject it. Every fixture on
// screen belongs to the SAME gameweek, so unchecking every other
// wildcard checkbox on the page is correct and sufficient here.
// Delegated on fixturesList (rather than attached per-checkbox) since
// renderFixtures() replaces the whole innerHTML on every gameweek
// change, which would silently drop any listeners bound directly to
// the old checkboxes.
// ---------------------------------------------------------------------
fixturesList.addEventListener('change', (e) => {
    if (!e.target.classList.contains('wildcard-checkbox')) return;

    if (e.target.checked) {
        const allWildcardBoxes = document.querySelectorAll('.wildcard-checkbox');
        allWildcardBoxes.forEach((box) => {
            if (box !== e.target) {
                box.checked = false;
            }
        });
    }
});

// ---------------------------------------------------------------------
// GAMEWEEK ARROWS — just change the number and re-fetch/re-render.
// No page reload, no full navigation — same page, new data.
// ---------------------------------------------------------------------
prevBtn.addEventListener('click', () => {
    if (currentGameweek > minGameweek) {
        loadGameweek(currentGameweek - 1);
    }
});

nextBtn.addEventListener('click', () => {
    if (currentGameweek < maxGameweek) {
        loadGameweek(currentGameweek + 1);
    }
});

// ---------------------------------------------------------------------
// SAVE — read every visible fixture row's inputs, bundle them into one
// array, and send them all to the server in a single request.
// ---------------------------------------------------------------------
saveBtn.addEventListener('click', async () => {
    // .fixture-block wraps both the .fixture-row AND its wildcard
    // checkbox (which lives as a sibling, not inside .fixture-row),
    // so we iterate blocks and reach into each for its pieces.
    const blocks = document.querySelectorAll('.fixture-block');

    const predictions = [];

    for (const block of blocks) {
        const row = block.querySelector('.fixture-row');
        const gameId = row.dataset.gameId; // reads data-game-id="..." we set above
        const homeInput = row.querySelector('.home-score-input');
        const awayInput = row.querySelector('.away-score-input');
        const wildcardInput = block.querySelector('.wildcard-checkbox');

        // Skip rows that are disabled (game already played) — nothing
        // to save for those, and we don't want to accidentally overwrite
        // an existing prediction with an empty value.
        if (homeInput.disabled) continue;

        // Skip rows where the user hasn't actually entered anything yet.
        if (homeInput.value === '' || awayInput.value === '') continue;

        predictions.push({
            gameId: Number(gameId),
            hometeamscore: Number(homeInput.value),
            awayteamscore: Number(awayInput.value),
            // wildcardInput won't exist at all if the league doesn't have
            // wildcards enabled, so default to false in that case.
            wildcardUsed: wildcardInput ? wildcardInput.checked : false
        });
    }

    if (predictions.length === 0) {
        showSaveMessage('Nothing to save', 'error');
        return;
    }

    try {
        const res = await fetch('/api/scores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ predictions })
        });

        const data = await res.json();

        if (!res.ok) {
            showSaveMessage(data.error || 'Failed to save', 'error');
            return;
        }

        showSaveMessage('Predictions saved!', 'success');

    } catch (err) {
        showSaveMessage('Network error — try again', 'error');
    }
});

function showSaveMessage(text, type) {
    saveMessage.textContent = text;
    saveMessage.className = `save-message ${type}`; // adds "success" or "error" class for coloring
}

// ---------------------------------------------------------------------
// Run once when the page first loads — fetch whatever gameweek the
// server decides is the sensible default.
// ---------------------------------------------------------------------
loadGameweek(null);