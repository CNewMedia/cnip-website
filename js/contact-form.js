(function () {
  'use strict';

  var forms = Array.prototype.slice.call(document.querySelectorAll('form[action="/api/contact"]'));
  if (!forms.length || !window.fetch || !window.URLSearchParams) return;

  var PHONE = { display: '+32 9 298 57 20', href: 'tel:+3292985720' };
  var EMAIL = 'info@cnip.be';
  var config = null;
  var configPromise = null;
  var scriptPromise = null;

  var style = document.createElement('style');
  style.textContent =
    '.cf-guard-widget:empty{display:none}' +
    '.cf-guard-widget{margin:0 0 12px}' +
    '.cf-guard-status{margin:0 0 12px;padding:12px 14px;border:1px solid currentColor;border-radius:8px;font-size:15px;line-height:1.5}' +
    '.cf-guard-status:empty{display:none}' +
    '.cf-guard-status[data-tone="error"]{border-color:#d92d20;border-left-width:4px}' +
    '.cf-guard-status a{color:inherit;text-decoration:underline}' +
    '.cf-guard-status button{margin-top:8px;padding:8px 14px;font:inherit;font-weight:600;color:inherit;background:transparent;border:1px solid currentColor;border-radius:6px;cursor:pointer}' +
    '.cf-guard-status button:focus-visible{outline:2px solid currentColor;outline-offset:2px}' +
    'form [aria-invalid="true"]{border-color:#d92d20!important;box-shadow:0 0 0 1px #d92d20}' +
    '.cf-guard-field-error{display:block;margin-top:4px;font-size:14px;color:#d92d20}';
  document.head.appendChild(style);

  function loadConfig() {
    if (!configPromise) {
      configPromise = fetch('/api/form-config', { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('config ' + r.status); return r.json(); })
        .then(function (c) { config = c; if (c.phone) PHONE = c.phone; if (c.email) EMAIL = c.email; return c; })
        .catch(function (e) { configPromise = null; throw e; });
    }
    return configPromise;
  }

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!scriptPromise) {
      scriptPromise = new Promise(function (resolve, reject) {
        window.__cnipTurnstileReady = function () { resolve(window.turnstile); };
        var s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__cnipTurnstileReady';
        s.async = true;
        s.onerror = function () { scriptPromise = null; reject(new Error('turnstile script')); };
        document.head.appendChild(s);
      });
    }
    return scriptPromise;
  }

  function setup(form, index) {
    var button = form.querySelector('[type="submit"]');
    var state = { widgetId: null, token: '', busy: false, pending: false, renderedAt: 0, ready: null };

    var widget = document.createElement('div');
    widget.className = 'cf-guard-widget';
    var status = document.createElement('div');
    status.className = 'cf-guard-status';
    status.id = 'cf-guard-status-' + index;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.tabIndex = -1;
    var anchor = button || form.lastChild;
    form.insertBefore(widget, anchor);
    form.insertBefore(status, anchor);

    var elapsed = document.createElement('input');
    elapsed.type = 'hidden';
    elapsed.name = 'fe';
    form.appendChild(elapsed);

    function showStatus(message, tone, withActions) {
      status.textContent = '';
      status.setAttribute('data-tone', tone || 'info');
      status.setAttribute('role', tone === 'error' ? 'alert' : 'status');
      var p = document.createElement('p');
      p.style.margin = '0';
      p.textContent = message;
      status.appendChild(p);
      if (withActions) {
        var row = document.createElement('p');
        row.style.margin = '6px 0 0';
        var phone = document.createElement('a');
        phone.href = PHONE.href;
        phone.textContent = 'Bel ' + PHONE.display;
        var mail = document.createElement('a');
        mail.href = 'mailto:' + EMAIL;
        mail.textContent = 'mail ' + EMAIL;
        row.appendChild(document.createTextNode('Of neem rechtstreeks contact op: '));
        row.appendChild(phone);
        row.appendChild(document.createTextNode(' of '));
        row.appendChild(mail);
        status.appendChild(row);
        var retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Opnieuw proberen';
        retry.addEventListener('click', function () {
          clearStatus();
          resetWidget();
          if (form.requestSubmit) form.requestSubmit(button || undefined);
          else if (button) button.click();
        });
        status.appendChild(retry);
      }
    }

    function clearStatus() { status.textContent = ''; status.removeAttribute('data-tone'); }

    function setBusy(busy) {
      state.busy = busy;
      form.setAttribute('aria-busy', busy ? 'true' : 'false');
      if (button) {
        button.disabled = busy;
        button.setAttribute('aria-disabled', busy ? 'true' : 'false');
      }
    }

    function resetWidget() {
      state.token = '';
      if (window.turnstile && state.widgetId !== null) {
        try { window.turnstile.reset(state.widgetId); } catch (_) {}
      }
    }

    function clearFieldErrors() {
      Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid="true"]'), function (el) {
        el.removeAttribute('aria-invalid');
        var describedBy = (el.getAttribute('aria-describedby') || '').split(' ').filter(function (id) { return id.indexOf('cf-err-') !== 0; }).join(' ');
        if (describedBy) el.setAttribute('aria-describedby', describedBy); else el.removeAttribute('aria-describedby');
      });
      Array.prototype.forEach.call(form.querySelectorAll('.cf-guard-field-error'), function (el) { el.remove(); });
    }

    var FIELD_ALIASES = { name: ['name', 'naam'], email: ['email'], company: ['company', 'bedrijf'], phone: ['phone', 'telefoon'], message: ['message', 'bericht'] };

    function showFieldErrors(fields) {
      var first = null;
      Object.keys(fields).forEach(function (key) {
        var names = FIELD_ALIASES[key] || [key];
        var input = null;
        for (var i = 0; i < names.length && !input; i++) input = form.querySelector('[name="' + names[i] + '"]');
        if (!input) return;
        var err = document.createElement('span');
        err.className = 'cf-guard-field-error';
        err.id = 'cf-err-' + index + '-' + key;
        err.textContent = fields[key];
        input.insertAdjacentElement('afterend', err);
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', ((input.getAttribute('aria-describedby') || '') + ' ' + err.id).trim());
        if (!first) first = input;
      });
      if (first) first.focus();
    }

    function ensureWidget() {
      if (state.ready) return state.ready;
      state.ready = loadConfig().then(function (c) {
        if (!c.siteKey) throw new Error('geen site key');
        return loadTurnstile().then(function (ts) {
          state.widgetId = ts.render(widget, {
            sitekey: c.siteKey,
            action: c.action || 'contact',
            appearance: 'interaction-only',
            language: 'nl',
            'refresh-expired': 'auto',
            callback: function (token) {
              state.token = token;
              if (state.pending) { state.pending = false; submit(); }
            },
            'expired-callback': function () { state.token = ''; },
            'error-callback': function () {
              state.token = '';
              if (state.pending) {
                state.pending = false;
                setBusy(false);
                showStatus('De beveiligingscontrole kon niet worden geladen. Je aanvraag is nog niet verstuurd.', 'error', true);
              }
              return true;
            }
          });
          state.renderedAt = Date.now();
        });
      }).catch(function (e) { state.ready = null; throw e; });
      return state.ready;
    }

    function submit() {
      var data = new URLSearchParams(new FormData(form));
      data.set('fe', String(state.renderedAt ? Date.now() - state.renderedAt : 0));
      fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: data.toString()
      })
        .then(function (r) {
          return r.json().catch(function () { return { status: 'error', message: '' }; });
        })
        .then(function (result) {
          if (result.status === 'ok' && result.redirect) {
            window.location.assign(result.redirect);
            return;
          }
          setBusy(false);
          resetWidget();
          var msg = result.message || 'Er ging iets mis; je aanvraag is niet verstuurd.';
          if (result.status === 'invalid' && result.fields) {
            showStatus(msg, 'error', false);
            showFieldErrors(result.fields);
            return;
          }
          if (result.status === 'preview_ok' || result.status === 'review' || result.status === 'duplicate') {
            showStatus(msg, 'info', false);
            if (result.status !== 'duplicate') form.reset();
          } else if (result.status === 'processing') {
            // Keep the data: if the first request ultimately fails, the visitor can still resend it.
            showStatus(msg, 'info', false);
          } else {
            showStatus(msg, 'error', true);
          }
          status.focus();
        })
        .catch(function () {
          setBusy(false);
          resetWidget();
          showStatus('Je aanvraag kon niet worden verstuurd door een verbindingsprobleem. Ze is nog niet bij ons aangekomen.', 'error', true);
          status.focus();
        });
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (state.busy) return;
      clearFieldErrors();
      clearStatus();
      setBusy(true);
      showStatus('Bezig met verzenden…', 'info', false);

      ensureWidget().then(function () {
        var token = state.token || (window.turnstile && state.widgetId !== null ? window.turnstile.getResponse(state.widgetId) : '');
        if (token) { state.token = token; submit(); return; }
        state.pending = true;
        showStatus('Even geduld: we controleren of je geen robot bent. Volg eventueel de controle hierboven.', 'info', false);
        setTimeout(function () {
          if (!state.pending) return;
          state.pending = false;
          setBusy(false);
          showStatus('De beveiligingscontrole duurt langer dan verwacht. Je aanvraag is nog niet verstuurd.', 'error', true);
        }, 20000);
      }).catch(function () {
        setBusy(false);
        showStatus('De beveiligingscontrole kon niet worden geladen. Je aanvraag is nog niet verstuurd.', 'error', true);
      });
    });

    var warm = function () { ensureWidget().catch(function () {}); };
    form.addEventListener('focusin', warm, { once: true });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); warm(); }
      }, { rootMargin: '400px 0px' });
      io.observe(form);
    } else {
      warm();
    }
  }

  forms.forEach(setup);
})();
