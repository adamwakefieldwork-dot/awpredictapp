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