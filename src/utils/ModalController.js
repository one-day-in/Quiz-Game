import { Disposer } from './disposer.js';
import { bindOverlayDismiss } from './overlayDismiss.js';

export class ModalController {
  constructor({
    modalClassName = '',
    dialogClassName = '',
    ariaLabel = '',
    closeOnEscape = true,
    onRequestClose = null,
  } = {}) {
    this._onRequestClose = onRequestClose;
    this._isOpen = false;
    this._disposer = new Disposer();

    const root = document.createElement('div');
    root.className = `qmodal ${modalClassName}`.trim();
    root.hidden = true;
    const dialogClasses = ['qmodal__dialog', dialogClassName].filter(Boolean).join(' ');
    root.innerHTML = `
      <div class="qmodal__overlay"></div>
      <div class="${dialogClasses}" role="dialog" aria-modal="true"></div>
    `;

    if (ariaLabel) {
      root.querySelector('.qmodal__dialog')?.setAttribute('aria-label', ariaLabel);
    }

    this._root = root;
    this._overlay = root.querySelector('.qmodal__overlay');
    this._dialog = root.querySelector('.qmodal__dialog');

    bindOverlayDismiss({
      disposer: this._disposer,
      overlay: this._overlay,
      onDismiss: () => this._onRequestClose?.(),
      closeOnEscape,
      shouldDismissOnEscape: () => this._isOpen,
    });
  }

  get root() {
    return this._root;
  }

  get dialog() {
    return this._dialog;
  }

  isOpen() {
    return this._isOpen;
  }

  setAriaLabel(label = '') {
    if (!this._dialog) return;
    if (!label) {
      this._dialog.removeAttribute('aria-label');
      return;
    }
    this._dialog.setAttribute('aria-label', String(label));
  }

  setContent(node) {
    if (!this._dialog) return;
    this._dialog.replaceChildren();
    if (node) this._dialog.appendChild(node);
  }

  open() {
    if (this._isOpen) return;
    if (!this._root.isConnected) document.body.appendChild(this._root);
    this._root.hidden = false;
    this._isOpen = true;
  }

  close() {
    if (!this._isOpen) return;
    this._isOpen = false;
    this._root.hidden = true;
    this._root.remove();
  }

  destroy() {
    this.close();
    this._disposer.destroy();
    this._root = null;
    this._overlay = null;
    this._dialog = null;
  }
}

export function createModalController(options = {}) {
  return new ModalController(options);
}
