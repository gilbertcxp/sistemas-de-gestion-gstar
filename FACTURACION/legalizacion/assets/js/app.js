/* ============================================================
   UI — helpers de interfaz: modales, toasts, PIN administrador
   (mismo patrón exacto que CAJACHICA/COMPENSACION/CXC/CXP)
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
    setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .25s'; setTimeout(()=>el.remove(),250); }, 2600);
  }

  function confirm(title, msg, onOk){
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;
    confirmCallback = onOk;
    openModal('modalConfirm');
  }
  function runConfirm(){
    if(confirmCallback) confirmCallback();
    confirmCallback = null;
    closeModal('modalConfirm');
  }

  function requirePin(callback){
    _pinCallback = callback;
    const input = document.getElementById('adminPinInput');
    if(input) input.value = '';
    openModal('modalAdminPin');
    setTimeout(()=>input&&input.focus(), 100);
  }
  function closeAdminPin(){
    _pinCallback = null;
    closeModal('modalAdminPin');
  }
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

/* ============================================================
   App — bootstrap, navegación entre vistas
   ============================================================ */
const App = (() => {

  function wireNav(){
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
    document.getElementById('btnConfirmOk')?.addEventListener('click', UI.runConfirm);
  }

  function switchView(name){
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + name)?.classList.add('active');
    document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    renderView(name);
    window.scrollTo({top:0});
  }

  function renderView(name){
    if(name === 'dashboard') Dashboard.render();
    if(name === 'consorcio') Consorcio.render();
    if(name === 'grupo') Grupo.render();
    if(name === 'historial') Historial.render();
    if(name === 'auditoria') Auditoria.render();
    // 'importar' y 'reportes' no necesitan re-render al entrar
  }

  // Refresca la vista actualmente activa (usado tras guardar/anular una legalización o importar)
  function refreshActiveView(){
    const active = document.querySelector('.view.active');
    if(!active) return;
    renderView(active.id.replace('view-',''));
  }

  async function init(){
    Storage.init();
    wireNav();
    switchView('dashboard');

    if(window.Sync){
      try{ await Sync.pull(); }catch(e){ console.warn('Sync.pull falló, se usa data local', e); }
      refreshActiveView();
      Sync.subscribeRealtime(() => refreshActiveView());
    }
  }

  return { init, switchView, refreshActiveView };
})();
window.App = App;

document.addEventListener('DOMContentLoaded', App.init);
