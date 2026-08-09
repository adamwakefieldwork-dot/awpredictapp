// Runs in the browser. Fetches the current league's settings, builds
// a form from them, and sends any edits back on Save — same fetch-then-
// render-then-save pattern as your-scores.js, just for a single object
// instead of an array of fixtures.

const formWrapper = document.getElementById('settings-form-wrapper');
const saveBtn = document.getElementById('save-button');
const saveMessage = document.getElementById('save-message');

// ---------------------------------------------------------------------
// FETCH + RENDER the settings form
// ---------------------------------------------------------------------
async function loadSettings() {
    formWrapper.innerHTML = '<p class="loading-msg">Loading league settings...</p>';

    try {
        const res = await fetch('/api/leaguesettings');
        const data = await res.json();

        if (!res.ok) {
            formWrapper.innerHTML = `<p class="loading-msg">${data.error || 'Failed to load settings'}</p>`;
            return;
        }

        renderForm(data.league);

    } catch (err) {
        formWrapper.innerHTML = '<p class="loading-msg">Network error — try again</p>';
    }
}

// ---------------------------------------------------------------------
// Build the form fields from the league object the server sent back.
// wildcardonoff is stored as 0/1 in SQLite — "checked" only gets added
// to the checkbox's HTML when it's 1, which is what makes it pre-ticked.
// ---------------------------------------------------------------------
function renderForm(league) {
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
        // joinid intentionally excluded — read-only, never sent back
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

// Run once on page load
loadSettings();