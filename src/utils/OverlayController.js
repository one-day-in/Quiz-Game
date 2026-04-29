import { Disposer } from './disposer.js';
import { bindOverlayDismiss } from './overlayDismiss.js';

export class OverlayController {
  constructor({
    overlay = null,
    panel = null,
    isOpen = () => false,
    onRequestClose = null,
    closeOnEscape = true,
  } = {}) {
    this._overlay = overlay;
    this._panel = panel;
    this._isOpen = typeof isOpen === 'function' ? isOpen : (() => false);
    this._onRequestClose = onRequestClose;
    this._disposer = new Disposer();

    bindOverlayDismiss({
      disposer: this._disposer,
      overlay: this._overlay,
      closeOnEscape,
      shouldDismissOnEscape: () => this._isOpen(),
      shouldDismissOnOverlay: (event) => {
        const target = event?.target;
        return !!target && (!this._panel || !target.closest?.(this._panelSelector()));
      },
      onDismiss: () => this._onRequestClose?.(),
    });
  }

  _panelSelector() {
    if (!this._panel) return '';
    if (this._panel.id) return `#${this._panel.id}`;
    const className = this._panel.className?.toString?.().trim?.() || '';
    if (!className) return '';
    return `.${className.split(/\s+/).join('.')}`;
  }

  destroy() {
    this._disposer.destroy();
  }
}

export function createOverlayController(options = {}) {
  return new OverlayController(options);
}

