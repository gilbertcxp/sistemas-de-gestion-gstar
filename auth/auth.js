/* ====================================================================
   G-STAR · MÓDULO DE AUTENTICACIÓN  (auth.js)
   --------------------------------------------------------------------
   Capa de autenticación aislada de la interfaz y de la lógica de negocio.
   Diseñada para escalar hacia un sistema real (BD, múltiples usuarios,
   roles, permisos, recuperación/cambio de contraseña, auditoría) SIN
   reescribir el resto de la aplicación.

   PUNTOS DE EVOLUCIÓN (swap points) claramente marcados:
     1) UserProvider  -> reemplazar LocalUserProvider por ApiUserProvider
                         (fetch a tu backend) sin tocar el núcleo `Auth`.
     2) Hashing       -> hoy SHA-256 en cliente; en el backend real usar
                         bcrypt/argon2. Solo cambia verifyPassword().
     3) ROLES/PERMS   -> añadir nuevos roles y permisos en los catálogos;
                         la lógica de control de acceso no cambia.
     4) Sessions      -> hoy en localStorage; mañana token JWT del backend.

   API pública (window.Auth):
     Auth.login(usuario, clave) -> Promise<{ok, session?, code?, message?}>
     Auth.logout([redirect])
     Auth.getSession() / getUser() / isAuthenticated()
     Auth.hasRole(roleId) / hasPermission(perm)
     Auth.requireAuth()             -> guard de páginas protegidas
     Auth.redirectIfAuthenticated() -> guard de la pantalla de login
     Auth.useProvider(provider)     -> inyectar otro proveedor de usuarios
     Auth.getAuditLog()             -> historial de accesos (auditoría)
==================================================================== */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------
     RUTAS — derivadas de la ubicación de este script, de modo que el
     módulo funcione igual incluido desde la raíz o desde subcarpetas
     (CONCILIAR/, EROGACIONES/, DISPONIBILIDAD/...), en http:// o file://
  ---------------------------------------------------------------- */
  var SELF = (document.currentScript && document.currentScript.src) || (function () {
    var s = document.getElementsByTagName('script');
    for (var i = s.length - 1; i >= 0; i--) { if (s[i].src && /auth\.js(\?|$)/.test(s[i].src)) return s[i].src; }
    return location.href;
  })();
  var ROOT      = new URL('../', SELF);               // carpeta raíz del sitio (contiene /auth)
  var LOGIN_URL = new URL('login.html', ROOT).href;
  var APP_URL   = new URL('index.html', ROOT).href;

  /* ---------------------------------------------------------------
     CONSTANTES DE ALMACENAMIENTO
  ---------------------------------------------------------------- */
  var SESSION_KEY = 'gstar.session';
  var AUDIT_KEY   = 'gstar.audit';
  var SESSION_TTL = null; // null = la sesión vive hasta que el usuario cierre sesión

  /* ===============================================================
     CATÁLOGO DE PERMISOS  (escalable)
     Añade aquí permisos granulares cuando crezca el sistema.
  =============================================================== */
  var PERMISSIONS = {
    ALL: '*'               // acceso total
    // Ejemplos futuros:
    // BANCO_VER:'banco:ver', BANCO_EDITAR:'banco:editar',
    // CXC_VER:'cxc:ver', RRHH_VER:'rrhh:ver', CONFIG:'config:admin' ...
  };

  /* ===============================================================
     CATÁLOGO DE ROLES  (escalable)
     Por ahora solo "administrador" (acceso total con permiso '*').
     En el futuro: contabilidad, tesoreria, rrhh, gerencia, consulta...
  =============================================================== */
  var ROLES = {
    administrador: {
      id: 'administrador',
      label: 'Administrador General',
      permissions: ['*']
    }
    // ,tesoreria:   { id:'tesoreria',   label:'Tesorería',    permissions:['banco:ver','banco:editar'] }
    // ,contabilidad:{ id:'contabilidad',label:'Contabilidad', permissions:['cxc:ver','cxp:ver'] }
    // ,consulta:    { id:'consulta',    label:'Consulta',     permissions:['banco:ver'] }
  };

  /* ===============================================================
     HASHING  (swap point #2)
     SHA-256 sin dependencias (funciona en file:// y http://).
     En un backend real, sustituir por bcrypt/argon2 con salt por usuario.
  =============================================================== */
  function utf8(str) { return unescape(encodeURIComponent(String(str))); }

  function sha256(asciiInput) {
    var ascii = utf8(asciiInput);
    function rr(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
    var mathPow = Math.pow, maxWord = mathPow(2, 32), result = '', words = [];
    var asciiBitLength = ascii.length * 8;
    var hash = sha256.h = sha256.h || [];
    var k = sha256.k = sha256.k || [];
    var primeCounter = k.length, isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (var i = 0; i < 313; i += candidate) { isComposite[i] = candidate; }
        hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
        k[primeCounter++]  = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (var i = 0; i < ascii.length; i++) {
      var j = ascii.charCodeAt(i);
      if (j >> 8) return '';
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (var j2 = 0; j2 < words.length;) {
      var w = words.slice(j2, j2 += 16);
      var oldHash = hash;
      hash = hash.slice(0, 8);
      for (var i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7]
          + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25))
          + ((e & hash[5]) ^ (~e & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
              w[i - 16]
              + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3))
              + w[i - 7]
              + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))
            ) | 0);
        var temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (var i = 0; i < 8; i++) { hash[i] = (hash[i] + oldHash[i]) | 0; }
    }
    for (var i = 0; i < 8; i++) {
      for (var j3 = 3; j3 + 1; j3--) {
        var b = (hash[i] >> (j3 * 8)) & 255;
        result += ((b < 16) ? 0 : '') + b.toString(16);
      }
    }
    return result;
  }

  function verifyPassword(plain, storedHash) { return sha256(plain) === storedHash; }

  /* ===============================================================
     PROVEEDOR DE USUARIOS  (swap point #1)
     LocalUserProvider: fuente de datos local (semilla del Admin).
     Mañana: ApiUserProvider con el mismo contrato { findByUsername }.
     La contraseña NUNCA se guarda en texto plano: solo su hash SHA-256.
       sha256('1234') = 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
  =============================================================== */
  var LocalUserProvider = {
    users: [
      {
        id: 'usr-0001',
        username: 'administrador',
        name: 'Administrador General',
        email: '',
        roleId: 'administrador',
        passwordHash: '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4',
        active: true,
        createdAt: '2026-01-01T00:00:00Z'
      }
    ],
    findByUsername: function (username) {
      var u = this.users.find(function (x) {
        return x.username.toLowerCase() === String(username).trim().toLowerCase();
      });
      return Promise.resolve(u || null);
    }
  };

  var provider = LocalUserProvider;

  /* ===============================================================
     AUDITORÍA DE ACCESOS
     Registro local de eventos (login/logout/fallos). En producción se
     enviaría al backend; el contrato (audit()) ya queda listo.
  =============================================================== */
  function audit(event, data) {
    try {
      var log = JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]');
      log.push({ event: event, data: data || {}, at: new Date().toISOString(), agent: navigator.userAgent });
      while (log.length > 200) log.shift();
      localStorage.setItem(AUDIT_KEY, JSON.stringify(log));
    } catch (e) { /* almacenamiento no disponible */ }
  }

  /* ===============================================================
     GESTIÓN DE SESIÓN  (swap point #4)
     Hoy: objeto de sesión en localStorage. Mañana: token JWT del backend.
  =============================================================== */
  function genToken() { return 'sess_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36); }

  function createSession(user) {
    var role = ROLES[user.roleId] || null;
    return {
      token: genToken(),
      issuedAt: Date.now(),
      expiresAt: SESSION_TTL ? Date.now() + SESSION_TTL : null,
      user: {
        id: user.id, username: user.username, name: user.name, email: user.email, roleId: user.roleId,
        role: role ? { id: role.id, label: role.label, permissions: role.permissions.slice() } : null
      }
    };
  }
  function saveSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY); if (!raw) return null;
      var s = JSON.parse(raw);
      if (s && s.expiresAt && Date.now() > s.expiresAt) { clearSession(); return null; }
      return s || null;
    } catch (e) { return null; }
  }

  /* ===============================================================
     NÚCLEO PÚBLICO  ·  Auth
  =============================================================== */
  var Auth = {
    PERMISSIONS: PERMISSIONS,
    ROLES: ROLES,
    config: { loginUrl: LOGIN_URL, appUrl: APP_URL, sessionKey: SESSION_KEY },

    /* Inyectar otro proveedor (p. ej. ApiUserProvider) */
    useProvider: function (p) { if (p && typeof p.findByUsername === 'function') provider = p; },

    /* Iniciar sesión. Devuelve una promesa con resultado uniforme. */
    login: function (username, password) {
      if (!username || !password) {
        return Promise.resolve({ ok: false, code: 'EMPTY_FIELDS', message: 'Usuario y contraseña son obligatorios.' });
      }
      return Promise.resolve(provider.findByUsername(username)).then(function (user) {
        if (!user || user.active === false) {
          audit('LOGIN_FAILED', { username: username, reason: 'NOT_FOUND' });
          return { ok: false, code: 'INVALID_CREDENTIALS', message: 'Usuario o contraseña incorrectos.' };
        }
        if (!verifyPassword(password, user.passwordHash)) {
          audit('LOGIN_FAILED', { username: username, reason: 'BAD_PASSWORD' });
          return { ok: false, code: 'INVALID_CREDENTIALS', message: 'Usuario o contraseña incorrectos.' };
        }
        var session = createSession(user);
        saveSession(session);
        audit('LOGIN_SUCCESS', { username: user.username, role: user.roleId });
        return { ok: true, session: session };
      }).catch(function (err) {
        return { ok: false, code: 'ERROR', message: 'Ocurrió un error al iniciar sesión. Intenta de nuevo.' };
      });
    },

    /* Cerrar sesión: borra autenticación y redirige al login. */
    logout: function (redirectToLogin) {
      var s = loadSession();
      audit('LOGOUT', { username: s && s.user ? s.user.username : null });
      clearSession();
      if (redirectToLogin !== false) {
        (window.top || window).location.replace(LOGIN_URL);
      }
    },

    getSession: function () { return loadSession(); },
    getUser: function () { var s = loadSession(); return s ? s.user : null; },
    isAuthenticated: function () { return !!loadSession(); },

    hasRole: function (roleId) { var u = this.getUser(); return !!u && u.roleId === roleId; },
    hasPermission: function (perm) {
      var u = this.getUser(); if (!u || !u.role) return false;
      var p = u.role.permissions || [];
      return p.indexOf('*') !== -1 || p.indexOf(perm) !== -1;
    },

    /* GUARD de página protegida: sin sesión -> login (recordando destino). */
    requireAuth: function () {
      if (!this.isAuthenticated()) {
        var back = encodeURIComponent(location.href);
        (window.top || window).location.replace(LOGIN_URL + '?redirect=' + back);
        return false;
      }
      return true;
    },

    /* GUARD del login: con sesión activa NO se puede ver el login. */
    redirectIfAuthenticated: function () {
      if (this.isAuthenticated()) {
        var params = new URLSearchParams(location.search);
        var target = params.get('redirect');
        location.replace(target ? decodeURIComponent(target) : APP_URL);
        return true;
      }
      return false;
    },

    /* Auditoría (lectura) */
    getAuditLog: function () { try { return JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]'); } catch (e) { return []; } },

    /* Utilidad expuesta para reusar el hashing (p. ej. futura pantalla de cambio de contraseña) */
    hash: sha256
  };

  global.Auth = Auth;
})(window);
