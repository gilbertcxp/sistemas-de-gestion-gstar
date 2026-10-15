/* ============================================================
   UI — helpers de interfaz: modales, toasts, PIN administrador
   (mismo patrón exacto que CAJACHICA/Legalización)
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

  // Menú lateral en pantallas angostas (móvil/tablet)
  function openSidebar(){ document.getElementById('sidebar')?.classList.add('open'); document.getElementById('scrim')?.classList.add('open'); }
  function closeSidebar(){ document.getElementById('sidebar')?.classList.remove('open'); document.getElementById('scrim')?.classList.remove('open'); }

  return { openModal, closeModal, toast, confirm, runConfirm, requirePin, closeAdminPin, confirmAdminPin, openSidebar, closeSidebar };
})();
window.UI = UI;

/* ============================================================
   App — bootstrap, navegación entre vistas (Facturas / Cargar)
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
    UI.closeSidebar();
    window.scrollTo({top:0});
  }

  function renderView(name){
    if(name === 'facturas') Facturas.render();
    if(name === 'cargar') Cargar.render();
  }

  function refreshActiveView(){
    const active = document.querySelector('.view.active');
    if(!active) return;
    // No se re-dibuja "Cargar" si hay una vista previa en curso (se perdería lo que el usuario está revisando)
    if(active.id === 'view-cargar' && Cargar._state()){ Cargar.renderLotes(); return; }
    renderView(active.id.replace('view-',''));
  }

  async function init(){
    Storage.init();
    wireNav();
    switchView('facturas');

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
