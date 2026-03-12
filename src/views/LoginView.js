// src/views/LoginView.js
import { signInWithGoogle } from '../api/authApi.js';

export function renderLogin(root) {
    root.innerHTML = `
        <div class="login-screen">
            <div class="login-card">
                <h1>Quiz Game</h1>
                <p>Sign in to continue</p>
                <button id="googleLoginBtn" class="btn-google">
                    Sign in with Google
                </button>
                <p id="loginError" class="login-error" style="display:none"></p>
            </div>
        </div>
    `;

    document.getElementById('googleLoginBtn').addEventListener('click', async () => {
        const btn = document.getElementById('googleLoginBtn');
        btn.disabled = true;
        btn.textContent = 'Please wait...';

        const { error } = await signInWithGoogle();
        if (error) {
            const errEl = document.getElementById('loginError');
            errEl.textContent = `Error: ${error.message}`;
            errEl.style.display = '';
            btn.disabled = false;
            btn.textContent = 'Sign in with Google';
        }
    });
}

export function renderAccessDenied(root, user, onLogout) {
    root.innerHTML = `
        <div class="login-screen">
            <div class="login-card">
                <h1>Access Denied</h1>
                <p>Account <strong>${user.email}</strong> does not have access to this app.</p>
                <p>Please contact the administrator.</p>
                <button id="logoutBtn">Logout</button>
            </div>
        </div>
    `;
    document.getElementById('logoutBtn').addEventListener('click', onLogout);
}
