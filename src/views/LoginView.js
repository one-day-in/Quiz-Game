// src/views/LoginView.js
import { signInWithGoogle } from '../api/authApi.js';
import { escapeHtml } from '../utils/utils.js';
import { t } from '../i18n.js';

export function renderLogin(root) {
    root.innerHTML = `
        <div class="login-screen">
            <div class="login-card">
                <h1>Quiz Game</h1>
                <p>${t('login_continue')}</p>
                <button id="googleLoginBtn" class="btn-google">
                    ${t('sign_in_google')}
                </button>
                <p id="loginError" class="login-error" style="display:none"></p>
            </div>
        </div>
    `;

    document.getElementById('googleLoginBtn').addEventListener('click', async () => {
        const btn = document.getElementById('googleLoginBtn');
        btn.disabled = true;
        btn.textContent = t('please_wait');

        const { error } = await signInWithGoogle();
        if (error) {
            const errEl = document.getElementById('loginError');
            errEl.textContent = `${t('error_prefix')}: ${error.message}`;
            errEl.style.display = '';
            btn.disabled = false;
            btn.textContent = t('sign_in_google');
        }
    });
}

export function renderAccessDenied(root, user, onLogout) {
    root.innerHTML = `
        <div class="login-screen">
            <div class="login-card">
                <h1>${t('access_denied')}</h1>
                <p>${t('access_denied_message', { email: `<strong>${escapeHtml(user.email)}</strong>` })}</p>
                <p>${t('contact_admin')}</p>
                <button id="logoutBtn">${t('logout')}</button>
            </div>
        </div>
    `;
    document.getElementById('logoutBtn').addEventListener('click', onLogout);
}
