/**
 * Google Apps Script compatibility shim.
 * Intercepts all google.script.run calls and routes them through /api/exec.
 * No changes needed to app.js — the existing GAS call patterns work as-is.
 */
(function () {
  // Matches the server's own internal budget for these (see
  // runDailyRoutineSetup/_callRoutineGas in app/api/exec/route.js) plus a
  // small margin — the server aborts its own upstream Apps Script call
  // before this fires and returns a graceful "still working" response, so
  // this timeout should in practice never actually trip for these.
  const SLOW_GAS_FN_TIMEOUTS = {
    runDailyRoutineSetup: 55000,
  };

  function makeRunner() {
    let _success = null;
    let _failure = null;

    const proxy = new Proxy({}, {
      get(target, prop) {
        if (prop === 'withSuccessHandler') {
          return function (cb) { _success = cb; return proxy; };
        }
        if (prop === 'withFailureHandler') {
          return function (cb) { _failure = cb; return proxy; };
        }

        // prop is the GAS function name — return the fetch caller
        return function (...args) {
          const sc = _success;
          const fc = _failure;

          // On a slow/dropped connection, fetch() has no default timeout — it
          // would otherwise hang indefinitely with no feedback (the spinner's
          // own auto-hide just makes it silently disappear, no error shown).
          // Abort after 25s so withFailureHandler actually fires with a
          // message the user can act on, instead of the app just looking stuck.
          // A short allowlist of known-slow functions (external Apps Script
          // calls that can legitimately run for minutes, not seconds) get a
          // longer budget instead — see SLOW_GAS_FN_TIMEOUTS below.
          const controller = new AbortController();
          const timeoutMs = SLOW_GAS_FN_TIMEOUTS[prop] || 25000;
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

          fetch('/api/exec', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fn: prop,
              args,
              _uid:   window.APP_USER ? window.APP_USER.user_id : null,
              _email: window.APP_USER ? window.APP_USER.email   : null
            }),
            signal: controller.signal
          })
            .then(r => r.ok ? r.json() : Promise.reject('HTTP ' + r.status))
            .then(data => { clearTimeout(timeoutId); if (sc) sc(data); })
            .catch(err => {
              clearTimeout(timeoutId);
              const isTimeout = err && err.name === 'AbortError';
              const message = isTimeout ? 'Request timed out — check your connection and try again.' : err;
              if (fc) fc(message);
              else console.error('[GAS shim] ' + prop + ' failed:', message);
            });
        };
      }
    });

    return proxy;
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};

  // Each access to google.script.run creates a fresh runner (matches real GAS behaviour)
  Object.defineProperty(window.google.script, 'run', {
    get() { return makeRunner(); },
    configurable: true
  });
})();
