// Handles the hamburger menu toggle AND the league dropdown for the
// site header. Shared across every page that uses this header.

const navToggle = document.getElementById('nav-toggle');
const mainNav = document.getElementById('main-nav');

navToggle.addEventListener('click', () => {
    mainNav.classList.toggle('nav-open');
});

// --- LEAGUE DROPDOWN + OWNERSHIP-BASED NAV VISIBILITY ---

async function loadLeagues() {
    const dropdown = document.getElementById('league-dropdown');

    try {
        const res = await fetch('/api/leagues');
        const data = await res.json();

        if (!res.ok) {
            dropdown.innerHTML = '<option>Error loading leagues</option>';
            return;
        }

        if (data.leagues.length === 0) {
            dropdown.innerHTML = '<option>No leagues joined</option>';
            return;
        }

        let optionsHtml = '';
        for (const league of data.leagues) {
            const isSelected = league.id === data.currentleague ? 'selected' : '';
            optionsHtml += `<option value="${league.id}" ${isSelected}>${league.name}</option>`;
        }
        dropdown.innerHTML = optionsHtml;

        // Only show "League Settings" in the nav if the CURRENTLY
        // selected league is one this user owns. Every page that
        // includes this header should give its League Settings link
        // this id for the hide/show to work.
        const settingsLink = document.getElementById('league-settings-link');
        if (settingsLink) {
            const current = data.leagues.find((l) => l.id === data.currentleague);
            settingsLink.style.display = (current && current.owner === 'yes') ? '' : 'none';
        }

    } catch (err) {
        dropdown.innerHTML = '<option>Network error</option>';
    }
}

loadLeagues();