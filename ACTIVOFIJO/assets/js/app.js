/* ============================================================
   UI — modales, toasts, PIN y confirmaciones (mismo patrón que el resto del sistema)
   Permisos — consulta para todos; importar/editar solo Administrador + PIN
   App — arranque
   ============================================================ */
const UI = (() => {
  let confirmCallback = null;
  let _pinCallback = null;

  function openModal(id){ document.getElementById(id).classList.add('open'); }
  function closeModal(id){ document.getElementById(id).classList.remove('open'); }

  function toast(msg, type){
    const host = document.getElementById('toast-host');
    const el = document.createElement('div');
    el.className = 'toast' + (type==='ok' ? ' ok' : type==='err' ? ' err' : '');
    el.innerHTML = (type==='ok' ? '<b>✓</b>' : type==='err' ? '<b>✕</b>' : '') + `<span>${Utils.escapeHtml(msg)}</span>`;
    host.appendChild(el);
    setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .25s'; setTimeout(()=>el.remove(),250); }, type==='err' ? 5200 : 2600);
  }

  function confirm(title, msg, onOk){
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;
    confirmCallback = onOk;
    openModal('modalConfirm');
  }
  function runConfirm(){
    const cb = confirmCallback;
    confirmCallback = null;
    closeModal('modalConfirm');
    if(cb) cb();
  }

  function requirePin(callback){
    _pinCallback = callback;
    const input = document.getElementById('adminPinInput');
    if(input) input.value = '';
    openModal('modalAdminPin');
    setTimeout(()=>input&&input.focus(), 100);
  }
  function closeAdminPin(){ _pinCallback = null; closeModal('modalAdminPin'); }
  function confirmAdminPin(){
    const pin = (document.getElementById('adminPinInput')?.value || '').trim();
    const adminPin = String(Storage.getSettings().adminPin || '1234');
    if(pin !== adminPin){ toast('PIN incorrecto', 'err'); return; }
    const cb = _pinCallback;
    closeAdminPin();
    if(cb) cb();
  }

  return { openModal, closeModal, toast, confirm, runConfirm, requirePin, closeAdminPin, confirmAdminPin };
})();
window.UI = UI;

const Permisos = (() => {
  const usuario = () => (window.Auth && Auth.getUser && Auth.getUser()) || {};
  // Solo el rol Administrador puede importar, crear, editar, registrar retiros/ajustes o inactivar
  function esAdmin(){
    const u = usuario();
    const lab = String((u.role && u.role.label) || '').toLowerCase();
    return lab.indexOf('administrador') !== -1;
  }
  function nombre(){ const u = usuario(); return u.name || u.email || '—'; }
  return { esAdmin, nombre, usuario };
})();
window.Permisos = Permisos;

const App = (() => {

  // Ejecuta una acción protegida: exige rol Administrador y luego el PIN
  function protegida(fn){
    if(!Permisos.esAdmin()){ UI.toast('Esta acción requiere el rol Administrador', 'err'); return; }
    UI.requirePin(fn);
  }

  // Guarda una o varias claves y CONFIRMA que llegaron a Supabase; si no, revierte lo local
  async function guardarSeguro(previos, claves){
    const r = [];
    for(const k of claves){
      const res = window.Sync ? await Sync.pushNow(k) : { ok:false, reason:'no-sync' };
      if(!res.ok){
        // revertir lo local (y lo ya enviado) para que no queden datos a medias
        Object.keys(previos).forEach(key => { try{ localStorage.setItem(key, JSON.stringify(previos[key])); }catch(e){} });
        for(const kk of claves){ if(window.Sync) await Sync.pushNow(kk); }
        return { ok:false, reason:res.reason };
      }
      r.push(k);
    }
    return { ok:true };
  }

  function refrescar(){ Inventario.render(); if(window.Ficha) Ficha.refrescar(); }

  async function init(){
    Storage.init();
    Inventario.init();
    document.getElementById('btnConfirmOk')?.addEventListener('click', UI.runConfirm);
    document.querySelectorAll('.modal-overlay').forEach(ov => ov.addEventListener('click', e => { if(e.target === ov && ov.id !== 'modalAdminPin') ov.classList.remove('open'); }));
    document.querySelectorAll('[data-solo-admin]').forEach(el => { el.style.display = Permisos.esAdmin() ? '' : 'none'; });
    Inventario.render();

    if(window.Sync){
      try{ await Sync.pull(); }catch(e){ console.warn('Sync.pull falló, se usa data local', e); }
      Inventario.render();
      Sync.subscribeRealtime(() => refrescar());
    }
  }

  return { init, protegida, guardarSeguro, refrescar };
})();
window.App = App;

document.addEventListener('DOMContentLoaded', App.init);
