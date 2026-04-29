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
        if (!target) return false;
        if (!this._panel) return true;
        return !this._panel.contains(target);
      },
      onDismiss: () => this._onRequestClose?.(),
    });
  }

  destroy() {
    this._disposer.destroy();
  }
}

export function createOverlayController(options = {}) {
  return new OverlayController(options);
}
