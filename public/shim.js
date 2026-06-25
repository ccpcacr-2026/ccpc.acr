/**
 * Google Apps Script compatibility shim.
 * Intercepts all google.script.run calls and routes them through /api/exec.
 * No changes needed to app.js — the existing GAS call patterns work as-is.
 */
(function () {
  function makeRunner() {
    let _success = null;
    let _failure = null;

    const runner = {
      withSuccessHandler(cb) { _success = cb; return runner; },
      withFailureHandler(cb) { _failure = cb; return runner; }
    };

    return new Proxy(runner, {
      get(target, prop) {
        if (prop in target) return target[prop];

        // prop is the GAS function name
        return function (...args) {
          const sc = _success;
          const fc = _failure;

          fetch('/api/exec', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fn: prop,
              args,
              _uid:   window.APP_USER ? window.APP_USER.user_id : null,
              _email: window.APP_USER ? window.APP_USER.email   : null
            })
          })
            .then(r => r.ok ? r.json() : Promise.reject('HTTP ' + r.status))
            .then(data => { if (sc) sc(data); })
            .catch(err => {
              if (fc) fc(err);
              else console.error('[GAS shim] ' + prop + ' failed:', err);
            });
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};

  // Each access to google.script.run creates a fresh runner (matches real GAS behaviour)
  Object.defineProperty(window.google.script, 'run', {
    get() { return makeRunner(); },
    configurable: true
  });
})();
