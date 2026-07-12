/* ============================================================
   UI — helpers de interfaz: modales, toasts, PIN administrador
   ============================================================ */
const UI = (() => {
  let confirmCallback = null;
  let _pinCallback = null;

  function openModal(id){ document.getElementById(id).classList.add('open'); }
  function closeModal(id){ document.getElementById(id).classList.remove('open'); }

  function openSidebar(){ document.getElementById('sidebar').classList.add('open'); document.getElementById('scrim').classList.add('open'); }
  function closeSidebar(){ document.getElementById('sidebar').classList.remove('open'); document.getElementById('scrim').classList.remove('open'); }

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
    const m = document.getElementById('modalAdminPin');
    if(m){ m.style.display = 'flex'; setTimeout(()=>input&&input.focus(), 100); }
  }
  function closeAdminPin(){
    _pinCallback = null;
    const m = document.getElementById('modalAdminPin');
    if(m) m.style.display = 'none';
  }
  function confirmAdminPin(){
    const pin = (document.getElementById('adminPinInput')?.value || '').trim();
    const adminPin = String(Storage.getSettings().adminPin || '1234');
    if(pin !== adminPin){ toast('PIN incorrecto', 'err'); return; }
    const cb = _pinCallback;
    closeAdminPin();
    if(cb) cb();
  }

  return { openModal, closeModal, openSidebar, closeSidebar, toast, confirm, runConfirm,
           requirePin, closeAdminPin, confirmAdminPin };
})();


/* ============================================================
   App — bootstrap, routing y wiring de eventos
   ============================================================ */
const App = (() => {

  function renderView(name){
    if(name === 'reporte')       DataModule.render();
    if(name === 'solicitud-pago') SolicitudPago.render();
    if(name === 'historial')     Historial.render();
    if(name === 'config')        loadConfigForm();
  }

  function switchView(name){
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-'+name).classList.add('active');
    document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    UI.closeSidebar();
    renderView(name);
    window.scrollTo({top:0});
  }

  async function syncRerender(key){
    if(key === 'cxp_aging_data'){ await DataModule.syncFijosFromAging(); }
    const active = document.querySelector('.view.active');
    if(!active || !active.id.startsWith('view-')) return;
    DataModule.load();
    renderView(active.id.slice('view-'.length));
  }

  function generarSolicitud(){
    const rows = DataModule.getSelectedRows();
    if(SolicitudPago.generar(rows)) switchView('solicitud-pago');
  }

  function publishAll(){
    if(!window.Sync){ UI.toast('Sincronización no disponible', 'err'); return; }
    UI.toast('Publicando datos…', 'ok');
    Sync.publishAll().then(res => {
      if(res && res.ok) UI.toast('Datos publicados para todos los usuarios', 'ok');
      else UI.toast('No se pudo publicar (revisa la conexión)', 'err');
    });
  }

  // ---------------- Configuración ----------------
  function loadConfigForm(){
    const s = Storage.getSettings();
    document.getElementById('cfgAdminPin').value = s.adminPin || '1234';
  }
  function saveConfig(){
    const newPin = document.getElementById('cfgAdminPin').value.trim();
    Storage.saveSettings({ adminPin: newPin || '1234' });
    UI.toast('Configuración guardada', 'ok');
  }

  function backup(){
    const data = Storage.exportBackup();
    const blob = new Blob([JSON.stringify(data,null,2)], { type:'application/json' });
    Utils.download(`Respaldo_CXP_${Utils.todayISO()}.json`, blob);
    UI.toast('Respaldo descargado', 'ok');
  }
  function restore(file){
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const obj = JSON.parse(reader.result);
        Storage.importBackup(obj);
        UI.toast('Respaldo restaurado correctamente', 'ok');
        DataModule.render();
      }catch(e){ UI.toast('Archivo de respaldo inválido', 'err'); }
    };
    reader.readAsText(file);
  }
  function resetAll(){
    UI.requirePin(() => {
      UI.confirm('Borrar todos los datos', 'Esto eliminará todas las facturas, solicitudes y configuración de CXP. Esta acción no se puede deshacer.', () => {
        Storage.resetAll();
        UI.toast('Datos restablecidos', 'ok');
        DataModule.render();
      });
    });
  }

  // ---------------- Wire de eventos ----------------
  function wire(){
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        if(btn.dataset.view === 'config'){
          UI.requirePin(() => switchView('config'));
        } else if(btn.dataset.view === 'solicitud-pago'){
          // Carga la solicitud Pendiente activa antes de mostrar la vista
          SolicitudPago.loadActive();
          switchView('solicitud-pago');
        } else {
          switchView(btn.dataset.view);
        }
      });
    });

    document.getElementById('btnConfirmOk').addEventListener('click', UI.runConfirm);

    // ---- Importar Excel de Pagos Provisionales ----
    const fileInput = document.getElementById('cxpFileInput');
    if(fileInput){
      fileInput.addEventListener('change', () => {
        const f = fileInput.files[0];
        if(!f) return;
        DataModule.importProvisionalFile(f)
          .then(r => {
            UI.toast(`${r.added} nueva(s), ${r.updated} actualizada(s) — total ${r.total}`, 'ok');
            if(r.errors && r.errors.length){
              UI.confirm('Filas con errores', `${r.errors.length} fila(s) no se importaron: ` + r.errors.slice(0,15).join(' · ') + (r.errors.length>15?` … y ${r.errors.length-15} más.`:''), () => {});
            }
            DataModule.render();
          })
          .catch(e => UI.toast(e.message, 'err'))
          .finally(() => { fileInput.value=''; });
      });
    }

    // ---- Filtros del Reporte ----
    const bindFilter = (id, key) => {
      const el = document.getElementById(id);
      if(el) el.addEventListener(el.tagName==='SELECT' ? 'change' : 'input', Utils.debounce(()=>DataModule.setFilter(key, el.value), 150));
    };
    bindFilter('dfProveedor', 'proveedor');
    bindFilter('dfFactura', 'factura');
    bindFilter('dfDesde', 'desde');
    bindFilter('dfHasta', 'hasta');
    const dfEstado = document.getElementById('dfEstado');
    if(dfEstado) dfEstado.addEventListener('change', () => DataModule.setFilter('estado', dfEstado.value));

    document.querySelectorAll('#tblCXP thead th[data-sort]').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => DataModule.setSort(th.dataset.sort));
    });

    const chkAll = document.getElementById('cxpChkAll');
    if(chkAll) chkAll.addEventListener('change', e => DataModule.selectAllVisible(e.target.checked));

    const btnLimpiarSel = document.getElementById('btnLimpiarSeleccion');
    if(btnLimpiarSel) btnLimpiarSel.addEventListener('click', DataModule.clearSelection);

    const btnGenerar = document.getElementById('btnGenerarSolicitud');
    if(btnGenerar) btnGenerar.addEventListener('click', generarSolicitud);

    // ---- Solicitud de Pago ----
    document.querySelectorAll('#spBankFields input').forEach(el => el.addEventListener('input', SolicitudPago.updatePreview));
    const btnGuardarSol = document.getElementById('btnGuardarSolicitud');
    if(btnGuardarSol) btnGuardarSol.addEventListener('click', SolicitudPago.guardar);
    const btnEditarSol = document.getElementById('btnEditarSolicitud');
    if(btnEditarSol) btnEditarSol.addEventListener('click', SolicitudPago.habilitarEdicion);
    const btnPagar = document.getElementById('btnPagar');
    if(btnPagar) btnPagar.addEventListener('click', SolicitudPago.pagar);
    const btnImprimirSol = document.getElementById('btnImprimirSolicitud');
    if(btnImprimirSol) btnImprimirSol.addEventListener('click', SolicitudPago.printDoc);
    const btnPdfSol = document.getElementById('btnPdfSolicitud');
    if(btnPdfSol) btnPdfSol.addEventListener('click', SolicitudPago.exportPDF);
    const btnExcelSol = document.getElementById('btnExcelSolicitud');
    if(btnExcelSol) btnExcelSol.addEventListener('click', SolicitudPago.exportExcel);

    // ---- Configuración ----
    document.getElementById('btnGuardarConfig').addEventListener('click', saveConfig);
    document.getElementById('btnBackup').addEventListener('click', backup);
    document.getElementById('btnRestoreBtn').addEventListener('click', () => document.getElementById('btnRestore').click());
    document.getElementById('btnRestore').addEventListener('change', e => { if(e.target.files[0]) restore(e.target.files[0]); });
    document.getElementById('btnReset').addEventListener('click', resetAll);
    const btnPublish = document.getElementById('btnPublishAll');
    if(btnPublish) btnPublish.addEventListener('click', publishAll);

    document.querySelectorAll('.modal-overlay').forEach(ov => {
      ov.addEventListener('click', e => { if(e.target === ov) ov.classList.remove('open'); });
    });
  }

  async function init(){
    Storage.init();
    if(window.Sync){
      try{ await Sync.pull(); }catch(e){ console.warn('Sync.pull falló, se usa data local', e); }
      try{ await DataModule.syncFijosFromAging(); }catch(e){ console.warn('Sync de Pagos Fijos falló, se usa data local', e); }
    }
    wire();
    DataModule.render();
    if(window.Sync){ Sync.subscribeRealtime(key => syncRerender(key)); }
  }

  return { init, switchView, generarSolicitud, publishAll };
})();

document.addEventListener('DOMContentLoaded', App.init);
