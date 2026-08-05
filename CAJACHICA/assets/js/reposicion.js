/* ============================================================
   Reposición — Caja Chica de fondo fijo: período, desembolsos con
   balance corrido, arqueo de caja e historial de reposiciones.
   Reemplaza el antiguo flujo de Movimientos/Reposiciones.
   ============================================================ */
const Reposicion = (() => {

  const DENOMS = [1,5,10,25,50,100,200,500,1000,2000];
  const FONDO_FIJO = 20000; // fondo fijo de Caja Chica, no editable por ahora

  let state = null;
  let _dirty = false;
  let _wired = false;

  function _padNo(n){ return String(n).padStart(5,'0'); }

  function _defaultState(){
    return {
      fechaSolicitud: Utils.todayISO(),
      fechaDesde: Utils.todayISO(),
      fechaHasta: Utils.todayISO(),
      fondo: FONDO_FIJO,
      repAnterior: 0,
      nextNo: 1,
      rows: [],
      denoms: Object.fromEntries(DENOMS.map(d => [d, 0])),
      cheque: 0,
      nota: ''
    };
  }

  function currentUserLabel(){
    try{
      const u = window.Auth && Auth.getUser && Auth.getUser();
      return (u && (u.name || u.email)) || 'Usuario';
    }catch(e){ return 'Usuario'; }
  }

  function _addRowSilent(nula){
    state.rows.push({ no:_padNo(state.nextNo), fecha:'', beneficiario:'', descripcion: nula ? 'NULO' : '', monto:'' });
    state.nextNo += 1;
  }

  function _loadState(){
    const stored = Storage.getPeriodoActual();
    state = (stored && typeof stored === 'object') ? stored : _defaultState();
    if(!Array.isArray(state.rows)) state.rows = [];
    if(!state.denoms) state.denoms = Object.fromEntries(DENOMS.map(d => [d, 0]));
    if(!state.nextNo) state.nextNo = 1;
    if(state.rows.length === 0) _addRowSilent();
  }

  // Sin controles de fecha en pantalla: el período siempre corre desde el
  // cierre anterior (fechaDesde) hasta el momento actual (fechaHasta = hoy).
  function _touchDates(){
    state.fechaHasta = Utils.todayISO();
    state.fechaSolicitud = Utils.todayISO();
    if(!state.fechaDesde) state.fechaDesde = Utils.todayISO();
  }

  /* ---------------- Render ---------------- */
  function render(){
    if(!_dirty || !state) _loadState();
    _touchDates();
    state.fondo = FONDO_FIJO; // fijo por ahora, no editable
    _wireOnce();
    startClock();
    _applyHeaderToDOM();
    renderRows();
    renderDenoms();
    renderHistory();
  }

  function _wireOnce(){
    if(_wired) return;
    _wired = true;
    document.getElementById('ccCheque')?.addEventListener('input', () => { syncHeaderFromDOM(); _dirty = true; renderDiff(); });
    document.getElementById('ccNota')?.addEventListener('input', () => { syncHeaderFromDOM(); _dirty = true; });
  }

  function startClock(){
    const el = document.getElementById('ccLiveClock');
    if(!el || el._ccClockStarted) return;
    el._ccClockStarted = true;
    const tick = () => {
      const now = new Date();
      const dateStr = now.toLocaleDateString('es-DO', { weekday:'long', day:'numeric', month:'long' });
      const timeStr = now.toLocaleTimeString('es-DO', { hour:'2-digit', minute:'2-digit' });
      el.innerHTML = `<div class="lc-date">${dateStr}</div><div class="lc-time">${timeStr}</div>`;
    };
    tick();
    setInterval(tick, 30000);
  }

  function syncHeaderFromDOM(){
    state.fondo = Number(document.getElementById('ccFondo').value) || 0;
    state.cheque = Number(document.getElementById('ccCheque').value) || 0;
    state.nota = document.getElementById('ccNota').value;
  }

  function _applyHeaderToDOM(){
    document.getElementById('ccFondo').value = state.fondo;
    document.getElementById('ccCheque').value = state.cheque || 0;
    document.getElementById('ccNota').value = state.nota || '';
  }

  /* ---------------- Desembolsos ---------------- */
  function addRow(nula){
    _addRowSilent(nula);
    _dirty = true;
    renderRows();
    setTimeout(() => {
      const rows = document.querySelectorAll('#ccRowsBody tr');
      const last = rows[rows.length - 1];
      last?.querySelector('td:nth-child(3) input')?.focus();
    }, 30);
  }

  function deleteRow(idx){
    state.rows.splice(idx, 1);
    _dirty = true;
    renderRows();
  }

  function updateRow(idx, field, value){
    state.rows[idx][field] = value;
    _dirty = true;
    if(field === 'monto') renderRows();
  }

  function renderRows(){
    const body = document.getElementById('ccRowsBody');
    if(!body) return;
    body.innerHTML = '';
    let running = Number(document.getElementById('ccFondo').value) || 0;
    let totalFacturas = 0;

    state.rows.forEach((row, idx) => {
      const monto = parseFloat(row.monto);
      if(!isNaN(monto)){ running -= monto; totalFacturas += monto; }
      const tr = document.createElement('tr');
      tr.className = 'perf';
      tr.innerHTML = `
        <td class="row-no"><input value="${Utils.escapeHtml(row.no)}" onchange="Reposicion.updateRow(${idx},'no',this.value)"></td>
        <td class="row-fecha"><input type="date" value="${row.fecha}" onchange="Reposicion.updateRow(${idx},'fecha',this.value)"></td>
        <td><input list="dlEmpleados" value="${Utils.escapeHtml(row.beneficiario)}" placeholder="Nombre" onchange="Reposicion.updateRow(${idx},'beneficiario',this.value)"></td>
        <td><input value="${Utils.escapeHtml(row.descripcion)}" placeholder="Descripción del gasto" onchange="Reposicion.updateRow(${idx},'descripcion',this.value)"></td>
        <td class="num row-monto"><input type="number" step="0.01" value="${row.monto}" placeholder="0.00" onchange="Reposicion.updateRow(${idx},'monto',this.value)"></td>
        <td class="balance-cell row-balance ${running < 0 ? 'balance-neg' : 'balance-pos'}">${Utils.fmtMoney(running)}</td>
        <td class="center"><button class="del-btn" onclick="Reposicion.deleteRow(${idx})" title="Eliminar fila">✕</button></td>`;
      body.appendChild(tr);
    });

    document.getElementById('ccFacturasView').value = totalFacturas.toFixed(2);
    document.getElementById('ccSumFacturas').textContent = Utils.fmtMoney(totalFacturas);

    const disponible = (Number(document.getElementById('ccFondo').value) || 0) - totalFacturas;
    document.getElementById('ccDisponibleView').value = disponible.toFixed(2);
    document.getElementById('ccSumDisponible').textContent = Utils.fmtMoney(disponible);

    const repAnt = Number(state.repAnterior) || 0;
    document.getElementById('ccSumRepAnterior').textContent = Utils.fmtMoney(repAnt);
    document.getElementById('ccSumPorReponer').textContent = Utils.fmtMoney(totalFacturas - repAnt);

    renderDiff();
  }

  /* ---------------- Arqueo ---------------- */
  function renderDenoms(){
    const body = document.getElementById('ccDenomsBody');
    if(!body) return;
    body.innerHTML = '';
    let grand = 0;
    DENOMS.forEach(d => {
      const qty = Number(state.denoms[d]) || 0;
      const total = qty * d;
      grand += total;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="den">${d.toLocaleString('es-DO',{minimumFractionDigits:2})}</td>
        <td><input type="number" min="0" step="1" value="${state.denoms[d] || ''}" placeholder="0" oninput="Reposicion.updateDenom(${d}, this.value)"></td>
        <td class="tot">${total > 0 ? Utils.fmtMoney(total) : '-'}</td>`;
      body.appendChild(tr);
    });
    document.getElementById('ccDenomsGrand').textContent = Utils.fmtMoney(grand);
    renderDiff();
  }

  function updateDenom(d, value){
    state.denoms[d] = value;
    _dirty = true;
    renderDenoms();
  }

  function renderDiff(){
    const denomsTotal = DENOMS.reduce((sum,d) => sum + (Number(state.denoms[d])||0) * d, 0);
    const cheque = Number(document.getElementById('ccCheque').value) || 0;
    const disponible = Number(document.getElementById('ccDisponibleView').value) || 0;
    const diff = (denomsTotal + cheque) - disponible;

    const box = document.getElementById('ccDiffBox');
    document.getElementById('ccDiffValue').textContent = Utils.fmtMoney(diff);
    box.className = 'diff-box ' + (Math.abs(diff) < 0.01 ? 'diff-ok' : 'diff-bad');
  }

  /* ---------------- Guardar / Nueva reposición ---------------- */
  function guardar(){
    syncHeaderFromDOM();
    _touchDates();
    Storage.savePeriodoActual(state);
    _dirty = false;
    UI.toast('Reposición guardada', 'ok');
  }

  function iniciarNuevaReposicion(){
    syncHeaderFromDOM();
    _touchDates();
    const disponible = Number(document.getElementById('ccDisponibleView').value) || 0;
    const totalFacturas = Number(document.getElementById('ccFacturasView').value) || 0;

    UI.confirm('Iniciar nueva reposición',
      `Se archivará el período ${Utils.fmtDate(state.fechaDesde)} → ${Utils.fmtDate(state.fechaHasta)} ` +
      `(desembolsado: ${Utils.fmtMoney(totalFacturas)}, disponible: ${Utils.fmtMoney(disponible)}) ` +
      `y se abrirá una nueva reposición con el fondo restablecido a ${Utils.fmtMoney(state.fondo)}. ¿Continuar?`,
      () => {
        const archive = {
          id: Utils.uid('rep'),
          fechaSolicitud: state.fechaSolicitud,
          fechaDesde: state.fechaDesde,
          fechaHasta: state.fechaHasta,
          fondo: state.fondo,
          repAnterior: state.repAnterior,
          rows: state.rows,
          totalFacturas, disponible,
          denoms: state.denoms,
          cheque: state.cheque,
          nota: state.nota,
          archivadoPor: currentUserLabel(),
          archivadoEn: new Date().toISOString()
        };
        Storage.addHistorialReposicion(archive);

        state.fechaDesde = state.fechaHasta || Utils.todayISO();
        state.fechaHasta = Utils.todayISO();
        state.fechaSolicitud = Utils.todayISO();
        state.repAnterior = totalFacturas;
        state.rows = [];
        state.denoms = Object.fromEntries(DENOMS.map(d => [d, 0]));
        state.cheque = 0;
        state.nota = '';
        _addRowSilent();

        Storage.savePeriodoActual(state);
        _dirty = false;
        render();
        UI.toast('Nueva reposición iniciada', 'ok');
      });
  }

  function renderHistory(){
    const host = document.getElementById('ccHistoryList');
    if(!host) return;
    const list = Storage.getHistorialReposiciones().slice().sort((a,b) => (b.fechaHasta||'').localeCompare(a.fechaHasta||''));
    if(list.length === 0){
      host.innerHTML = '<div class="empty-hint">Aún no hay reposiciones archivadas.</div>';
      return;
    }
    host.innerHTML = list.map(it => `
      <div class="history-item">
        <div>
          <div>${Utils.fmtDate(it.fechaDesde)} → ${Utils.fmtDate(it.fechaHasta)}</div>
          <div class="h-meta">Fondo ${Utils.fmtMoney(it.fondo)} · Disponible final ${Utils.fmtMoney(it.disponible)}</div>
        </div>
        <div class="h-amount">${Utils.fmtMoney(it.totalFacturas)}</div>
      </div>`).join('');
  }

  function imprimir(){ window.print(); }

  return {
    render, addRow, deleteRow, updateRow, updateDenom,
    guardar, iniciarNuevaReposicion, imprimir
  };
})();
window.Reposicion = Reposicion;
