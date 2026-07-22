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

  function estadoPill(estado){
    const map = { Pendiente:'warn', Pagada:'ok', Anulada:'gray' };
    const cls = map[estado] || 'gray';
    return `<span class="pill ${cls}"><span class="pill-dot"></span>${estado}</span>`;
  }

  let _pinCallback = null;
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
    const pin      = (document.getElementById('adminPinInput')?.value || '').trim();
    const adminPin = String(Storage.getSettings().adminPin || '1234');
    if(pin !== adminPin){ toast('PIN incorrecto', 'err'); return; }
    const cb = _pinCallback;        // capturar antes de cerrar (closeAdminPin pone null)
    closeAdminPin();
    if(cb) cb();
  }

  return { openModal, closeModal, openSidebar, closeSidebar, toast, confirm, runConfirm, estadoPill,
           requirePin, closeAdminPin, confirmAdminPin };
})();


/* ============================================================
   App — bootstrap, routing y wiring de eventos
   ============================================================ */
const App = (() => {

  let currentFile = null;

  // ---------------- Routing ----------------
  function renderView(name){
    if(name === 'facturas') renderFacturasTable();
    if(name === 'clientes') Clients.render();
    if(name === 'reportes') renderReportes();
    if(name === 'config') loadConfigForm();
    if(name === 'dashboard') Dashboard.renderAll();
    if(name === 'data') DataModule.render();
    if(name === 'solicitud-pago') SolicitudPago.render();
    if(name === 'estado-cuenta') EstadoCuenta.render();
    if(name === 'pagos') Pagos.render();
    if(name === 'antiguedad') AgingComp.render();
    if(name === 'saldo-favor') SaldoFavor.render();
  }

  function switchView(name){
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-'+name).classList.add('active');
    document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    UI.closeSidebar();
    renderView(name);
    window.scrollTo({top:0});
  }

  // Re-renderiza la vista activa cuando llegan datos de otro usuario (realtime)
  function syncRerender(){
    const active = document.querySelector('.view.active');
    if(!active || !active.id.startsWith('view-')) return;
    const name = active.id.slice('view-'.length);
    if(typeof DataModule !== 'undefined' && DataModule.load) DataModule.load();
    Dashboard.renderAll();
    renderView(name);
  }

  // Publica a la nube toda la data local del usuario actual (admin)
  function publishAll(){
    if(!window.Sync){ UI.toast('Sincronización no disponible', 'err'); return; }
    UI.toast('Publicando datos…', 'ok');
    Sync.publishAll().then(res => {
      if(res && res.ok) UI.toast('Datos publicados para todos los usuarios', 'ok');
      else UI.toast('No se pudo publicar (revisa la conexión)', 'err');
    });
  }

  // ---------------- Cargar Excel ----------------
  async function handleFile(file){
    if(!file) return;
    currentFile = file;
    document.getElementById('fileInfo').style.display = 'flex';
    document.getElementById('fileInfoName').textContent = file.name;
    document.getElementById('fileInfoMeta').textContent = (file.size/1024).toFixed(1) + ' KB';
    try{
      const parsed = await Parser.parseFile(file);
      Invoices.setStaged(parsed);
      const meta = Invoices.getStagedMeta();
      document.getElementById('periodoDesde').value = meta.desde || '';
      document.getElementById('periodoHasta').value = meta.hasta || '';
      document.getElementById('campoVendedor').value = Storage.getSettings().vendedor;
      document.getElementById('cardPreview').style.display = 'block';
      renderPreviewTable();
      updateConceptoPreview();
      UI.toast(`Archivo leído: ${parsed.rows.length} consorcios encontrados`, 'ok');
    }catch(err){
      console.error(err);
      UI.toast(err.message || 'No se pudo procesar el archivo', 'err');
    }
  }

  function clearFile(){
    currentFile = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('cardPreview').style.display = 'none';
    Invoices.clearStaged();
  }

  function updateConceptoPreview(){
    const desde = document.getElementById('periodoDesde').value;
    const hasta = document.getElementById('periodoHasta').value;
    document.getElementById('conceptoPreview').textContent = Invoices.buildConcepto(desde, hasta);
    Invoices.getStagedMeta().desde = desde;
    Invoices.getStagedMeta().hasta = hasta;
  }

  function renderPreviewTable(){
    const staged = Invoices.getStaged();
    const tbody = document.querySelector('#tblPreview tbody');
    const settings = Storage.getSettings();
    const pct = Number(settings.porcentaje)||0;

    if(staged.length === 0){
      tbody.innerHTML = `<tr><td colspan="8"><div class="t-empty">No hay registros en este archivo.</div></td></tr>`;
    } else {
      tbody.innerHTML = staged.map(r => {
        const monto2 = Math.round(r.montoOriginal*(pct/100)*100)/100;
        const total = r.montoOriginal + monto2;
        const statusPill = r.isUD
          ? `<span class="pill indigo"><span class="pill-dot"></span>Grupo UD</span>`
          : r.status === 'neg'
          ? `<span class="pill red"><span class="pill-dot"></span>A facturar</span>`
          : r.status === 'pos'
          ? `<span class="pill blue"><span class="pill-dot"></span>Sin facturar</span>`
          : `<span class="pill gray"><span class="pill-dot"></span>En cero</span>`;
        const linkCell = r.isUD
          ? `<span class="muted">Consolidado en factura UD</span>`
          : r.status !== 'neg'
          ? `<span class="muted">—</span>`
          : r.clientId
          ? `<span class="pill ok">${Utils.escapeHtml(r.clientName)}</span>`
          : `<button class="btn btn-soft btn-sm" onclick="App.openVincular('${Utils.jsAttr(r.excelName)}')">Vincular cliente</button>`;
        const checkbox = (!r.isUD && r.status === 'neg')
          ? `<input type="checkbox" class="chk" ${r.included && r.clientId ? 'checked' : ''} ${r.clientId ? '' : 'disabled'} onchange="App.toggleStagedRow('${Utils.jsAttr(r.excelName)}', this.checked)">`
          : '';
        return `<tr>
          <td class="c">${checkbox}</td>
          <td>${Utils.escapeHtml(r.excelName)}</td>
          <td>${linkCell}</td>
          <td class="r num">${Utils.fmtNum(r.balance)}</td>
          <td class="r num">${(!r.isUD && r.status==='neg') ? Utils.fmtNum(r.montoOriginal) : '—'}</td>
          <td class="r num">${(!r.isUD && r.status==='neg') ? Utils.fmtNum(monto2) : '—'}</td>
          <td class="r num"><b>${(!r.isUD && r.status==='neg') ? Utils.fmtNum(total) : '—'}</b></td>
          <td>${statusPill}</td>
        </tr>`;
      }).join('');
    }

    const neg = staged.filter(r=>r.status==='neg' && !r.isUD).length;
    const pos = staged.filter(r=>r.status==='pos' && !r.isUD).length;
    const zero = staged.filter(r=>r.status==='zero').length;
    document.getElementById('cntNeg').textContent = neg;
    document.getElementById('cntPos').textContent = pos;
    document.getElementById('cntZero').textContent = zero;
    const meta = Invoices.getStagedMeta();
    document.getElementById('previewMeta').textContent = `${meta.sourceLabel || 'Archivo cargado'}${meta.desde?` · Semana ${Utils.fmtDate(meta.desde)} – ${Utils.fmtDate(meta.hasta)}`:''}`;

    const selectable = staged.filter(r => !r.isUD && r.status==='neg' && r.included && r.clientId);
    const sumTotal = selectable.reduce((s,r)=> s + r.montoOriginal*(1+pct/100), 0);
    const udPrev = Invoices.getUDPreview();
    const willGenerateUD = Invoices.getUDIncluded() && (udPrev.cxcCount + udPrev.cxpCount) > 0;
    const totalCount = selectable.length + (willGenerateUD ? 1 : 0);
    const totalSum = sumTotal + (willGenerateUD ? udPrev.montoFinal : 0);
    document.getElementById('genSummary').textContent = `${totalCount} factura(s) a generar · Total ${Utils.fmtMoney(totalSum)}`;
    document.getElementById('btnGenerar').disabled = totalCount === 0;

    renderUDPreview(udPrev);
    Dashboard.renderPulse();
  }

  function renderUDPreview(udPrev){
    const card = document.getElementById('cardUD');
    const prev = udPrev || Invoices.getUDPreview();
    if(prev.cxcCount + prev.cxpCount === 0){ card.style.display = 'none'; return; }
    card.style.display = '';
    document.getElementById('chkIncludeUD').checked = Invoices.getUDIncluded();
    document.getElementById('udCxcCount').textContent = prev.cxcCount;
    document.getElementById('udCxcTotal').textContent = Utils.fmtMoney(prev.totalCXC);
    document.getElementById('udCxpCount').textContent = prev.cxpCount;
    document.getElementById('udCxpTotal').textContent = Utils.fmtMoney(prev.totalCXP);
    const tag = prev.resultadoTipo === 'CERO' ? 'Balance en cero' : `A ${prev.resultadoTipo} ${Utils.fmtMoney(prev.montoFinal)}`;
    document.getElementById('udResultado').textContent = tag;
  }

  function toggleStagedRow(excelName, checked){
    Invoices.setStagedIncluded(excelName, checked);
    renderPreviewTable();
  }

  let vincularTarget = null;
  let pendingVinculoTarget = null; // si se crea un cliente nuevo desde el flujo de vinculación, se autoenlaza al guardar

  function openVincular(excelName){
    vincularTarget = excelName;
    document.getElementById('vincularNombreExcel').textContent = excelName;
    const select = document.getElementById('vincularSelect');
    const clients = Storage.getClients().slice().sort((a,b)=>a.nombre.localeCompare(b.nombre));
    select.innerHTML = `<option value="">— Seleccionar —</option>` + clients.map(c => `<option value="${c.id}">${Utils.escapeHtml(c.nombre)}</option>`).join('');
    UI.openModal('modalVincular');
  }
  function confirmVinculo(){
    const clientId = document.getElementById('vincularSelect').value;
    if(!clientId){ UI.toast('Selecciona un cliente', 'err'); return; }
    Invoices.setStagedLink(vincularTarget, clientId);
    Invoices.setStagedIncluded(vincularTarget, true);
    UI.closeModal('modalVincular');
    renderPreviewTable();
  }
  function crearDesdeVincular(){
    UI.closeModal('modalVincular');
    pendingVinculoTarget = vincularTarget;
    document.getElementById('clienteModalTitle').textContent = 'Nuevo cliente';
    document.getElementById('clienteId').value = '';
    document.getElementById('clienteNombre').value = vincularTarget;
    ['clienteRnc','clienteTelefono','clienteDireccion','clienteCorreo','clienteContacto'].forEach(id => document.getElementById(id).value = '');
    UI.openModal('modalCliente');
  }

  function generarFacturas(){
    updateConceptoPreview();
    const settings = Storage.getSettings();
    settings.vendedor = document.getElementById('campoVendedor').value || settings.vendedor;
    Storage.saveSettings(settings);
    const created = Invoices.generateFromStaged();
    if(created.length === 0){ UI.toast('No hay facturas seleccionadas para generar', 'err'); return; }

    UI.toast(`${created.length} factura(s) generada(s) correctamente`, 'ok');
    renderPreviewTable();
    Dashboard.renderAll();
    // Pre-selecciona el lote recién creado para que "Descargar todas en ZIP"
    // funcione con un solo clic, sin tener que marcar nada manualmente.
    Invoices.clearSelected();
    created.forEach(inv => Invoices.toggleSelected(inv.numero, true));
    switchView('facturas');
  }

  // ---------------- Cargar Data (independiente de facturas) ----------------
  function cargarData(){
    const staged = Invoices.getStaged();
    if(!staged || staged.length === 0){
      UI.toast('Primero carga un archivo Excel', 'err');
      return;
    }
    const desde = document.getElementById('periodoDesde').value;
    const hasta  = document.getElementById('periodoHasta').value;
    const count  = DataModule.importFromWeekly(staged, desde, hasta);
    if(count === 0){
      UI.toast('No se encontraron registros con balance distinto de cero', 'err');
      return;
    }
    UI.toast(`${count} registros cargados en Data correctamente`, 'ok');
  }

  // ---------------- Facturas / historial ----------------
  function populateClienteFilter(){
    const select = document.getElementById('filtroCliente');
    const clients = Storage.getClients().slice().sort((a,b)=>a.nombre.localeCompare(b.nombre));
    const current = select.value;
    select.innerHTML = `<option value="">Todos</option>` + clients.map(c=>`<option value="${c.id}">${Utils.escapeHtml(c.nombre)}</option>`).join('');
    select.value = current;
  }

  function readFilters(){
    Invoices.setFilters({
      cliente: document.getElementById('filtroCliente').value,
      numero: document.getElementById('filtroNumero').value,
      fechaDesde: document.getElementById('filtroFechaDesde').value,
      fechaHasta: document.getElementById('filtroFechaHasta').value,
      montoMin: document.getElementById('filtroMontoMin').value,
      montoMax: document.getElementById('filtroMontoMax').value,
      estado: document.getElementById('filtroEstado').value,
    });
  }

  function renderFacturasTable(){
    populateClienteFilter();
    readFilters();
    const list = Invoices.getFiltered();
    const tbody = document.querySelector('#tblFacturas tbody');
    if(list.length === 0){
      tbody.innerHTML = `<tr><td colspan="9"><div class="t-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 3h8l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/></svg>
        <div>No se encontraron facturas con estos filtros.</div></div></td></tr>`;
    } else {
      const selected = new Set(Invoices.getSelected());
      tbody.innerHTML = list.map(i => `
        <tr>
          <td><input type="checkbox" class="chk" ${selected.has(i.numero)?'checked':''} onchange="App.toggleSelectInvoice('${i.numero}', this.checked)"></td>
          <td><span class="tag-inv" style="cursor:pointer" onclick="App.viewInvoice('${i.numero}')">${i.numero}</span></td>
          <td>${Utils.escapeHtml(i.clienteNombre)}</td>
          <td>${Utils.fmtDate(i.fecha)}</td>
          <td class="r num">${i.tipo==='UD' ? '—' : Utils.fmtNum(i.montoOriginal)}</td>
          <td class="r num">${i.tipo==='UD' ? '—' : Utils.fmtNum(i.monto2)}</td>
          <td class="r num"><b>${Utils.fmtNum(i.total)}</b></td>
          <td>${UI.estadoPill(i.estado)}</td>
          <td>
            <div class="flex gap6">
              <button class="btn btn-ghost btn-icon btn-sm" title="Ver / imprimir" onclick="App.viewInvoice('${i.numero}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <button class="btn btn-ghost btn-icon btn-sm" title="Eliminar" onclick="App.confirmDeleteInvoice('${i.numero}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `).join('');
    }
    document.getElementById('selCount').textContent = Invoices.getSelected().length;
    document.getElementById('btnExportPdfBatch').disabled = Invoices.getSelected().length === 0;
  }

  function toggleSelectInvoice(numero, checked){
    Invoices.toggleSelected(numero, checked);
    document.getElementById('selCount').textContent = Invoices.getSelected().length;
    document.getElementById('btnExportPdfBatch').disabled = Invoices.getSelected().length === 0;
  }
  function toggleSelectAllInvoices(checked){
    const list = Invoices.getFiltered();
    list.forEach(i => Invoices.toggleSelected(i.numero, checked));
    renderFacturasTable();
  }
  function confirmDeleteInvoice(numero){
    UI.requirePin(() => {
      Invoices.remove(numero);
      renderFacturasTable();
      Dashboard.renderAll();
      UI.toast('Factura eliminada', 'ok');
    });
  }

  let currentInvoiceNumero = null;
  function viewInvoice(numero){
    const inv = Invoices.byNumero(numero);
    if(!inv) return;
    currentInvoiceNumero = numero;
    document.getElementById('mfNumero').textContent = inv.numero;
    document.getElementById('invoicePaper').innerHTML = Invoices.renderInvoiceHTML(inv);
    document.getElementById('mfEstadoSelect').value = inv.estado;
    UI.openModal('modalFactura');
  }

  // ---------------- Reportes ----------------
  function renderReportes(){
    const invoices = Storage.getInvoices();
    const montoTotal = invoices.reduce((s,i) => s + (i.montoOriginal||0), 0);
    const total2     = invoices.reduce((s,i) => s + (i.monto2||0), 0);
    const clientesSet = new Set(invoices.map(i => i.clienteId||i.clienteNombre).filter(Boolean));
    document.getElementById('repTotalFacturas').textContent = invoices.length;
    document.getElementById('repMontoTotal').textContent = Utils.fmtMoney(montoTotal);
    document.getElementById('repTotal2').textContent = Utils.fmtMoney(total2);
    document.getElementById('repClientes').textContent = clientesSet.size;
    const map = {};
    invoices.forEach(i => {
      if(!map[i.clienteNombre]) map[i.clienteNombre] = { count:0, original:0, dos:0, total:0 };
      map[i.clienteNombre].count++;
      map[i.clienteNombre].original += i.montoOriginal;
      map[i.clienteNombre].dos += i.monto2;
      map[i.clienteNombre].total += i.total;
    });
    const entries = Object.entries(map).sort((a,b)=>b[1].total-a[1].total);
    const tbody = document.querySelector('#tblRepClientes tbody');
    tbody.innerHTML = entries.length === 0
      ? `<tr><td colspan="5"><div class="t-empty">No hay datos todavía.</div></td></tr>`
      : entries.map(([name,v]) => `
        <tr>
          <td>${Utils.escapeHtml(name)}</td>
          <td class="c">${v.count}</td>
          <td class="r num">${Utils.fmtNum(v.original)}</td>
          <td class="r num">${Utils.fmtNum(v.dos)}</td>
          <td class="r num"><b>${Utils.fmtNum(v.total)}</b></td>
        </tr>`).join('');

    // ---- Historial de Recibos de Pago ----
    const pagos = Storage.getPagos().slice().reverse();
    const tbodyPagos = document.querySelector('#tblRepPagos tbody');
    tbodyPagos.innerHTML = pagos.length === 0
      ? `<tr><td colspan="5"><div class="t-empty">No hay recibos registrados todavía.</div></td></tr>`
      : pagos.map(p => `
        <tr>
          <td><b>${p.numero}</b></td>
          <td>${Utils.escapeHtml(p.consorcio||'—')}</td>
          <td>${Utils.fmtDate(p.fecha)}</td>
          <td class="r num"><b>${Utils.fmtMoney(p.total||0)}</b></td>
          <td class="c">${p.registros||0}</td>
        </tr>`).join('');

    // ---- Historial de Solicitudes de Pago ----
    const solicitudes = Storage.getSolicitudes().slice().reverse();
    const tbodySol = document.querySelector('#tblRepSolicitudes tbody');
    tbodySol.innerHTML = solicitudes.length === 0
      ? `<tr><td colspan="7"><div class="t-empty">No hay solicitudes generadas todavía.</div></td></tr>`
      : solicitudes.map(s => {
          const total = (s.items||[]).reduce((acc,i)=>acc+(Number(i.monto)||0),0);
          const estado = s.estado || 'Pendiente';
          const estadoPill = (estado === 'Pagada' || estado === 'Aplicada')
            ? `<span class="pill ok"><span class="pill-dot"></span>Pagada</span>`
            : estado === 'Parcialmente Pagada'
              ? `<span class="pill blue"><span class="pill-dot"></span>Parcialmente Pagada</span>`
              : `<span class="pill warn"><span class="pill-dot"></span>Pendiente</span>`;
          return `<tr>
            <td><b>${s.numero}</b></td>
            <td>${Utils.escapeHtml(s.corte||'—')}</td>
            <td>${Utils.fmtDate(s.fecha)}</td>
            <td>${estadoPill}</td>
            <td class="r num"><b>${Utils.fmtMoney(total)}</b></td>
            <td class="c">${(s.items||[]).length}</td>
            <td class="c">
              <button class="btn btn-ghost btn-icon btn-sm" title="Eliminar solicitud" onclick="App.confirmDeleteSolicitud('${s.numero}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/></svg>
              </button>
            </td>
          </tr>`;
        }).join('');
  }

  function confirmDeleteSolicitud(numero){
    UI.requirePin(() => {
      UI.confirm('Eliminar solicitud', `¿Eliminar la Solicitud de Pago No. ${numero}? Esta acción no se puede deshacer.`, () => {
        Storage.deleteSolicitud(numero);
        renderReportes();
        UI.toast('Solicitud eliminada', 'ok');
      });
    });
  }

  function _exportPagosExcel(){
    const pagos = Storage.getPagos();
    if(!pagos.length){ UI.toast('No hay recibos para exportar', 'err'); return; }
    const rows = pagos.map(p => ({
      'No.': p.numero,
      'Consorcio': p.consorcio||'',
      'Fecha': p.fecha||'',
      'Total Cobrado': p.total||0,
      'Registros': p.registros||0
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Recibos');
    XLSX.writeFile(wb, `Recibos_Pago_${Utils.todayISO()}.xlsx`);
    UI.toast('Excel de recibos descargado', 'ok');
  }

  function _exportSolicitudesExcel(){
    const sols = Storage.getSolicitudes();
    if(!sols.length){ UI.toast('No hay solicitudes para exportar', 'err'); return; }
    const rows = sols.map(s => ({
      'No.': s.numero,
      'Corte': s.corte||'',
      'Fecha': s.fecha||'',
      'Estado': s.estado||'',
      'Total': (s.items||[]).reduce((a,i)=>a+(Number(i.monto)||0),0),
      'Ítems': (s.items||[]).length
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Solicitudes');
    XLSX.writeFile(wb, `Solicitudes_Pago_${Utils.todayISO()}.xlsx`);
    UI.toast('Excel de solicitudes descargado', 'ok');
  }

  // ---------------- Configuración ----------------
  function loadConfigForm(){
    const s = Storage.getSettings();
    document.getElementById('cfgPorcentaje').value = s.porcentaje;
    document.getElementById('cfgDiasVenc').value = s.diasVencimiento;
    document.getElementById('cfgVendedor').value = s.vendedor;
    document.getElementById('cfgEntregadoPor').value = s.entregadoPor;
    document.getElementById('cfgProximoNumero').value = Storage.peekNextInvoiceNumber();
    document.getElementById('cfgAdminPin').value = s.adminPin || '1234';
  }
  function saveConfig(){
    const newPin = document.getElementById('cfgAdminPin').value.trim();
    Storage.saveSettings({
      porcentaje: Number(document.getElementById('cfgPorcentaje').value)||2,
      diasVencimiento: Number(document.getElementById('cfgDiasVenc').value)||30,
      vendedor: document.getElementById('cfgVendedor').value.trim(),
      entregadoPor: document.getElementById('cfgEntregadoPor').value.trim(),
      adminPin: newPin || '1234',
    });
    const manualNum = document.getElementById('cfgProximoNumero').value.trim();
    const m = manualNum.match(/(\d+)/);
    if(m) Storage.setCounter(parseInt(m[1],10)-1);
    UI.toast('Configuración guardada', 'ok');
  }

  // ---------------- Backup / restore / reset ----------------
  function backup(){
    const data = Storage.exportBackup();
    const blob = new Blob([JSON.stringify(data,null,2)], { type:'application/json' });
    Utils.download(`Respaldo_FacturasCompensacion_${Utils.todayISO()}.json`, blob);
    UI.toast('Respaldo descargado', 'ok');
  }
  function restore(file){
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const obj = JSON.parse(reader.result);
        Storage.importBackup(obj);
        UI.toast('Respaldo restaurado correctamente', 'ok');
        bootRenderAll();
      }catch(e){ UI.toast('Archivo de respaldo inválido', 'err'); }
    };
    reader.readAsText(file);
  }
  function resetAll(){
    UI.confirm('Borrar todos los datos', 'Esto eliminará todas las facturas, clientes (volverán al listado original) y configuración. Esta acción no se puede deshacer.', () => {
      Storage.resetAll();
      UI.toast('Datos restablecidos', 'ok');
      bootRenderAll();
    });
  }

  function bootRenderAll(){
    Dashboard.renderAll();
    Clients.render();
  }

  // ---------------- Wiring ----------------
  function bindGuardarCliente(){
    document.getElementById('btnGuardarCliente').addEventListener('click', bindGuardarClienteHandlerRef);
  }
  function bindGuardarClienteHandlerRef(){
    const saved = Clients.saveFromForm();
    if(saved && pendingVinculoTarget){
      Invoices.setStagedLink(pendingVinculoTarget, saved.id);
      Invoices.setStagedIncluded(pendingVinculoTarget, true);
      renderPreviewTable();
    }
    pendingVinculoTarget = null;
  }

  function wire(){
    // Nav — Configuración requiere PIN de administrador
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        if(btn.dataset.view === 'config'){
          UI.requirePin(() => switchView('config'));
        } else {
          switchView(btn.dataset.view);
        }
      });
    });
    document.querySelectorAll('[data-view]').forEach(el => {
      if(!el.classList.contains('nav-item')) el.addEventListener('click', () => switchView(el.dataset.view));
    });

    // Confirm modal
    document.getElementById('btnConfirmOk').addEventListener('click', UI.runConfirm);

    // ---- Cargar Excel ----
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault(); dropzone.classList.remove('drag');
      if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => { if(fileInput.files[0]) handleFile(fileInput.files[0]); });
    document.getElementById('btnClearFile').addEventListener('click', clearFile);
    document.getElementById('periodoDesde').addEventListener('change', () => { updateConceptoPreview(); renderPreviewTable(); });
    document.getElementById('periodoHasta').addEventListener('change', () => { updateConceptoPreview(); renderPreviewTable(); });
    document.getElementById('chkAll').addEventListener('change', e => { Invoices.setAllIncluded(e.target.checked); renderPreviewTable(); });
    document.getElementById('chkIncludeUD').addEventListener('change', e => { Invoices.setUDIncluded(e.target.checked); renderPreviewTable(); });
    document.getElementById('btnGenerar').addEventListener('click', generarFacturas);
    document.getElementById('btnCancelPreview').addEventListener('click', clearFile);

    // ---- Vincular modal ----
    document.getElementById('btnConfirmarVinculo').addEventListener('click', confirmVinculo);
    document.getElementById('btnCrearDesdeVincular').addEventListener('click', crearDesdeVincular);

    // ---- Facturas / historial ----
    document.getElementById('filtroCliente').addEventListener('change', renderFacturasTable);
    document.getElementById('filtroNumero').addEventListener('input', Utils.debounce(renderFacturasTable, 200));
    document.getElementById('filtroFechaDesde').addEventListener('change', renderFacturasTable);
    document.getElementById('filtroFechaHasta').addEventListener('change', renderFacturasTable);
    document.getElementById('filtroMontoMin').addEventListener('input', Utils.debounce(renderFacturasTable, 250));
    document.getElementById('filtroMontoMax').addEventListener('input', Utils.debounce(renderFacturasTable, 250));
    document.getElementById('filtroEstado').addEventListener('change', renderFacturasTable);
    document.getElementById('btnLimpiarFiltros').addEventListener('click', () => {
      ['filtroNumero','filtroFechaDesde','filtroFechaHasta','filtroMontoMin','filtroMontoMax'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('filtroCliente').value = '';
      document.getElementById('filtroEstado').value = '';
      Invoices.clearFilters();
      renderFacturasTable();
    });
    document.getElementById('chkAllFacturas').addEventListener('change', e => toggleSelectAllInvoices(e.target.checked));
    document.getElementById('btnExportExcelGeneral').addEventListener('click', Exporters.exportGeneralExcel);
    document.getElementById('btnExportPdfGeneral').addEventListener('click', Exporters.exportGeneralPDF);
    document.getElementById('btnExportPdfBatch').addEventListener('click', () => Exporters.exportBatchPDF(Invoices.getSelected()));
    document.getElementById('btnExportZipTodas').addEventListener('click', () => {
      const selected = Invoices.getSelected();
      const targets = selected.length ? selected : Invoices.getFiltered().map(i => i.numero);
      Exporters.exportZipIndividual(targets);
    });

    // ---- Modal factura ----
    document.getElementById('btnImprimir').addEventListener('click', () => window.print());
    document.getElementById('btnDescargarPdf').addEventListener('click', () => { if(currentInvoiceNumero) Exporters.exportSinglePDF(currentInvoiceNumero); });
    document.getElementById('mfEstadoSelect').addEventListener('change', e => {
      if(currentInvoiceNumero){ Invoices.setEstado(currentInvoiceNumero, e.target.value); renderFacturasTable(); Dashboard.renderAll(); UI.toast('Estado actualizado', 'ok'); }
    });

    // ---- Clientes ----
    document.getElementById('btnNuevoCliente').addEventListener('click', Clients.openNew);
    bindGuardarCliente();
    document.getElementById('buscarCliente').addEventListener('input', Utils.debounce(e => Clients.setSearch(e.target.value), 150));

    // ---- Reportes ----
    document.getElementById('btnRepExcel').addEventListener('click', () => { Invoices.clearFilters(); Exporters.exportGeneralExcel(); });
    document.getElementById('btnRepPdf').addEventListener('click', () => { Invoices.clearFilters(); Exporters.exportGeneralPDF(); });
    document.getElementById('btnRepClientesExcel').addEventListener('click', Exporters.exportClientesExcel);
    document.getElementById('btnRepPagosExcel').addEventListener('click', _exportPagosExcel);
    document.getElementById('btnRepSolicitudesExcel').addEventListener('click', _exportSolicitudesExcel);

    // ---- Configuración ----
    document.getElementById('btnGuardarConfig').addEventListener('click', saveConfig);
    document.getElementById('btnBackup').addEventListener('click', backup);
    document.getElementById('btnRestoreBtn').addEventListener('click', () => document.getElementById('btnRestore').click());
    document.getElementById('btnRestore').addEventListener('change', e => { if(e.target.files[0]) restore(e.target.files[0]); });
    document.getElementById('btnReset').addEventListener('click', resetAll);
    const btnPublish = document.getElementById('btnPublishAll');
    if(btnPublish) btnPublish.addEventListener('click', publishAll);

    // ---- Modal overlay click-to-close ----
    document.querySelectorAll('.modal-overlay').forEach(ov => {
      ov.addEventListener('click', e => { if(e.target === ov) ov.classList.remove('open'); });
    });
  }

  async function init(){
    Storage.init();
    // Trae la data compartida de la nube antes de renderizar (si está disponible)
    if(window.Sync){
      try{ await Sync.pull(); }catch(e){ console.warn('Sync.pull falló, se usa data local', e); }
    }
    wire();
    Dashboard.renderAll();
    // Escucha cambios de otros usuarios en tiempo real
    if(window.Sync){ Sync.subscribeRealtime(() => syncRerender()); }
  }

  function clearPendingVinculo(){ pendingVinculoTarget = null; }

  return {
    init, switchView, viewInvoice, openVincular, confirmVinculo, crearDesdeVincular,
    toggleStagedRow, toggleSelectInvoice, confirmDeleteInvoice, clearPendingVinculo,
    cargarData, publishAll, confirmDeleteSolicitud
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
