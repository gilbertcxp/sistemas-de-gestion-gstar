/* ============================================================
   UI — helpers de interfaz: modales, toasts, sidebar, pills
   ============================================================ */
const UI = (() => {
  let confirmCallback = null;

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

  let _pinCallback = null;
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
    const pin      = (document.getElementById('adminPinInput')?.value || '').trim();
    const adminPin = String(Storage.getSettings().adminPin || '1234');
    if(pin !== adminPin){ toast('PIN incorrecto', 'err'); return; }
    const cb = _pinCallback;
    closeAdminPin();
    if(cb) cb();
  }

  return { openModal, closeModal, openSidebar, closeSidebar, toast, confirm, runConfirm,
           requirePin, closeAdminPin, confirmAdminPin };
})();
document.getElementById('btnConfirmOk')?.addEventListener('click', UI.runConfirm);

/* ============================================================
   App — Caja Chica: bootstrap, vistas, CRUD, dashboard
   ============================================================ */
const App = (() => {

  const ESTADOS_QUE_CUENTAN = ['Activo','Aprobado']; // afectan el balance (histórico, usado por Dashboard/Reportes)

  let _filters = { desde:'', hasta:'', anio:'', mes:'', responsable:'', estado:'', tipo:'' };

  function currentUserLabel(){
    try{
      const u = window.Auth && Auth.getUser && Auth.getUser();
      return (u && (u.name || u.email)) || 'Usuario';
    }catch(e){ return 'Usuario'; }
  }

  /* ---------------- Bootstrap ---------------- */
  async function init(){
    Storage.init();
    wireNav();
    setDefaultDates();
    renderAll();

    if(window.Sync){
      const res = await Sync.pull();
      if(res.ok){ renderAll(); }
      Sync.subscribeRealtime(() => renderAll());
    }
  }

  function wireNav(){
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
  }

  function switchView(name){
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + name)?.classList.add('active');
    document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    UI.closeSidebar();
    if(name === 'movimientos' && window.Reposicion) Reposicion.render();
    if(name === 'reposiciones' && window.Reposicion) Reposicion.renderHistoryView();
    if(name === 'conceptos') renderConceptos();
    if(name === 'reportes' && window.Reportes) Reportes.render();
    if(name === 'config') renderConfig();
    if(name === 'dashboard') renderDashboard();
  }

  function renderAll(){
    recomputeBalances();
    renderDashboard();
    const active = document.querySelector('.view.active')?.id;
    if(active === 'view-movimientos' && window.Reposicion) Reposicion.render();
    if(active === 'view-conceptos') renderConceptos();
    if(active === 'view-reportes' && window.Reportes) Reportes.render();
    if(active === 'view-config') renderConfig();
  }

  function setDefaultDates(){
    const hoy = Utils.todayISO();
    const desde = Utils.addDays(hoy, -30);
    _filters.desde = desde; _filters.hasta = hoy;
  }

  /* ---------------- Balance (nunca se calcula manualmente) ---------------- */
  // Recalcula desde cero, en orden cronológico, el balance tras cada movimiento
  // que cuenta (Activo/Aprobado). Anulado y Pendiente no afectan el balance,
  // pero conservan el último balance vigente para mostrarlo en la tabla.
  function recomputeBalances(){
    const list = Storage.getMovimientos();
    const ordered = list.slice().sort((a,b) => {
      const fa = a.fecha||'', fb = b.fecha||'';
      if(fa !== fb) return fa.localeCompare(fb);
      return (a.creadoEn||'').localeCompare(b.creadoEn||'');
    });
    let balance = Number(Storage.getSettings().balanceInicial)||0;
    ordered.forEach(m => {
      if(ESTADOS_QUE_CUENTAN.indexOf(m.estado) !== -1){
        if(m.tipo === 'Ingreso' || m.tipo === 'Reposición'){
          balance += Number(m.monto)||0;
        }else if(m.tipo === 'Gasto'){
          balance -= Number(m.monto)||0;
        }else if(m.tipo === 'Ajuste'){
          balance += (m.ajusteSigno === '-' ? -1 : 1) * (Number(m.monto)||0);
        }
      }
      m.balance = Math.round(balance*100)/100;
    });
    Storage.saveMovimientos(ordered);
  }

  function getBalanceActual(){
    const list = Storage.getMovimientos();
    if(list.length === 0) return Number(Storage.getSettings().balanceInicial)||0;
    const ordered = list.slice().sort((a,b) => {
      const fa = a.fecha||'', fb = b.fecha||'';
      if(fa !== fb) return fa.localeCompare(fb);
      return (a.creadoEn||'').localeCompare(b.creadoEn||'');
    });
    return ordered[ordered.length-1].balance;
  }

  /* ---------------- Dashboard ---------------- */
  function renderDashboard(){
    const settings = Storage.getSettings();
    const balance = getBalanceActual();
    document.getElementById('kpiBalance').textContent = Utils.fmtMoney(balance);

    const { desde, hasta } = _filters;
    const periodo = Storage.getMovimientos().filter(m => {
      if(m.estado === 'Anulado') return false;
      if(desde && m.fecha < desde) return false;
      if(hasta && m.fecha > hasta) return false;
      return true;
    });

    const ingresos = periodo.filter(m => m.tipo === 'Ingreso').reduce((s,m)=>s+(Number(m.monto)||0),0);
    const gastos   = periodo.filter(m => m.tipo === 'Gasto').reduce((s,m)=>s+(Number(m.monto)||0),0);
    const reposiciones = periodo.filter(m => m.tipo === 'Reposición');

    document.getElementById('kpiIngresos').textContent = Utils.fmtMoney(ingresos);
    document.getElementById('kpiGastos').textContent = Utils.fmtMoney(gastos);
    document.getElementById('kpiReposiciones').textContent = reposiciones.length;
    document.getElementById('kpiMovimientos').textContent = Storage.getMovimientos().length;

    // Promedios de gasto
    const gastosActivos = periodo.filter(m => m.tipo === 'Gasto');
    const dias = new Set(gastosActivos.map(m => m.fecha)).size || 1;
    const totalGastoPeriodo = gastosActivos.reduce((s,m)=>s+(Number(m.monto)||0),0);
    document.getElementById('statDiario').textContent = Utils.fmtMoney(totalGastoPeriodo / dias);
    document.getElementById('statSemanal').textContent = Utils.fmtMoney(totalGastoPeriodo / dias * 7);
    document.getElementById('statMensual').textContent = Utils.fmtMoney(totalGastoPeriodo / dias * 30);

    // Alertas
    const alerts = [];
    if(balance < (Number(settings.montoMinimo)||0)){
      alerts.push({ type:'danger', msg:`El balance actual (${Utils.fmtMoney(balance)}) está por debajo del mínimo configurado (${Utils.fmtMoney(settings.montoMinimo)}).` });
    }
    const pendientes = Storage.getMovimientos().filter(m => m.estado === 'Pendiente');
    if(pendientes.length > 0){
      alerts.push({ type:'warn', msg:`Hay ${pendientes.length} movimiento(s) pendiente(s) de aprobación.` });
    }
    document.getElementById('dashAlerts').innerHTML = alerts.map(a => `
      <div class="cc-alert ${a.type}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        ${Utils.escapeHtml(a.msg)}
      </div>`).join('');

    if(window.Charts) Charts.renderAll(periodo);
  }

  const ESTADO_PILL = { Activo:'ok', Pendiente:'warn', Aprobado:'blue', Anulado:'gray' };
  const TIPO_PILL    = { Ingreso:'ok', Gasto:'red', 'Reposición':'blue', Ajuste:'indigo' };

  /* ---------------- Adjuntos (histórico, usado por verDetalle) ---------------- */
  function _attachPreviewHTML(att){
    if(!att) return '';
    return `<div class="attach-preview">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h8l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/></svg>
      <span class="name">${Utils.escapeHtml(att.name)}</span>
      <a href="${att.dataUrl}" download="${Utils.escapeHtml(att.name)}" class="btn btn-ghost btn-sm">Descargar</a>
    </div>`;
  }

  // El botón "Nuevo Gasto" del Dashboard lleva directo a la pantalla de
  // Reposición de Caja Chica y agrega una fila de desembolso lista para editar.
  function abrirModalMovimiento(){
    switchView('movimientos');
    if(window.Reposicion) Reposicion.addRow();
  }

  function verDetalle(id){
    const m = Storage.getMovimiento(id);
    if(!m) return;
    document.getElementById('detTitle').textContent = `Movimiento ${m.numero}`;
    document.getElementById('detBody').innerHTML = `
      <div class="field-row">
        <div><label class="f-label">Fecha</label><p>${Utils.fmtDate(m.fecha)}</p></div>
        <div><label class="f-label">Tipo</label><p><span class="pill ${TIPO_PILL[m.tipo]||'gray'}">${m.tipo}</span></p></div>
      </div>
      <div class="field-row">
        <div><label class="f-label">Concepto</label><p>${Utils.escapeHtml(m.concepto||'—')}</p></div>
        <div><label class="f-label">Estado</label><p><span class="pill ${ESTADO_PILL[m.estado]||'gray'}">${m.estado}</span></p></div>
      </div>
      <div class="field"><label class="f-label">Descripción</label><p>${Utils.escapeHtml(m.descripcion||'—')}</p></div>
      <div class="field-row">
        <div><label class="f-label">Beneficiario</label><p>${Utils.escapeHtml(m.beneficiario||'—')}</p></div>
        <div><label class="f-label">Responsable</label><p>${Utils.escapeHtml(m.responsable||'—')}</p></div>
      </div>
      <div class="field-row">
        <div><label class="f-label">Forma de Pago</label><p>${Utils.escapeHtml(m.formaPago||'—')}</p></div>
        <div><label class="f-label">Monto</label><p><b>${Utils.fmtMoney(m.monto)}</b></p></div>
      </div>
      <div class="field"><label class="f-label">Balance después del movimiento</label><p><b>${Utils.fmtMoney(m.balance)}</b></p></div>
      <div class="field"><label class="f-label">Observaciones</label><p>${Utils.escapeHtml(m.observaciones||'—')}</p></div>
      <div class="field"><label class="f-label">Comprobante</label>${m.adjunto ? _attachPreviewHTML(m.adjunto) : '<p class="muted">Sin comprobante adjunto.</p>'}</div>
      <div class="divider"></div>
      <div class="field-row">
        <div><label class="f-label">Registrado por</label><p>${Utils.escapeHtml(m.creadoPor||'—')} · ${m.creadoEn ? new Date(m.creadoEn).toLocaleString('es-DO') : '—'}</p></div>
        <div><label class="f-label">Última modificación</label><p>${Utils.escapeHtml(m.modificadoPor||'—')} · ${m.modificadoEn ? new Date(m.modificadoEn).toLocaleString('es-DO') : '—'}</p></div>
      </div>`;
    UI.openModal('modalDetalle');
  }

  /* ---------------- Catálogo de Conceptos ---------------- */
  function renderConceptos(){
    const list = Storage.getConceptos();
    const tbody = document.getElementById('tblConceptosBody');
    tbody.innerHTML = list.map(c => `
      <tr>
        <td>${Utils.escapeHtml(c.nombre)}</td>
        <td class="c"><span class="pill ${c.activo?'ok':'gray'}">${c.activo?'Activo':'Inactivo'}</span></td>
        <td class="c">
          <div class="flex gap6" style="justify-content:center;">
            <button class="btn btn-ghost btn-icon btn-sm" title="Editar" onclick="App.abrirModalConcepto('${c.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="btn btn-ghost btn-icon btn-sm" title="Eliminar" onclick="App.confirmarEliminarConcepto('${c.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/></svg>
            </button>
          </div>
        </td>
      </tr>`).join('');
  }
  function abrirModalConcepto(id){
    document.getElementById('cptId').value = id || '';
    document.getElementById('cptModalTitle').textContent = id ? 'Editar Concepto' : 'Nuevo Concepto';
    const c = id ? Storage.getConceptos().find(x=>x.id===id) : null;
    document.getElementById('cptNombre').value = c ? c.nombre : '';
    UI.openModal('modalConcepto');
    setTimeout(()=>document.getElementById('cptNombre')?.focus(), 100);
  }
  function guardarConcepto(){
    const id = document.getElementById('cptId').value;
    const nombre = document.getElementById('cptNombre').value.trim();
    if(!nombre){ UI.toast('El nombre es requerido', 'err'); return; }
    const doSave = () => {
      if(id) Storage.updateConcepto(id, { nombre });
      else Storage.addConcepto(nombre);
      UI.closeModal('modalConcepto');
      UI.toast('Concepto guardado', 'ok');
      renderConceptos();
    };
    UI.requirePin(doSave);
  }
  function confirmarEliminarConcepto(id){
    UI.requirePin(() => {
      UI.confirm('Eliminar concepto', '¿Eliminar este concepto del catálogo? Los movimientos ya registrados con este concepto no se modifican.', () => {
        Storage.deleteConcepto(id);
        UI.toast('Concepto eliminado', 'ok');
        renderConceptos();
      });
    });
  }

  /* ---------------- Configuración ---------------- */
  function renderConfig(){
    const s = Storage.getSettings();
    document.getElementById('cfgBalanceInicial').value = s.balanceInicial;
    document.getElementById('cfgMontoMinimo').value = s.montoMinimo;
    document.getElementById('cfgResponsable').value = s.responsablePrincipal;
    document.getElementById('cfgMoneda').value = s.moneda;
    document.getElementById('cfgCuentaBancaria').value = s.cuentaBancariaReposicion;
    document.getElementById('cfgEstadoInicial').value = s.estadoInicial;
    document.getElementById('cfgAdminPin').value = '';
  }
  function guardarConfigFondo(){
    Storage.saveSettings({
      balanceInicial: parseFloat(document.getElementById('cfgBalanceInicial').value)||0,
      montoMinimo: parseFloat(document.getElementById('cfgMontoMinimo').value)||0,
      responsablePrincipal: document.getElementById('cfgResponsable').value.trim(),
      moneda: document.getElementById('cfgMoneda').value,
      cuentaBancariaReposicion: document.getElementById('cfgCuentaBancaria').value.trim(),
      estadoInicial: document.getElementById('cfgEstadoInicial').value
    });
    recomputeBalances();
    UI.toast('Configuración guardada', 'ok');
    renderAll();
  }
  function guardarConfigPin(){
    const pin = document.getElementById('cfgAdminPin').value.trim();
    if(!pin){ UI.toast('Ingresa un PIN', 'err'); return; }
    Storage.saveSettings({ adminPin: pin });
    UI.toast('PIN actualizado', 'ok');
    document.getElementById('cfgAdminPin').value = '';
  }

  function descargarBackup(){
    const data = Storage.exportBackup();
    const blob = new Blob([JSON.stringify(data,null,2)], { type:'application/json' });
    Utils.download(`CajaChica_Backup_${Utils.todayISO()}.json`, blob);
  }
  function restaurarBackup(input){
    const file = input.files[0];
    if(!file) return;
    UI.requirePin(() => {
      const reader = new FileReader();
      reader.onload = () => {
        try{
          Storage.importBackup(JSON.parse(reader.result));
          UI.toast('Respaldo restaurado', 'ok');
          renderAll();
        }catch(e){ UI.toast('Archivo de respaldo inválido', 'err'); }
        input.value = '';
      };
      reader.readAsText(file);
    });
  }
  function confirmarBorrarTodo(){
    UI.requirePin(() => {
      UI.confirm('Borrar todos los datos', '¿Borrar TODOS los movimientos, reposiciones y conceptos de Caja Chica? Esta acción no se puede deshacer.', () => {
        Storage.resetAll();
        UI.toast('Todos los datos fueron borrados', 'ok');
        renderAll();
        if(window.Reposicion) Reposicion.render();
      });
    });
  }
  async function publicarTodo(){
    if(!window.Sync){ UI.toast('Sincronización no disponible', 'err'); return; }
    const res = await Sync.publishAll();
    UI.toast(res.ok ? `Datos publicados (${res.count} clave(s))` : 'No se pudo publicar', res.ok?'ok':'err');
  }

  return {
    init, switchView,
    abrirModalMovimiento, verDetalle,
    abrirModalConcepto, guardarConcepto, confirmarEliminarConcepto,
    guardarConfigFondo, guardarConfigPin, descargarBackup, restaurarBackup, confirmarBorrarTodo, publicarTodo,
    getBalanceActual, recomputeBalances,
    ESTADOS_QUE_CUENTAN, TIPO_PILL, ESTADO_PILL
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
