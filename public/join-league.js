// --- Feature flag check ---
async function applyFeatureFlags() {
    try {
        const res = await fetch('/api/app-config');
        const config = await res.json();

        if (!config.allowLeagueCreation) {
            // Hide the "Create a League" tab button and panel entirely.
            document.querySelector('.tab-btn[data-tab="create"]').style.display = 'none';
            document.getElementById('create-panel').remove();
        }
    } catch (err) {
        // If this fails, fall back to showing everything — fail open
        // rather than breaking the join flow over a feature-flag check.
    }
}

applyFeatureFlags();


// --- Tab switching ---
const tabButtons = document.querySelectorAll('.tab-btn');
const panels = {
    join: document.getElementById('join-panel'),
    create: document.getElementById('create-panel')
};

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        Object.values(panels).forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        panels[btn.dataset.tab].classList.add('active');
    });
});

// --- Join league form ---
document.getElementById('join-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const joinCode = document.getElementById('join-code').value;
    const errorEl = document.getElementById('join-error-message');

    try {
        const res = await fetch('/api/join-league', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ joinCode })
        });

        const data = await res.json();

        if (!res.ok) {
            errorEl.textContent = data.error || 'Something went wrong';
            return;
        }

        window.location.href = '/app/your-scores.html';

    } catch (err) {
        errorEl.textContent = 'Network error — try again';
    }
});

// --- Create league form ---
const competitionSelect = document.getElementById('competition-select');
const seasonSelect = document.getElementById('season-select');

async function loadCompetitions() {
    try {
        const res = await fetch('/api/competitions');
        const data = await res.json();
        const competitions = data.competitions;

        competitionSelect.innerHTML = '<option value="" disabled selected>Select a competition</option>';
        competitions.forEach(c => {
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
        seasons.forEach(s => {
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

document.getElementById('create-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const leagueName = document.getElementById('league-name').value;
    const competitionId = competitionSelect.value;
    const seasonId = seasonSelect.value;
    const errorEl = document.getElementById('create-error-message');

    try {
        const res = await fetch('/api/create-league', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: leagueName, competitionId, seasonId })
        });

        const data = await res.json();

        if (!res.ok) {
            errorEl.textContent = data.error || 'Something went wrong';
            return;
        }

        window.location.href = '/app/your-scores.html';

    } catch (err) {
        errorEl.textContent = 'Network error — try again';
    }
});

// Kick off competition loading on page load
loadCompetitions();

// --- Sign out ---
document.getElementById('signout-link').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/signout', { method: 'POST' });
    window.location.href = '/signin';
});