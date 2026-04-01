// src/utils/confirm.js
// Promise-based custom dialogs — replaces window.confirm() and window.prompt().

import { escapeHtml } from './utils.js';
import { bindOverlayDismiss } from './overlayDismiss.js';
import { t } from '../i18n.js';

/**
 * showConfirm({ message, confirmText, cancelText, danger })
 * Returns Promise<boolean> — true if confirmed, false if cancelled.
 */
export function showConfirm({
  message     = t('are_you_sure'),
  confirmText = t('confirm'),
  cancelText  = t('cancel'),
  danger      = true,
} = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'cfdialog';
    root.setAttribute('role', 'alertdialog');
    root.setAttribute('aria-modal', 'true');

    root.innerHTML = `
      <div class="cfdialog__box">
        <p class="cfdialog__msg">${escapeHtml(message)}</p>
        <div class="cfdialog__btns">
          <button class="cfdialog__btn cfdialog__btn--cancel" type="button">
            ${escapeHtml(cancelText)}
          </button>
          <button class="cfdialog__btn ${danger ? 'cfdialog__btn--danger' : 'cfdialog__btn--primary'}" type="button">
            ${escapeHtml(confirmText)}
          </button>
        </div>
      </div>
    `;

    const cancelBtn  = root.querySelector('.cfdialog__btn--cancel');
    const confirmBtn = root.querySelector(`.cfdialog__btn--${danger ? 'danger' : 'primary'}`);

    let resolved = false;

    function close(result) {
      if (resolved) return;
      resolved = true;

      dismissCleanup();
      root.classList.remove('cfdialog--visible');

      const onEnd = () => { root.remove(); };
      root.querySelector('.cfdialog__box').addEventListener('transitionend', onEnd, { once: true });
      setTimeout(onEnd, 300); // fallback

      resolve(result);
    }

    function onKey(e) {
      if (e.key === 'Enter')  { e.preventDefault(); close(true);  }
    }

    cancelBtn.addEventListener('click',  () => close(false));
    confirmBtn.addEventListener('click', () => close(true));

    const dismissCleanup = bindOverlayDismiss({
      overlay: root,
      onDismiss: () => close(false),
      shouldDismissOnOverlay: (event, overlayEl) => event.target === overlayEl,
    });

    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);

    // Double rAF so the transition fires after display
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.add('cfdialog--visible');
      cancelBtn.focus(); // focus Cancel so accidental Enter doesn't confirm
    }));
  });
}

/**
 * showRoundPicker({ rounds, currentRound })
 * Returns Promise<number | null> — selected roundId, or null if cancelled.
 */
export function showRoundPicker({ rounds = [], currentRound = 0 } = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'cfdialog cfdialog--round-picker';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', t('select_round'));

    const tiles = rounds.map((name, i) => `
      <button type="button" class="round-tile${i === currentRound ? ' is-active' : ''}" data-round="${i}">
        ${escapeHtml(String(name))}
      </button>
    `).join('');

    root.innerHTML = `
      <div class="cfdialog__box">
        <p class="cfdialog__msg">${escapeHtml(t('select_round'))}</p>
        <div class="round-grid" role="group" aria-label="${escapeHtml(t('select_round'))}">
          ${tiles}
        </div>
      </div>
    `;

    let resolved = false;

    function close(result) {
      if (resolved) return;
      resolved = true;
      dismissCleanup();
      root.classList.remove('cfdialog--visible');
      const onEnd = () => root.remove();
      root.querySelector('.cfdialog__box').addEventListener('transitionend', onEnd, { once: true });
      setTimeout(onEnd, 300);
      resolve(result);
    }

    root.querySelectorAll('.round-tile').forEach(btn => {
      btn.addEventListener('click', () => close(Number(btn.dataset.round)));
    });

    const dismissCleanup = bindOverlayDismiss({
      overlay: root,
      onDismiss: () => close(null),
      shouldDismissOnOverlay: (event, overlayEl) => event.target === overlayEl,
    });

    document.body.appendChild(root);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.add('cfdialog--visible');
      root.querySelector('.round-tile.is-active')?.focus();
    }));
  });
}

/**
 * showPrompt({ message, placeholder, confirmText, cancelText, defaultValue })
 * Returns Promise<string | null> — trimmed string if confirmed, null if cancelled.
 */
export function showPrompt({
  message      = t('enter_value'),
  placeholder  = '',
  confirmText  = t('ok'),
  cancelText   = t('cancel'),
  defaultValue = '',
} = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'cfdialog';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');

    root.innerHTML = `
      <div class="cfdialog__box">
        <p class="cfdialog__msg">${escapeHtml(message)}</p>
        <input
          class="cfdialog__input"
          type="text"
          placeholder="${escapeHtml(placeholder)}"
          value="${escapeHtml(defaultValue)}"
          autocomplete="off"
          spellcheck="false"
        />
        <div class="cfdialog__btns">
          <button class="cfdialog__btn cfdialog__btn--cancel" type="button">
            ${escapeHtml(cancelText)}
          </button>
          <button class="cfdialog__btn cfdialog__btn--primary" type="button">
            ${escapeHtml(confirmText)}
          </button>
        </div>
      </div>
    `;

    const cancelBtn  = root.querySelector('.cfdialog__btn--cancel');
    const confirmBtn = root.querySelector('.cfdialog__btn--primary');
    const input      = root.querySelector('.cfdialog__input');

    let resolved = false;

    function close(result) {
      if (resolved) return;
      resolved = true;
      dismissCleanup();

      root.classList.remove('cfdialog--visible');

      const onEnd = () => { root.remove(); };
      root.querySelector('.cfdialog__box').addEventListener('transitionend', onEnd, { once: true });
      setTimeout(onEnd, 300); // fallback

      resolve(result);
    }

    function submit() {
      const val = input.value.trim();
      if (val) close(val);
      else input.focus(); // keep open if empty
    }

    // Enter in the input submits; Escape cancels
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
    });

    cancelBtn.addEventListener('click',  () => close(null));
    confirmBtn.addEventListener('click', () => submit());

    const dismissCleanup = bindOverlayDismiss({
      overlay: root,
      onDismiss: () => close(null),
      shouldDismissOnOverlay: (event, overlayEl) => event.target === overlayEl,
    });

    document.body.appendChild(root);

    // Double rAF so the transition fires after display
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.classList.add('cfdialog--visible');
      // Select all text in input so user can immediately type a new name
      input.focus();
      input.select();
    }));
  });
}
