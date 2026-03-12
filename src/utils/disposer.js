// public/src/utils/disposer.js
/**
 * Utility for managing cleanup functions
 */
export class Disposer {
  constructor() {
    this._cleanups = [];
    this._destroyed = false;
  }

  /**
   * Register a cleanup function
   */
  add(fn) {
    if (this._destroyed) {
      fn();
      return () => {};
    }

    this._cleanups.push(fn);

    return () => {
      const idx = this._cleanups.indexOf(fn);
      if (idx !== -1) {
        this._cleanups.splice(idx, 1);
        fn();
      }
    };
  }

  /**
   * Add an event listener with auto-removal on destroy
   */
  addEventListener(el, type, listener, options) {
    if (!el) return () => {};
    if (this._destroyed) return () => {};

    el.addEventListener(type, listener, options);

    return this.add(() => {
      try {
        el.removeEventListener(type, listener, options);
      } catch (e) {
        console.error('[Disposer] removeEventListener failed:', e);
      }
    });
  }

  /**
   * Add a setTimeout with auto-cancel on destroy
   */
  setTimeout(fn, delay) {
    if (this._destroyed) {
      fn();
      return () => {};
    }

    const id = setTimeout(() => {
      fn();
      this._cleanups = this._cleanups.filter(cb => cb !== cleanup);
    }, delay);

    const cleanup = () => clearTimeout(id);
    this.add(cleanup);
    return cleanup;
  }

  /**
   * Add a setInterval with auto-cancel on destroy
   */
  setInterval(fn, interval) {
    if (this._destroyed) return () => {};

    const id = setInterval(fn, interval);
    return this.add(() => clearInterval(id));
  }

  /**
   * Add a subscription with auto-unsubscribe on destroy
   */
  addSubscription(subscribable, handler) {
    if (!subscribable || this._destroyed) return () => {};

    const unsubscribe = typeof subscribable === 'function'
      ? subscribable(handler)
      : subscribable.subscribe?.(handler) ||
        subscribable.on?.(handler) ||
        (() => {});

    return this.add(() => {
      if (typeof unsubscribe === 'function') unsubscribe();
    });
  }

  /**
   * Add a MutationObserver with auto-disconnect on destroy
   */
  observeMutation(target, config, callback) {
    if (!target || this._destroyed) return () => {};

    const observer = new MutationObserver((mutations) => {
      if (!this._destroyed) callback(mutations);
    });

    observer.observe(target, config);
    return this.add(() => observer.disconnect());
  }

  /**
   * Watch for element removal from the DOM
   */
  observeRemoval(el, callback) {
    if (!el) return () => {};

    return this.observeMutation(document.body, {
      childList: true,
      subtree: true
    }, (mutations) => {
      if (!el.isConnected) {
        callback?.();
      }
    });
  }

  /**
   * Create a child Disposer that is destroyed together with the parent
   */
  createChild() {
    const child = new Disposer();
    this.add(() => child.destroy());
    return child;
  }

  /**
   * Run all cleanups and mark as destroyed
   */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    [...this._cleanups].reverse().forEach(cleanup => {
      try { cleanup(); } catch (e) {
        console.error('[Disposer] cleanup failed:', e);
      }
    });

    this._cleanups = [];
  }

  get size() {
    return this._cleanups.length;
  }

  get destroyed() {
    return this._destroyed;
  }
}

/**
 * Specialized Disposer for View components
 */
export class ViewDisposer extends Disposer {
  constructor(rootEl = null) {
    super();
    this.rootEl = rootEl;
  }

  /**
   * Auto-destroy when rootEl is removed from the DOM
   */
  autoDestroy() {
    if (!this.rootEl) return () => {};
    return this.observeRemoval(this.rootEl, () => this.destroy());
  }

  /**
   * Append a child element and remove it on destroy
   */
  addChild(el) {
    if (!el || !this.rootEl) return () => {};
    this.rootEl.appendChild(el);
    return this.add(() => el.remove());
  }

  /**
   * Replace rootEl content (clears previous children first)
   */
  render(content) {
    if (!this.rootEl) return;

    while (this.rootEl.firstChild) {
      const child = this.rootEl.firstChild;
      this.rootEl.removeChild(child);
    }

    if (content) {
      if (Array.isArray(content)) {
        content.forEach(el => this.rootEl.appendChild(el));
      } else {
        this.rootEl.appendChild(content);
      }
    }
  }
}
