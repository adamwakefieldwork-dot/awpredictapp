// Runs in the browser. Fetches the current league's settings, builds
// a form from them, and sends any edits back on Save — same fetch-then-
// render-then-save pattern as your-scores.js, just for a single object
// instead of an array of fixtures.

const formWrapper = document.getElementById('settings-form-wrapper');
const saveBtn = document.getElementById('save-button');
const saveMessage = document.getElementById('save-message');

let allowLeagueCreation = false; // fetched once, used by both sections below

// ---------------------------------------------------------------------
// FETCH + RENDER the settings form
// ---------------------------------------------------------------------
async function loadSettings() {
    formWrapper.innerHTML = '<p class="loading-msg">Loading league settings...</p>';

    try {
        const res = await fetch('/api/leaguesettings');
        const data = await res.json();

        if (!res.ok) {
            // A 403 here just means "you don't own the currently selected
            // league" — expected and fine if they're here to CREATE one,
            // not edit an existing one. Show something friendlier than
            // the raw error in that case, and hide the Save button since
            // there's nothing to save.
            if (res.status === 403 && allowLeagueCreation) {
                formWrapper.innerHTML = '<p class="loading-msg">You don\'t manage a league yet — create one below.</p>';
                saveBtn.style.display = 'none';
                return;
            }

            formWrapper.innerHTML = `<p class="loading-msg">${data.error || 'Failed to load settings'}</p>`;
            saveBtn.style.display = 'none';
            return;
        }

        saveBtn.style.display = '';
        renderForm(data.league);

    } catch (err) {
        formWrapper.innerHTML = '<p class="loading-msg">Network error — try again</p>';
    }
}

// ---------------------------------------------------------------------
// Build the form fields from the league object the server sent back.
// wildcardonoff is stored as 0/1 in SQLite — "checked" only gets added
// to the checkbox's HTML when it's 1, which is what makes it pre-ticked.
//
// competitionname and season are read-only, same treatment as join-id —
// a league's competition/season is fixed at creation time, so there's
// nothing to send back for these on Save.
// ---------------------------------------------------------------------
function renderForm(league) {
    const seasonLabel = formatSeason(league.seasonstartdate, league.seasonenddate);

    formWrapper.innerHTML = `
        <div class="settings-form">

            <div class="settings-row">
                <label for="league-name">League Name</label>
                <input type="text" id="league-name" value="${league.name}">
            </div>

            <div class="settings-row">
                <label for="join-id">Join Code</label>
                <input type="text" id="join-id" value="${league.joinid}" readonly>
            </div>

            <div class="settings-row">
                <label for="competition-name">Competition</label>
                <input type="text" id="competition-name" value="${league.competitionname}" readonly>
            </div>

            <div class="settings-row">
                <label for="season">Season</label>
                <input type="text" id="season" value="${seasonLabel}" readonly>
            </div>

            <div class="settings-row">
                <label for="wildcard-toggle">Wildcard Enabled</label>
                <input type="checkbox" id="wildcard-toggle" ${league.wildcardonoff ? 'checked' : ''}>
            </div>

            <div class="settings-row">
                <label for="win-score">Win Score</label>
                <input type="number" id="win-score" value="${league.winscore}">
            </div>

            <div class="settings-row">
                <label for="perfect-score">Perfect Score</label>
                <input type="number" id="perfect-score" value="${league.perfectscore}">
            </div>

            <div class="settings-row">
                <label for="lose-score">Lose Score</label>
                <input type="number" id="lose-score" value="${league.losescore}">
            </div>

            <div class="settings-row">
                <label for="wildcard-win-score">Wildcard Win Score</label>
                <input type="number" id="wildcard-win-score" value="${league.wildcardwinscore}">
            </div>

            <div class="settings-row">
                <label for="wildcard-lose-score">Wildcard Lose Score</label>
                <input type="number" id="wildcard-lose-score" value="${league.wildcardlosescore}">
            </div>

            <div class="settings-row">
                <label for="hide-time">Hide Time</label>
                <input type="time" id="hide-time" value="${league.hidetime ?? ''}">
            </div>

        </div>
    `;
}

// ---------------------------------------------------------------------
// Turns seasonstartdate/seasonenddate ("2025-08-01"/"2026-05-24") into
// a compact "2025/26" style label. Falls back gracefully if either
// date is missing.
// ---------------------------------------------------------------------
function formatSeason(startdate, enddate) {
    if (!startdate) return '';

    const startYear = startdate.slice(0, 4);
    const endYear = enddate ? enddate.slice(0, 4) : null;

    if (!endYear || endYear === startYear) {
        return startYear;
    }

    return `${startYear}/${endYear.slice(2)}`;
}

// ---------------------------------------------------------------------
// SAVE — read every field's current value and send it as one object.
// ---------------------------------------------------------------------
saveBtn.addEventListener('click', async () => {
    const payload = {
        name: document.getElementById('league-name').value,
        wildcardonoff: document.getElementById('wildcard-toggle').checked,
        winscore: Number(document.getElementById('win-score').value),
        perfectscore: Number(document.getElementById('perfect-score').value),
        losescore: Number(document.getElementById('lose-score').value),
        wildcardwinscore: Number(document.getElementById('wildcard-win-score').value),
        wildcardlosescore: Number(document.getElementById('wildcard-lose-score').value),
        hidetime: document.getElementById('hide-time').value
        // joinid, competitionname, season intentionally excluded —
        // all read-only, never sent back
    };

    try {
        const res = await fetch('/api/leaguesettings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (!res.ok) {
            showSaveMessage(data.error || 'Failed to save', 'error');
            return;
        }

        showSaveMessage('Settings saved!', 'success');

    } catch (err) {
        showSaveMessage('Network error — try again', 'error');
    }
});

function showSaveMessage(text, type) {
    saveMessage.textContent = text;
    saveMessage.className = `save-message ${type}`;
}

// =======================================================================
// CREATE A LEAGUE — only appears on this page at all if the site-wide
// ALLOW_LEAGUE_CREATION flag is on. Anyone can see and use this section
// when the flag is on, regardless of whether they already own a league —
// that's a deliberate choice, not a bug: someone can own League A and
// still want to spin up League B.
// =======================================================================
async function initCreateLeagueSection() {
    try {
        const res = await fetch('/api/app-config');
        const config = await res.json();
        allowLeagueCreation = !!config.allowLeagueCreation;

        if (!allowLeagueCreation) return; // section simply never renders

        renderCreateLeagueSection();

    } catch (err) {
        // If the flag check itself fails, fail closed — don't show the
        // section rather than risk offering an action that's actually disabled.
    }
}

function renderCreateLeagueSection() {
    const section = document.createElement('div');
    section.className = 'settings-form create-league-section';
    section.innerHTML = `
        <h2>Create a New League</h2>
        <p class="subtitle">Start another league — pick a competition and season, then give it a name</p>

        <div class="settings-row">
            <label for="new-league-name">League Name</label>
            <input type="text" id="new-league-name" placeholder="e.g. Office Predictions">
        </div>

        <div class="settings-row">
            <label for="new-competition-select">Competition</label>
            <select id="new-competition-select">
                <option value="" disabled selected>Loading competitions...</option>
            </select>
        </div>

        <div class="settings-row">
            <label for="new-season-select">Season</label>
            <select id="new-season-select" disabled>
                <option value="" disabled selected>Select a competition first</option>
            </select>
        </div>

        <p id="create-league-message" class="save-message"></p>

        <button id="create-league-button" class="btn-save" type="button">Create League</button>
    `;

    // .settings-box (the outer rounded container) already wraps both
    // #settings-form-wrapper and the Save button — inserting after
    // formWrapper keeps this section visually inside that same box,
    // rather than escaping it.
    formWrapper.insertAdjacentElement('afterend', section);

    wireUpCreateLeagueSection();
}

function wireUpCreateLeagueSection() {
    const competitionSelect = document.getElementById('new-competition-select');
    const seasonSelect = document.getElementById('new-season-select');
    const createBtn = document.getElementById('create-league-button');
    const createMessage = document.getElementById('create-league-message');

    async function loadCompetitions() {
        try {
            const res = await fetch('/api/competitions');
            const data = await res.json();
            const competitions = data.competitions;

            competitionSelect.innerHTML = '<option value="" disabled selected>Select a competition</option>';
            competitions.forEach((c) => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.name;
                competitionSelect.appendChild(opt);
            });
        } catch (err) {
            competitionSelect.innerHTML = '<option value="" disabled selected>Failed to load</option>';
        }
    }

    competitionSelect.addEventListener('change', async () => {
        const competitionId = competitionSelect.value;
        seasonSelect.disabled = true;
        seasonSelect.innerHTML = '<option value="" disabled selected>Loading seasons...</option>';

        try {
            const res = await fetch(`/api/competitions/${competitionId}/seasons`);
            const data = await res.json();
            const seasons = data.seasons;

            seasonSelect.innerHTML = '<option value="" disabled selected>Select a season</option>';
            seasons.forEach((s) => {
                const opt = document.createElement('option');
                opt.value = s.id;
                const start = s.startdate ? s.startdate.slice(0, 4) : '';
                const end = s.enddate ? s.enddate.slice(0, 4) : '';
                opt.textContent = `${start}${end && end !== start ? '/' + end : ''}`;
                seasonSelect.appendChild(opt);
            });
            seasonSelect.disabled = false;
        } catch (err) {
            seasonSelect.innerHTML = '<option value="" disabled selected>Failed to load</option>';
        }
    });

    createBtn.addEventListener('click', async () => {
        const name = document.getElementById('new-league-name').value;
        const competitionId = competitionSelect.value;
        const seasonId = seasonSelect.value;

        if (!name || !competitionId || !seasonId) {
            createMessage.textContent = 'Please fill in all fields';
            createMessage.className = 'save-message error';
            return;
        }

        try {
            const res = await fetch('/api/create-league', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, competitionId, seasonId })
            });

            const data = await res.json();

            if (!res.ok) {
                createMessage.textContent = data.error || 'Failed to create league';
                createMessage.className = 'save-message error';
                return;
            }

            // Successfully created — the new league becomes currentleague
            // server-side, so send them to Your Scores for it, same as
            // the join-league flow does.
            window.location.href = '/app/your-scores.html';

        } catch (err) {
            createMessage.textContent = 'Network error — try again';
            createMessage.className = 'save-message error';
        }
    });

    loadCompetitions();
}

// Run both on page load.
initCreateLeagueSection();
loadSettings();