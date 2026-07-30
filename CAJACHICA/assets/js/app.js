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

  const TIPOS   = ['Ingreso','Gasto','Reposición','Ajuste'];
  const ESTADOS = ['Activo','Pendiente','Aprobado','Anulado'];
  const ESTADOS_QUE_CUENTAN = ['Activo','Aprobado']; // afectan el balance

  let _filters = { desde:'', hasta:'', anio:'', mes:'', responsable:'', estado:'', tipo:'' };
  let _page = 1;
  const PAGE_SIZE = 25;
  let _pendingComprobanteMv = null; // {name,type,dataUrl} en edición del modal Movimiento
  let _pendingComprobanteRp = null; // ídem modal Reposición

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
    wireFileInputs();
    setDefaultDates();
    populateConceptoSelect();
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
    if(name === 'movimientos') renderMovimientos();
    if(name === 'reposiciones') renderReposiciones();
    if(name === 'conceptos') renderConceptos();
    if(name === 'reportes' && window.Reportes) Reportes.render();
    if(name === 'config') renderConfig();
    if(name === 'dashboard') renderDashboard();
  }

  function renderAll(){
    recomputeBalances();
    populateConceptoSelect();
    populateFilterOptions();
    renderDashboard();
    const active = document.querySelector('.view.active')?.id;
    if(active === 'view-movimientos') renderMovimientos();
    if(active === 'view-reposiciones') renderReposiciones();
    if(active === 'view-conceptos') renderConceptos();
    if(active === 'view-reportes' && window.Reportes) Reportes.render();
    if(active === 'view-config') renderConfig();
  }

  function setDefaultDates(){
    const hoy = Utils.todayISO();
    const desde = Utils.addDays(hoy, -30);
    const fd = document.getElementById('fDesde'), fh = document.getElementById('fHasta');
    if(fd && !fd.value) fd.value = desde;
    if(fh && !fh.value) fh.value = hoy;
    _filters.desde = desde; _filters.hasta = hoy;
    const mv = document.getElementById('mvFecha'); if(mv) mv.value = hoy;
    const rp = document.getElementById('rpFecha'); if(rp) rp.value = hoy;
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

  /* ---------------- Movimientos: filtros ---------------- */
  function populateFilterOptions(){
    const list = Storage.getMovimientos();
    const anios = [...new Set(list.map(m => (m.fecha||'').slice(0,4)).filter(Boolean))].sort().reverse();
    const selAnio = document.getElementById('fAnio');
    if(selAnio){
      const cur = selAnio.value;
      selAnio.innerHTML = '<option value="">Todos</option>' + anios.map(a=>`<option value="${a}">${a}</option>`).join('');
      selAnio.value = cur;
    }
    const resp = [...new Set(list.map(m => m.responsable).filter(Boolean))].sort();
    const selResp = document.getElementById('fResponsable');
    if(selResp){
      const cur = selResp.value;
      selResp.innerHTML = '<option value="">Todos</option>' + resp.map(r=>`<option value="${Utils.escapeHtml(r)}">${Utils.escapeHtml(r)}</option>`).join('');
      selResp.value = cur;
    }
  }

  function aplicarFiltros(){
    _filters = {
      desde: document.getElementById('fDesde').value,
      hasta: document.getElementById('fHasta').value,
      anio: document.getElementById('fAnio').value,
      mes: document.getElementById('fMes').value,
      responsable: document.getElementById('fResponsable').value,
      estado: document.getElementById('fEstado').value,
      tipo: document.getElementById('fTipo').value
    };
    _page = 1;
    renderMovimientos();
    renderDashboard();
  }
  function limpiarFiltros(){
    document.getElementById('fDesde').value = '';
    document.getElementById('fHasta').value = '';
    document.getElementById('fAnio').value = '';
    document.getElementById('fMes').value = '';
    document.getElementById('fResponsable').value = '';
    document.getElementById('fEstado').value = '';
    document.getElementById('fTipo').value = '';
    _filters = { desde:'', hasta:'', anio:'', mes:'', responsable:'', estado:'', tipo:'' };
    _page = 1;
    renderMovimientos();
    renderDashboard();
  }

  function _getFiltered(){
    const f = _filters;
    return Storage.getMovimientos().filter(m => {
      if(f.desde && m.fecha < f.desde) return false;
      if(f.hasta && m.fecha > f.hasta) return false;
      if(f.anio && (m.fecha||'').slice(0,4) !== f.anio) return false;
      if(f.mes && (m.fecha||'').slice(5,7) !== f.mes) return false;
      if(f.responsable && m.responsable !== f.responsable) return false;
      if(f.estado && m.estado !== f.estado) return false;
      if(f.tipo && m.tipo !== f.tipo) return false;
      return true;
    }).sort((a,b) => (b.fecha||'').localeCompare(a.fecha||'') || (b.creadoEn||'').localeCompare(a.creadoEn||''));
  }

  const ESTADO_PILL = { Activo:'ok', Pendiente:'warn', Aprobado:'blue', Anulado:'gray' };
  const TIPO_PILL    = { Ingreso:'ok', Gasto:'red', 'Reposición':'blue', Ajuste:'indigo' };

  function renderMovimientos(){
    const filtered = _getFiltered();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if(_page > totalPages) _page = totalPages;
    const start = (_page-1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    const tbody = document.getElementById('tblMovimientosBody');
    if(pageRows.length === 0){
      tbody.innerHTML = `<tr><td colspan="14"><div class="t-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="32" height="32"><path d="M7 3h8l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M9 12h6M9 16h6M9 8h3"/></svg>
        <div>No se encontraron movimientos con estos filtros.</div>
      </div></td></tr>`;
    } else {
      tbody.innerHTML = pageRows.map(m => `
        <tr>
          <td style="white-space:nowrap">${Utils.fmtDate(m.fecha)}</td>
          <td class="mono">${m.numero}</td>
          <td><span class="pill ${TIPO_PILL[m.tipo]||'gray'}">${m.tipo}</span></td>
          <td>${Utils.escapeHtml(m.concepto||'—')}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${Utils.escapeHtml(m.descripcion)}">${Utils.escapeHtml(m.descripcion||'—')}</td>
          <td>${Utils.escapeHtml(m.beneficiario||'—')}</td>
          <td>${Utils.escapeHtml(m.responsable||'—')}</td>
          <td>${Utils.escapeHtml(m.formaPago||'—')}</td>
          <td class="r num">${Utils.fmtMoney(m.monto)}</td>
          <td class="r num"><b>${Utils.fmtMoney(m.balance)}</b></td>
          <td class="c"><span class="pill ${ESTADO_PILL[m.estado]||'gray'}">${m.estado}</span></td>
          <td>${Utils.escapeHtml(m.creadoPor||'—')}</td>
          <td style="white-space:nowrap">${m.creadoEn ? new Date(m.creadoEn).toLocaleString('es-DO') : '—'}</td>
          <td class="c">
            <div class="flex gap6" style="justify-content:center;">
              <button class="btn btn-ghost btn-icon btn-sm" title="Ver detalle" onclick="App.verDetalle('${m.id}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              ${m.estado === 'Pendiente' ? `<button class="btn btn-ghost btn-icon btn-sm" title="Aprobar" onclick="App.aprobarMovimiento('${m.id}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
              </button>` : ''}
              ${m.estado !== 'Anulado' ? `<button class="btn btn-ghost btn-icon btn-sm" title="Anular" onclick="App.confirmarAnular('${m.id}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>
              </button>` : ''}
            </div>
          </td>
        </tr>`).join('');
    }

    const pEl = document.getElementById('movPagination');
    if(filtered.length === 0){ pEl.innerHTML = ''; }
    else{
      pEl.innerHTML = `
        <span class="muted">${start+1}–${Math.min(start+PAGE_SIZE, filtered.length)} de ${filtered.length.toLocaleString()} movimientos</span>
        <button class="btn btn-ghost btn-sm" ${_page<=1?'disabled':''} onclick="App.goPage(${_page-1})">‹ Anterior</button>
        <button class="btn btn-ghost btn-sm" ${_page>=totalPages?'disabled':''} onclick="App.goPage(${_page+1})">Siguiente ›</button>`;
    }
  }
  function goPage(p){ _page = p; renderMovimientos(); }

  /* ---------------- Concepto <select> ---------------- */
  function populateConceptoSelect(){
    const sel = document.getElementById('mvConcepto');
    if(!sel) return;
    const cur = sel.value;
    const activos = Storage.getConceptos().filter(c => c.activo);
    sel.innerHTML = activos.map(c => `<option value="${Utils.escapeHtml(c.nombre)}">${Utils.escapeHtml(c.nombre)}</option>`).join('');
    if(activos.some(c => c.nombre === cur)) sel.value = cur;
  }

  /* ---------------- Adjuntos ---------------- */
  const TIPOS_ARCHIVO = { 'application/pdf':'PDF', 'image/jpeg':'JPG', 'image/png':'PNG' };
  function _readFile(file){
    return new Promise((resolve, reject) => {
      if(!file) return resolve(null);
      const ext = file.name.split('.').pop().toLowerCase();
      if(['pdf','jpg','jpeg','png'].indexOf(ext) === -1){
        reject(new Error('Formato no permitido. Usa PDF, JPG, JPEG o PNG.'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.onload = () => resolve({ name:file.name, type:file.type||('application/'+ext), dataUrl:reader.result });
      reader.readAsDataURL(file);
    });
  }
  function _attachPreviewHTML(att){
    if(!att) return '';
    return `<div class="attach-preview">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h8l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/></svg>
      <span class="name">${Utils.escapeHtml(att.name)}</span>
      <a href="${att.dataUrl}" download="${Utils.escapeHtml(att.name)}" class="btn btn-ghost btn-sm">Descargar</a>
    </div>`;
  }
  function wireFileInputs(){
    const mvInput = document.getElementById('mvComprobante');
    mvInput?.addEventListener('change', async () => {
      try{
        _pendingComprobanteMv = await _readFile(mvInput.files[0]);
        document.getElementById('mvComprobantePreview').style.display = _pendingComprobanteMv ? 'block' : 'none';
        document.getElementById('mvComprobantePreview').innerHTML = _attachPreviewHTML(_pendingComprobanteMv);
      }catch(e){ UI.toast(e.message, 'err'); mvInput.value=''; }
    });
    const rpInput = document.getElementById('rpComprobante');
    rpInput?.addEventListener('change', async () => {
      try{
        _pendingComprobanteRp = await _readFile(rpInput.files[0]);
        document.getElementById('rpComprobantePreview').style.display = _pendingComprobanteRp ? 'block' : 'none';
        document.getElementById('rpComprobantePreview').innerHTML = _attachPreviewHTML(_pendingComprobanteRp);
      }catch(e){ UI.toast(e.message, 'err'); rpInput.value=''; }
    });
  }

  /* ---------------- Modal: Nuevo Gasto ---------------- */
  // El formulario de "Nuevo Movimiento" registra solo Gastos. Ingresos y
  // Ajustes no tienen flujo de creación propio; Reposición se registra
  // aparte, desde su propio modal (con banco/cuenta/comprobante).
  function abrirModalMovimiento(){
    document.getElementById('mvFecha').value = Utils.todayISO();
    document.getElementById('mvDescripcion').value = '';
    document.getElementById('mvBeneficiario').value = '';
    document.getElementById('mvMonto').value = '';
    document.getElementById('mvFormaPago').value = 'Efectivo';
    document.getElementById('mvResponsable').value = Storage.getSettings().responsablePrincipal || '';
    document.getElementById('mvObservaciones').value = '';
    document.getElementById('mvComprobante').value = '';
    document.getElementById('mvComprobantePreview').style.display = 'none';
    _pendingComprobanteMv = null;
    populateConceptoSelect();
    UI.openModal('modalMovimiento');
    setTimeout(() => document.getElementById('mvDescripcion')?.focus(), 120);
  }

  function _doGuardarMovimiento(){
    const fecha    = document.getElementById('mvFecha').value || Utils.todayISO();
    const concepto = document.getElementById('mvConcepto').value;
    const descripcion = document.getElementById('mvDescripcion').value.trim();
    const beneficiario = document.getElementById('mvBeneficiario').value.trim();
    const monto = parseFloat(document.getElementById('mvMonto').value) || 0;
    const formaPago = document.getElementById('mvFormaPago').value;
    const responsable = document.getElementById('mvResponsable').value.trim();
    const observaciones = document.getElementById('mvObservaciones').value.trim();
    const settings = Storage.getSettings();

    const now = new Date().toISOString();
    const user = currentUserLabel();
    const mov = {
      id: Utils.uid('mv'),
      numero: Storage.getNextNumero(),
      fecha, tipo:'Gasto', ajusteSigno:null,
      concepto, descripcion, beneficiario, responsable, formaPago,
      monto, balance: 0,
      estado: settings.estadoInicial || 'Activo',
      adjunto: _pendingComprobanteMv,
      observaciones,
      creadoPor: user, creadoEn: now,
      modificadoPor: user, modificadoEn: now
    };
    Storage.addMovimiento(mov);
    recomputeBalances();
    UI.closeModal('modalMovimiento');
    UI.toast(`Movimiento ${mov.numero} guardado`, 'ok');
    renderAll();
  }

  function guardarMovimiento(){
    const monto = parseFloat(document.getElementById('mvMonto').value) || 0;
    const descripcion = document.getElementById('mvDescripcion').value.trim();
    if(!descripcion){ UI.toast('La descripción es requerida', 'err'); return; }
    if(monto <= 0){ UI.toast('El monto debe ser mayor a 0', 'err'); return; }

    const balanceActual = getBalanceActual();
    if(monto > balanceActual){
      UI.requirePin(() => {
        UI.toast('Gasto autorizado por encima del balance disponible', 'warn');
        _doGuardarMovimiento();
      });
      return;
    }
    _doGuardarMovimiento();
  }

  function aprobarMovimiento(id){
    Storage.updateMovimiento(id, { estado:'Aprobado', modificadoPor: currentUserLabel(), modificadoEn: new Date().toISOString() });
    recomputeBalances();
    UI.toast('Movimiento aprobado', 'ok');
    renderAll();
  }
  function confirmarAnular(id){
    const mov = Storage.getMovimiento(id);
    if(!mov) return;
    UI.requirePin(() => {
      UI.confirm('Anular movimiento', `¿Anular el movimiento ${mov.numero} (${Utils.fmtMoney(mov.monto)})? Esta acción no elimina el registro, solo lo marca como Anulado y deja de afectar el balance.`, () => {
        Storage.updateMovimiento(id, { estado:'Anulado', modificadoPor: currentUserLabel(), modificadoEn: new Date().toISOString() });
        recomputeBalances();
        UI.toast(`Movimiento ${mov.numero} anulado`, 'ok');
        renderAll();
      });
    });
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

  /* ---------------- Reposiciones ---------------- */
  function abrirModalReposicion(){
    document.getElementById('rpFecha').value = Utils.todayISO();
    document.getElementById('rpMonto').value = '';
    document.getElementById('rpBanco').value = Storage.getSettings().cuentaBancariaReposicion ? '' : '';
    document.getElementById('rpCuenta').value = Storage.getSettings().cuentaBancariaReposicion || '';
    document.getElementById('rpObservaciones').value = '';
    document.getElementById('rpComprobante').value = '';
    document.getElementById('rpComprobantePreview').style.display = 'none';
    _pendingComprobanteRp = null;
    UI.openModal('modalReposicion');
  }
  function guardarReposicion(){
    const fecha = document.getElementById('rpFecha').value || Utils.todayISO();
    const monto = parseFloat(document.getElementById('rpMonto').value) || 0;
    const banco = document.getElementById('rpBanco').value.trim();
    const cuenta = document.getElementById('rpCuenta').value.trim();
    const observaciones = document.getElementById('rpObservaciones').value.trim();
    if(monto <= 0){ UI.toast('El monto debe ser mayor a 0', 'err'); return; }
    if(!banco){ UI.toast('El banco es requerido', 'err'); return; }

    const now = new Date().toISOString();
    const user = currentUserLabel();
    const mov = {
      id: Utils.uid('mv'),
      numero: Storage.getNextNumero(),
      fecha, tipo:'Reposición', ajusteSigno:null,
      concepto:'Reposición de Fondo', descripcion:`Reposición de fondo — ${banco} ${cuenta}`.trim(),
      beneficiario: banco, responsable: user, formaPago:'Transferencia',
      monto, balance:0,
      estado: Storage.getSettings().estadoInicial || 'Activo',
      adjunto: _pendingComprobanteRp,
      observaciones,
      creadoPor: user, creadoEn: now, modificadoPor: user, modificadoEn: now
    };
    Storage.addMovimiento(mov);
    Storage.addReposicion({
      id: Utils.uid('rp'), movimientoId: mov.id,
      fecha, monto, banco, cuenta, comprobante: _pendingComprobanteRp,
      usuario: user, observaciones
    });
    recomputeBalances();
    UI.closeModal('modalReposicion');
    UI.toast(`Reposición registrada — ${mov.numero}`, 'ok');
    renderAll();
  }
  function renderReposiciones(){
    const list = Storage.getReposiciones().slice().sort((a,b) => (b.fecha||'').localeCompare(a.fecha||''));
    const tbody = document.getElementById('tblReposicionesBody');
    if(list.length === 0){
      tbody.innerHTML = `<tr><td colspan="7"><div class="t-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="32" height="32"><path d="M7 3h8l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/></svg>
        <div>Aún no hay reposiciones registradas.</div>
      </div></td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(r => `
      <tr>
        <td>${Utils.fmtDate(r.fecha)}</td>
        <td class="r num"><b>${Utils.fmtMoney(r.monto)}</b></td>
        <td>${Utils.escapeHtml(r.banco||'—')}</td>
        <td>${Utils.escapeHtml(r.cuenta||'—')}</td>
        <td class="c">${r.comprobante ? `<a href="${r.comprobante.dataUrl}" download="${Utils.escapeHtml(r.comprobante.name)}" class="btn btn-ghost btn-sm">Ver</a>` : '<span class="muted">—</span>'}</td>
        <td>${Utils.escapeHtml(r.usuario||'—')}</td>
        <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${Utils.escapeHtml(r.observaciones)}">${Utils.escapeHtml(r.observaciones||'—')}</td>
      </tr>`).join('');
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
      populateConceptoSelect();
    };
    UI.requirePin(doSave);
  }
  function confirmarEliminarConcepto(id){
    UI.requirePin(() => {
      UI.confirm('Eliminar concepto', '¿Eliminar este concepto del catálogo? Los movimientos ya registrados con este concepto no se modifican.', () => {
        Storage.deleteConcepto(id);
        UI.toast('Concepto eliminado', 'ok');
        renderConceptos();
        populateConceptoSelect();
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
      });
    });
  }
  async function publicarTodo(){
    if(!window.Sync){ UI.toast('Sincronización no disponible', 'err'); return; }
    const res = await Sync.publishAll();
    UI.toast(res.ok ? `Datos publicados (${res.count} clave(s))` : 'No se pudo publicar', res.ok?'ok':'err');
  }

  return {
    init, switchView, aplicarFiltros, limpiarFiltros, goPage,
    abrirModalMovimiento, guardarMovimiento,
    aprobarMovimiento, confirmarAnular, verDetalle,
    abrirModalReposicion, guardarReposicion,
    abrirModalConcepto, guardarConcepto, confirmarEliminarConcepto,
    guardarConfigFondo, guardarConfigPin, descargarBackup, restaurarBackup, confirmarBorrarTodo, publicarTodo,
    getBalanceActual, recomputeBalances,
    ESTADOS_QUE_CUENTAN, TIPO_PILL, ESTADO_PILL
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
