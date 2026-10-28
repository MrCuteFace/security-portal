/*
  Demo layer for the static build of the security portal.

  Every page here was rendered by the real ASP.NET Core app against invented data and saved as
  plain HTML. This script fills the gaps a server would normally cover:
    - signing in (picks which saved set of pages to open),
    - GET forms (date pickers, search, filters) -> the matching saved page, when there is one,
    - POST forms -> a note that the demo does not save,
    - the two live lookups the event form makes (employee search, party history).
*/
(function () {
  'use strict';

  var data = window.DEMO_DATA || { routes: {}, employees: [], partyHistory: [] };
  var script = document.currentScript;
  var base = script ? script.src.replace(/demo\/demo\.js(\?.*)?$/, '') : '';

  // ---- routes: same lookup, whatever order the form lists its fields in --------------

  function normalizeKey(key) {
    var q = key.indexOf('?');
    if (q < 0) return key.toLowerCase();
    var params = key.slice(q + 1).split('&').filter(Boolean).sort();
    return key.slice(0, q).toLowerCase() + (params.length ? '?' + params.join('&') : '');
  }

  var routes = {};
  Object.keys(data.routes).forEach(function (k) { routes[normalizeKey(k)] = data.routes[k]; });

  var inAdmin = /\/admin\/[^/]*$/.test(location.pathname);
  function findRoute(path, params) {
    var query = [];
    params.forEach(function (value, name) {
      if (value !== '' && name !== 'download') query.push(name + '=' + value);
    });
    var key = normalizeKey(path + (query.length ? '?' + query.join('&') : ''));
    return (inAdmin && routes[normalizeKey('admin/' + key)]) || routes[key] || null;
  }

  // ---- feedback ----------------------------------------------------------------------

  var toastTimer;
  function toast(text) {
    var el = document.getElementById('demo-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 3200);
  }

  function addBadge() {
    var badge = document.createElement('div');
    badge.className = 'demo-badge';
    badge.innerHTML = '<strong>מצב הדגמה</strong> · נתונים בדויים · שום דבר לא נשמר';
    document.body.appendChild(badge);
  }

  // ---- sign-in -----------------------------------------------------------------------

  function setUpLogin() {
    var form = document.querySelector('form [name="Password"]');
    if (!form) return false;
    form = form.form;
    var user = form.querySelector('[name="Username"]');
    var pass = form.querySelector('[name="Password"]');
    if (user) user.value = 'kabat';
    if (pass) pass.value = 'demo-password';

    var picker = document.createElement('div');
    picker.className = 'demo-login';
    picker.innerHTML =
      '<p class="demo-login__title">משתמשי הדגמה</p>' +
      '<button type="button" class="btn btn-primary w-100 mb-2" data-user="kabat">כניסה כקב"ט - נועה ברגר</button>' +
      '<button type="button" class="btn btn-outline-secondary w-100" data-user="maint">כניסה כמנהל מערכת</button>';
    form.parentNode.insertBefore(picker, form.nextSibling);
    picker.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-user]');
      if (btn) go(btn.getAttribute('data-user'));
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      go((user && user.value || '').trim().toLowerCase());
    });
    // Signing in shows the loader for a moment, as the real portal pauses while it checks the user.
    function go(username) {
      var landing = data.landing || {};
      var target = base + (username === 'maint' ? landing.maint : landing.kabat);
      var overlay = document.createElement('div');
      overlay.className = 'demo-signin';
      document.body.appendChild(overlay);
      startLoader(overlay, 112, 'מתחבר...');
      setTimeout(function () { location.href = target; }, 1500);
    }
    return true;
  }

  // ---- forms -------------------------------------------------------------------------

  // Submit buttons as the page first drew them: some forms switch them to "saving..." and
  // disable them on submit, which would leave them stuck once the demo declines to post.
  var buttonStates = new Map();
  function rememberButtons() {
    document.querySelectorAll('form[data-demo-action] [type="submit"]').forEach(function (b) {
      buttonStates.set(b, { html: b.innerHTML, disabled: b.disabled });
    });
  }
  function restoreButtons(form) {
    form.querySelectorAll('[type="submit"]').forEach(function (b) {
      var state = buttonStates.get(b);
      if (!state) return;
      b.innerHTML = state.html;
      b.disabled = state.disabled;
    });
  }

  // Bubble phase on purpose: the page's own handlers (confirm before saving, validation) run
  // first, exactly as in the real portal. If one of them cancelled, there is nothing to do.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    var action = (form.getAttribute('data-demo-action') || '').replace(/^app:/, '');
    if (!action || e.defaultPrevented) return;
    e.preventDefault();
    setTimeout(function () { restoreButtons(form); }, 0);

    if (/\/Account\/Logout/i.test(action)) {
      location.href = base + 'index.html';
      return;
    }

    var method = (form.getAttribute('method') || 'get').toLowerCase();
    if (method === 'get') {
      var params = new URLSearchParams(new FormData(form));
      var path = action.split('?')[0];
      var hit = findRoute(path, params);

      // Search by reference number: open the event itself when the demo has it.
      if (!hit && /\/Events\/Search/i.test(path) && /^\d+$/.test((params.get('referenceQuery') || '').trim())) {
        hit = findRoute('/Events/Details/' + params.get('referenceQuery').trim(), new URLSearchParams());
      }
      if (hit) {
        location.href = base + hit;
      } else {
        toast('הצירוף הזה לא נכלל בהדגמה. נסו תאריך מהשבועיים האחרונים או אחד מהטווחים המוכנים.');
      }
      return;
    }

    toast('זוהי גרסת הדגמה - הטופס תקין, אבל שום דבר לא נשמר.');
  });

  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href^="#demo-unavailable"]');
    if (!link) return;
    e.preventDefault();
    toast('המסך הזה לא נכלל בגרסת ההדגמה.');
  });

  // ---- the event form's two live lookups -----------------------------------------------

  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  function json(body) {
    return Promise.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }));
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input && input.url;
    if (url && url.indexOf('demo:employee-search') === 0) {
      var q = '';
      if (init && init.body && init.body.get) q = String(init.body.get('q') || '').trim();
      var found = data.employees.filter(function (emp) {
        // Same rule as the server: a full ID number exactly, or at least two letters of the name.
        if (/^\d+$/.test(q)) return emp.idNumber === q;
        return q.length >= 2 && emp.fullName.indexOf(q) >= 0;
      }).slice(0, 12).map(function (emp) {
        return { employeeId: emp.employeeId, maskedId: emp.maskedId, fullName: emp.fullName, department: emp.department, jobTitle: emp.jobTitle };
      });
      return json(found);
    }
    if (url && url.indexOf('demo:party-history') === 0) {
      var params = new URLSearchParams(url.split('?')[1] || '');
      var id = params.get('employeeId');
      var name = (params.get('name') || '').trim();
      var rows = data.partyHistory.filter(function (r) {
        return id ? String(r.employeeId) === id : name && r.name === name;
      });
      return json({ total: rows.length, rows: rows.slice(0, 5) });
    }
    return realFetch ? realFetch(input, init) : Promise.reject(new Error('fetch unavailable'));
  };

  // ---- the puzzle-sphere loader (see sphere.js, built from the shared brand kit) -------

  /** Draws the loader into `host` until the returned function is called. */
  function startLoader(host, size, label) {
    var sphere = window.PuzzleSphere;
    var wrap = document.createElement('div');
    wrap.className = 'demo-loader';
    wrap.setAttribute('role', 'status');
    var canvas = document.createElement('canvas');
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    wrap.appendChild(canvas);
    if (label) {
      var text = document.createElement('p');
      text.textContent = label;
      wrap.appendChild(text);
    }
    host.appendChild(wrap);

    var ctx = canvas.getContext('2d');
    var frame = 0;
    if (sphere && ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        sphere.drawSphere(ctx, { yaw: 18, twists: [0, 0, 0], tilt: 22 }, size);
      } else {
        var start = performance.now();
        var prev = 0;
        var tick = function (now) {
          var elapsed = now - start;
          sphere.drawLoaderFrame(ctx, elapsed, prev, size);
          prev = elapsed;
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      }
    }
    return function stop() {
      cancelAnimationFrame(frame);
      wrap.remove();
    };
  }

  /** Report PDFs open in a frame; cover it with the loader until the PDF has arrived. */
  function watchPdfFrames() {
    var MIN_MS = 1200;
    var cover = function (frameEl) {
      var src = frameEl.getAttribute('src') || '';
      if (!/\.pdf$/i.test(src) || frameEl.dataset.demoLoading) return;
      frameEl.dataset.demoLoading = '1';
      var host = frameEl.parentNode;
      host.classList.add('demo-loader-host');
      var stop = startLoader(host, 112, 'טוען את הדו"ח');
      var shownAt = performance.now();
      frameEl.addEventListener('load', function done() {
        frameEl.removeEventListener('load', done);
        setTimeout(function () {
          stop();
          delete frameEl.dataset.demoLoading;
        }, Math.max(0, MIN_MS - (performance.now() - shownAt)));
      });
    };
    new MutationObserver(function (records) {
      records.forEach(function (r) { if (r.target.tagName === 'IFRAME') cover(r.target); });
    }).observe(document.body, { attributes: true, attributeFilter: ['src'], subtree: true });
    document.querySelectorAll('iframe[src]').forEach(cover);
  }

  // ---- start -------------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    setUpLogin();
    rememberButtons();
    addBadge();
    watchPdfFrames();
  });
})();
