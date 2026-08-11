// Handles the hamburger menu toggle AND the league dropdown for the
// site header. Shared across every page that uses this header.

const navToggle = document.getElementById('nav-toggle');
const mainNav = document.getElementById('main-nav');

navToggle.addEventListener('click', () => {
    mainNav.classList.toggle('nav-open');
});

// --- LEAGUE DROPDOWN + LEAGUE SETTINGS NAV VISIBILITY ---
//
// "League Settings" shows if EITHER of these is true:
//   1. The user owns the currently selected league (they need somewhere
//      to manage it), OR
//   2. League creation is switched on site-wide (everyone needs a way
//      to reach the "Create a League" section, even if they don't own
//      anything yet).
// It only hides when NEITHER is true — a non-owner with creation
// switched off has no reason to be on this page at all.

async function loadLeagues() {
    const dropdown = document.getElementById('league-dropdown');

    let currentLeagueIsOwned = false;

    try {
        const res = await fetch('/api/leagues');
        const data = await res.json();

        if (!res.ok) {
            dropdown.innerHTML = '<option>Error loading leagues</option>';
        } else if (data.leagues.length === 0) {
            dropdown.innerHTML = '<option>No leagues joined</option>';
        } else {
            let optionsHtml = '';
            for (const league of data.leagues) {
                const isSelected = league.id === data.currentleague ? 'selected' : '';
                optionsHtml += `<option value="${league.id}" ${isSelected}>${league.name}</option>`;
            }
            dropdown.innerHTML = optionsHtml;

            const current = data.leagues.find((l) => l.id === data.currentleague);
            currentLeagueIsOwned = !!(current && current.owner === 'yes');
        }

    } catch (err) {
        dropdown.innerHTML = '<option>Network error</option>';
    }

    await updateLeagueSettingsVisibility(currentLeagueIsOwned);
}

async function updateLeagueSettingsVisibility(currentLeagueIsOwned) {
    const settingsLink = document.getElementById('league-settings-link');
    if (!settingsLink) return; // page doesn't have this link at all — nothing to do

    let allowLeagueCreation = false;

    try {
        const res = await fetch('/api/app-config');
        const config = await res.json();
        allowLeagueCreation = !!config.allowLeagueCreation;
    } catch (err) {
        // If this check fails, fall back to ownership-only visibility —
        // fail closed on the extra permission, not on the base case.
    }

    const shouldShow = currentLeagueIsOwned || allowLeagueCreation;
    settingsLink.style.display = shouldShow ? '' : 'none';
}

loadLeagues();