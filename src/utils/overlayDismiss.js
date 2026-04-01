export function bindOverlayDismiss({
  disposer = null,
  overlay = null,
  closeButton = null,
  onDismiss = null,
  documentTarget = document,
  closeOnEscape = true,
  closeOnOverlay = true,
  closeOnButton = true,
  shouldDismissOnEscape = () => true,
  shouldDismissOnOverlay = (event, overlayEl) => event.target === overlayEl,
} = {}) {
  const cleanups = [];

  const addListener = (target, type, listener, options) => {
    if (!target) return;

    if (disposer) {
      const cleanup = disposer.addEventListener(target, type, listener, options);
      cleanups.push(cleanup);
      return;
    }

    target.addEventListener(type, listener, options);
    cleanups.push(() => target.removeEventListener(type, listener, options));
  };

  const dismiss = (reason, event) => {
    onDismiss?.(reason, event);
  };

  if (closeOnOverlay && overlay) {
    addListener(overlay, 'click', (event) => {
      if (!shouldDismissOnOverlay(event, overlay)) return;
      dismiss('overlay', event);
    });
  }

  if (closeOnButton && closeButton) {
    addListener(closeButton, 'click', (event) => {
      dismiss('button', event);
    });
  }

  if (closeOnEscape && documentTarget) {
    addListener(documentTarget, 'keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!shouldDismissOnEscape(event)) return;
      event.preventDefault();
      dismiss('escape', event);
    });
  }

  return () => {
    while (cleanups.length) {
      try {
        cleanups.pop()?.();
      } catch (error) {
        console.error('[overlayDismiss] cleanup failed:', error);
      }
    }
  };
}
