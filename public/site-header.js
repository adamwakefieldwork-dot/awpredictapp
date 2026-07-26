// Handles the hamburger menu toggle for the site header. Shared across
// every page that uses this header, so it lives in its own small file
// rather than being duplicated inside your-scores.js, dashboard.js, etc.

const navToggle = document.getElementById('nav-toggle');
const mainNav = document.getElementById('main-nav');

navToggle.addEventListener('click', () => {
    // Adds the class if it's missing, removes it if present —
    // classList.toggle() does exactly that in one line.
    mainNav.classList.toggle('nav-open');
});

// --- LEAGUE DROPDOWN ---
// Fetches the logged-in user's leagues and fills the dropdown with them.

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

        // Build one <option> per league, using the SAME html += pattern
        // you already used in renderFixtures().
        let optionsHtml = '';
        for (const league of data.leagues) {
            optionsHtml += `<option value="${league.id}">${league.name}</option>`;
        }

        dropdown.innerHTML = optionsHtml;

    } catch (err) {
        console.error('League fetch failed:', err);
        dropdown.innerHTML = '<option>Network error</option>';
    }
}

loadLeagues();