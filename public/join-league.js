document.getElementById('join-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const joinCode = document.getElementById('join-code').value;
    const errorEl = document.getElementById('error-message');

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

        // Successfully joined — currentleague is now set server-side,
        // so any protected page will pass requireLeague from here on.
        window.location.href = '/app/your-scores.html';

    } catch (err) {
        errorEl.textContent = 'Network error — try again';
    }
});

document.getElementById('signout-link').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/signout', { method: 'POST' });
    window.location.href = '/signin';
});