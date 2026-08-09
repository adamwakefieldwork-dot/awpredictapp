// Two independent forms on this page — username and password — each
// with their own button and message element, so a problem with one
// doesn't affect feedback for the other.

function showMessage(el, text, type) {
    el.textContent = text;
    el.className = `save-message ${type}`;
}

// --- CHANGE USERNAME ---
document.getElementById('username-save-button').addEventListener('click', async () => {
    const newUsername = document.getElementById('new-username').value;
    const messageEl = document.getElementById('username-message');

    if (!newUsername) {
        showMessage(messageEl, 'Enter a new username', 'error');
        return;
    }

    try {
        const res = await fetch('/api/change-username', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newUsername })
        });

        const data = await res.json();

        if (!res.ok) {
            showMessage(messageEl, data.error || 'Failed to update username', 'error');
            return;
        }

        showMessage(messageEl, 'Username updated!', 'success');
        document.getElementById('new-username').value = '';

    } catch (err) {
        showMessage(messageEl, 'Network error — try again', 'error');
    }
});

// --- CHANGE PASSWORD ---
document.getElementById('password-save-button').addEventListener('click', async () => {
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmNewPassword = document.getElementById('confirm-new-password').value;
    const messageEl = document.getElementById('password-message');

    if (!currentPassword || !newPassword || !confirmNewPassword) {
        showMessage(messageEl, 'Fill in all password fields', 'error');
        return;
    }

    // Client-side convenience check only — same reasoning as the
    // signup page's password-match check. The server never trusts
    // this; it separately verifies currentPassword itself.
    if (newPassword !== confirmNewPassword) {
        showMessage(messageEl, 'New passwords do not match', 'error');
        return;
    }

    try {
        const res = await fetch('/api/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const data = await res.json();

        if (!res.ok) {
            showMessage(messageEl, data.error || 'Failed to update password', 'error');
            return;
        }

        showMessage(messageEl, 'Password updated!', 'success');
        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-new-password').value = '';

    } catch (err) {
        showMessage(messageEl, 'Network error — try again', 'error');
    }
});