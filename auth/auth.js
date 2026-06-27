/* ====================================================================
   G-STAR · MÓDULO DE AUTENTICACIÓN  (auth.js)
   Autenticación real vía Supabase Auth.
   API pública (window.Auth):
     Auth.login(email, clave)    -> Promise<{ok, session?, code?, message?}>
     Auth.logout([redirect])
     Auth.getSession() / getUser() / isAuthenticated()
     Auth.hasRole(roleId) / hasPermission(perm)
     Auth.requireAuth()
     Auth.redirectIfAuthenticated()
     Auth.getAuditLog()
==================================================================== */
(function (global) {
  'use strict';

  var SELF = (document.currentScript && document.currentScript.src) || (function () {
    var s = document.getElementsByTagName('script');
    for (var i = s.length - 1; i >= 0; i--) { if (s[i].src && /auth\.js(\?|$)/.test(s[i].src)) return s[i].src; }
    return location.href;
  })();
  var ROOT      = new URL('../', SELF);
  var LOGIN_URL = new URL('login.html', ROOT).href;
  var APP_URL   = new URL('index.html', ROOT).href;

  var SESSION_KEY = 'gstar.session';
  var AUDIT_KEY   = 'gstar.audit';

  function audit(event, data) {
    try {
      var log = JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]');
      log.push({ event: event, data: data || {}, at: new Date().toISOString() });
      while (log.length > 200) log.shift();
      localStorage.setItem(AUDIT_KEY, JSON.stringify(log));
    } catch (e) {}
  }

  function saveSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
  function loadSession() {
    try { var raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }

  var Auth = {
    config: { loginUrl: LOGIN_URL, appUrl: APP_URL },

    login: function (email, password) {
      if (!email || !password) {
        return Promise.resolve({ ok: false, code: 'EMPTY_FIELDS', message: 'Correo y contraseña son obligatorios.' });
      }
      if (!window.db) {
        return Promise.resolve({ ok: false, code: 'ERROR', message: 'Error de conexión. Recarga la página.' });
      }

      return window.db.auth.signInWithPassword({ email: email.trim(), password: password })
        .then(function (result) {
          if (result.error || !result.data.user) {
            audit('LOGIN_FAILED', { email: email, reason: result.error ? result.error.message : 'NO_USER' });
            return { ok: false, code: 'INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos.' };
          }

          var sbUser = result.data.user;
          var sbSession = result.data.session;

          return window.db.from('usuarios').select('*').eq('id', sbUser.id).single()
            .then(function (profileResult) {
              var profile = profileResult.data;
              var posicion = (profile && profile.rol) ? profile.rol : 'Usuario';
              var session = {
                token: sbSession.access_token,
                issuedAt: Date.now(),
                expiresAt: null,
                user: {
                  id: sbUser.id,
                  username: sbUser.email,
                  name: (profile && profile.nombre) ? profile.nombre : sbUser.email,
                  email: sbUser.email,
                  roleId: 'administrador',
                  role: { id: 'administrador', label: posicion, permissions: ['*'] }
                }
              };
              saveSession(session);
              audit('LOGIN_SUCCESS', { email: email });
              return { ok: true, session: session };
            });
        })
        .catch(function () {
          return { ok: false, code: 'ERROR', message: 'Ocurrió un error al iniciar sesión. Intenta de nuevo.' };
        });
    },

    logout: function (redirectToLogin) {
      var s = loadSession();
      audit('LOGOUT', { email: s && s.user ? s.user.email : null });
      clearSession();
      if (window.db) window.db.auth.signOut();
      if (redirectToLogin !== false) {
        (window.top || window).location.replace(LOGIN_URL);
      }
    },

    getSession:       function () { return loadSession(); },
    getUser:          function () { var s = loadSession(); return s ? s.user : null; },
    isAuthenticated:  function () { return !!loadSession(); },

    hasRole: function (roleId) { var u = this.getUser(); return !!u && u.roleId === roleId; },
    hasPermission: function (perm) {
      var u = this.getUser(); if (!u || !u.role) return false;
      var p = u.role.permissions || [];
      return p.indexOf('*') !== -1 || p.indexOf(perm) !== -1;
    },

    requireAuth: function () {
      if (!this.isAuthenticated()) {
        var back = encodeURIComponent(location.href);
        (window.top || window).location.replace(LOGIN_URL + '?redirect=' + back);
        return false;
      }
      return true;
    },

    redirectIfAuthenticated: function () {
      if (this.isAuthenticated()) {
        var params = new URLSearchParams(location.search);
        var target = params.get('redirect');
        location.replace(target ? decodeURIComponent(target) : APP_URL);
        return true;
      }
      return false;
    },

    getAuditLog: function () { try { return JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]'); } catch (e) { return []; } }
  };

  global.Auth = Auth;
})(window);
