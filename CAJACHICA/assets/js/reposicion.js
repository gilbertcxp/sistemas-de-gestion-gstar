/* ============================================================
   Reposición — Caja Chica de fondo fijo: período, desembolsos con
   balance corrido, arqueo de caja e historial de reposiciones.
   Reemplaza el antiguo flujo de Movimientos/Reposiciones.
   ============================================================ */
const Reposicion = (() => {

  const DENOMS = [1,5,10,25,50,100,200,500,1000,2000];
  const FONDO_FIJO_STO_DGO = 20000; // fondo fijo de Caja Chica, no editable por ahora
  const FONDO_FIJO_STGO = 30000;
  const LIMITE_AUTORIZACION = 2000;
  const PRIMER_NO_STO_DGO = 264;

  let state = null;
  let _dirty = false;
  let _wired = false;
  let _selectedPendingIds = new Set();

  function _padNo(n){ return String(n).padStart(5,'0'); }
  function _fondoFijo(){
    return Storage.getCaja && Storage.getCaja() === 'stgo' ? FONDO_FIJO_STGO : FONDO_FIJO_STO_DGO;
  }
  function _minNextNo(){
    return Storage.getCaja && Storage.getCaja() === 'stgo' ? 1 : PRIMER_NO_STO_DGO;
  }
  function _parseNo(no){
    const match = String(no || '').match(/\d+/);
    return match ? parseInt(match[0], 10) || 0 : 0;
  }
  function _ensureNextNo(){
    const maxNo = (state.rows || []).reduce((max, row) => Math.max(max, _parseNo(row.no)), 0);
    state.nextNo = Math.max(Number(state.nextNo) || 0, _minNextNo(), maxNo + 1);
  }

  function _defaultState(){
    return {
      fechaSolicitud: Utils.todayISO(),
      fechaDesde: Utils.todayISO(),
      fechaHasta: Utils.todayISO(),
      fondo: _fondoFijo(),
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

  function _lockedCajaId(){
    try{
      const u = window.Auth && Auth.getUser && Auth.getUser();
      return u && (u.cajaChicaId === 'stgo' || u.cajaChicaId === 'sto_dgo') ? u.cajaChicaId : null;
    }catch(e){ return null; }
  }

  function _activeCajaId(){
    return Storage.getCaja && Storage.getCaja() === 'stgo' ? 'stgo' : 'sto_dgo';
  }

  function _addRowSilent(nula){
    _ensureNextNo();
    state.rows.push({
      // Fecha precargada con hoy por defecto — el campo sigue siendo editable
      // (input type="date"), el usuario puede cambiarla si el gasto fue otro día.
      id: Utils.uid('des'), no:_padNo(state.nextNo), fecha: Utils.todayISO(), beneficiario:'',
      descripcion: nula ? 'NULO' : '', monto:'', comprobante:'', observaciones:'', estado:'Pendiente'
    });
    state.nextNo += 1;
  }

  function _loadState(){
    const stored = Storage.getPeriodoActual();
    const hasStoredState = stored && typeof stored === 'object';
    state = hasStoredState ? stored : _defaultState();
    if(!Array.isArray(state.rows)) state.rows = [];
    if(!state.denoms) state.denoms = Object.fromEntries(DENOMS.map(d => [d, 0]));
    if(!state.nextNo) state.nextNo = _minNextNo();
    state.rows.forEach(row => {
      if(!row.id) row.id = Utils.uid('des');
      if(!row.estado) row.estado = row.repuesto ? 'Repuesto' : 'Pendiente';
      if(row.comprobante == null) row.comprobante = '';
      if(row.observaciones == null) row.observaciones = '';
      _syncAuthorizationState(row);
    });
    _ensureNextNo();
    if(state.rows.length === 0 && !hasStoredState) _addRowSilent();
  }

  function _isRepuesto(row){ return String(row.estado || '').toLowerCase() === 'repuesto' || row.repuesto === true; }
  function _authorizedForAmount(row){
    return row.autorizado === true && Math.abs((Number(row.montoAutorizado)||0) - (Number(row.monto)||0)) < 0.01;
  }
  function _syncAuthorizationState(row){
    const monto = Number(row.monto) || 0;
    if(_isRepuesto(row)) return;
    if(monto > LIMITE_AUTORIZACION){
      row.requiereAutorizacion = true;
      if(!_authorizedForAmount(row)){
        row.autorizado = false;
        row.autorizadoPor = '';
        row.autorizadoEn = '';
        row.estado = 'Pendiente autorizacion';
      }else if(row.estado === 'Pendiente autorizacion'){
        row.estado = 'Pendiente';
      }
    }else{
      row.requiereAutorizacion = false;
      row.autorizado = false;
      row.montoAutorizado = 0;
      row.autorizadoPor = '';
      row.autorizadoEn = '';
      if(row.estado === 'Pendiente autorizacion') row.estado = 'Pendiente';
    }
  }
  function _isAuthPending(row){
    _syncAuthorizationState(row);
    return !_isRepuesto(row) && Number(row.monto) > LIMITE_AUTORIZACION && !_authorizedForAmount(row);
  }
  function _pendingRows(){
    return state.rows.filter(row => !_isRepuesto(row) && !_isAuthPending(row) && Number(row.monto) > 0);
  }
  function _calcTotals(){
    let totalFacturas = 0;
    let totalRepuesto = 0;
    (state.rows || []).forEach(row => {
      const monto = parseFloat(row.monto);
      if(!isNaN(monto) && !_isAuthPending(row)){
        totalFacturas += monto;
        if(_isRepuesto(row)) totalRepuesto += monto;
      }
    });
    const totalPorReponer = totalFacturas - totalRepuesto;
    const disponible = (Number(state.fondo)||0) - totalPorReponer;
    const denomsTotal = DENOMS.reduce((sum,d) => sum + (Number(state.denoms[d])||0) * d, 0);
    const cheque = Number(state.cheque) || 0;
    return {
      totalFacturas,
      totalRepuesto,
      totalPorReponer,
      disponible,
      denomsTotal,
      cheque,
      arqueoTotal: denomsTotal + cheque,
      diferencia: (denomsTotal + cheque) - disponible
    };
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
    state.fondo = _fondoFijo(); // fijo por caja, no editable
    const cajaLabel = Storage.getCaja && Storage.getCaja() === 'stgo'
      ? 'Caja Chica Stgo · Reposición'
      : 'Caja Chica Sto. Dgo · Reposición';
    const cajaEl = document.getElementById('ccCajaLabel');
    if(cajaEl) cajaEl.textContent = cajaLabel;
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

  function startClockFor(id){
    const el = document.getElementById(id);
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

  function startClock(){
    startClockFor('ccLiveClock');
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
    _syncAuthorizationState(state.rows[idx]);
    if(field === 'no') _ensureNextNo();
    _dirty = true;
    if(field === 'monto') renderRows();
  }

  function autorizarRow(idx){
    const row = state.rows[idx];
    if(!row) return;
    if(Number(row.monto) <= LIMITE_AUTORIZACION){
      UI.toast('Este desembolso no requiere autorizacion', 'ok');
      return;
    }
    UI.requirePin(() => {
      row.requiereAutorizacion = true;
      row.autorizado = true;
      row.montoAutorizado = Number(row.monto) || 0;
      row.autorizadoPor = currentUserLabel();
      row.autorizadoEn = new Date().toISOString();
      row.estado = 'Pendiente';
      Storage.savePeriodoActual(state);
      _dirty = false;
      renderRows();
      UI.toast('Desembolso autorizado', 'ok');
    });
  }

  function renderRows(){
    const body = document.getElementById('ccRowsBody');
    if(!body) return;
    body.innerHTML = '';
    let running = Number(document.getElementById('ccFondo').value) || 0;
    let totalFacturas = 0;
    let totalRepuesto = 0;

    state.rows.forEach((row, idx) => {
      const monto = parseFloat(row.monto);
      const authPending = _isAuthPending(row);
      const cuenta = !authPending;
      if(!isNaN(monto) && cuenta){
        totalFacturas += monto;
        if(_isRepuesto(row)) totalRepuesto += monto;
        else running -= monto;
      }
      const statusClass = _isRepuesto(row) ? 'status-repuesto' : authPending ? 'status-autorizacion' : 'status-pendiente';
      const statusText = _isRepuesto(row) ? 'Repuesto' : authPending ? 'Pendiente' : 'Para reposicion';
      const tr = document.createElement('tr');
      tr.className = 'perf' + (authPending ? ' auth-pending-row' : '');
      tr.innerHTML = `
        <td class="row-no"><input value="${Utils.escapeHtml(row.no)}" onchange="Reposicion.updateRow(${idx},'no',this.value)"></td>
        <td class="row-fecha"><input type="date" value="${row.fecha}" onchange="Reposicion.updateRow(${idx},'fecha',this.value)"></td>
        <td><input list="dlEmpleados" value="${Utils.escapeHtml(row.beneficiario)}" placeholder="Nombre" onchange="Reposicion.updateRow(${idx},'beneficiario',this.value)"></td>
        <td><input value="${Utils.escapeHtml(row.descripcion)}" placeholder="Descripción del gasto" onchange="Reposicion.updateRow(${idx},'descripcion',this.value)"></td>
        <td class="num row-monto"><input type="number" step="0.01" value="${row.monto}" placeholder="0.00" onchange="Reposicion.updateRow(${idx},'monto',this.value)"></td>
        <td><span class="status-pill ${statusClass}">${statusText}</span></td>
        <td class="balance-cell row-balance ${running < 0 ? 'balance-neg' : 'balance-pos'}">${Utils.fmtMoney(running)}</td>
        <td class="center"><button class="del-btn" onclick="Reposicion.deleteRow(${idx})" title="Eliminar fila">✕</button></td>`;
      if(authPending){
        const actionCell = tr.querySelector('td.center');
        if(actionCell) actionCell.insertAdjacentHTML('afterbegin', `<button class="auth-btn" onclick="Reposicion.autorizarRow(${idx})">Autorizar</button>`);
      }
      body.appendChild(tr);
    });

    const pendientesAut = state.rows.filter(row => _isAuthPending(row));
    const authNotice = document.getElementById('ccAuthNotice');
    if(authNotice){
      authNotice.textContent = pendientesAut.length
        ? `${pendientesAut.length} desembolso(s) sobre RD$ 2,000.00 pendiente(s) de autorizacion. No afectan totales ni reposicion.`
        : '';
    }

    document.getElementById('ccFacturasView').value = totalFacturas.toFixed(2);
    document.getElementById('ccSumFacturas').textContent = Utils.fmtMoney(totalFacturas);

    const pendiente = totalFacturas - totalRepuesto;
    const disponible = (Number(document.getElementById('ccFondo').value) || 0) - pendiente;
    document.getElementById('ccDisponibleView').value = disponible.toFixed(2);
    document.getElementById('ccSumDisponible').textContent = Utils.fmtMoney(disponible);

    document.getElementById('ccSumRepAnterior').textContent = Utils.fmtMoney(totalRepuesto);
    document.getElementById('ccSumPorReponer').textContent = Utils.fmtMoney(pendiente);

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

  function renderArqueoTotals(){
    if(!state) return;
    const t = _calcTotals();
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if(el) el.textContent = value;
    };
    const setValue = (id, value) => {
      const el = document.getElementById(id);
      if(!el) return;
      if('value' in el) el.value = value;
      else el.textContent = value;
    };
    setValue('ccArqFondo', Number(state.fondo || 0).toFixed(2));
    setValue('ccArqFacturas', t.totalFacturas.toFixed(2));
    setValue('ccArqDisponible', t.disponible.toFixed(2));
    setText('ccArqTotal', Utils.fmtMoney(t.arqueoTotal));
    setText('ccArqDiffValue', Utils.fmtMoney(t.diferencia));
    const diffBox = document.getElementById('ccArqDiffBox');
    if(diffBox) diffBox.className = 'diff-box ' + (Math.abs(t.diferencia) < 0.01 ? 'diff-ok' : 'diff-bad');
    DENOMS.forEach(d => {
      const total = (Number(state.denoms[d]) || 0) * d;
      setText(`ccArqDenomTotal-${d}`, total > 0 ? Utils.fmtMoney(total) : '-');
    });
  }

  function renderArqueoView(){
    if(!_dirty || !state) _loadState();
    _touchDates();
    state.fondo = _fondoFijo();

    const cajaActual = _activeCajaId();
    const cajaLabel = cajaActual === 'stgo'
      ? 'Caja Chica Stgo'
      : 'Caja Chica Sto. Dgo';
    const sub = document.getElementById('ccArqCajaSub');
    if(sub) sub.textContent = `${cajaLabel} - formato de arqueo`;
    const label = document.getElementById('ccArqCajaLabel');
    if(label) label.textContent = `${cajaLabel} - Arqueo`;
    const select = document.getElementById('ccArqCajaSelect');
    if(select){
      const locked = _lockedCajaId();
      select.value = locked || cajaActual;
      select.disabled = !!locked;
    }
    startClockFor('ccArqLiveClock');

    const body = document.getElementById('ccArqDenomsBody');
    if(body){
      body.innerHTML = DENOMS.map(d => `
        <tr>
          <td class="den">${d.toLocaleString('es-DO',{minimumFractionDigits:2})}</td>
          <td><input type="number" min="0" step="1" value="${state.denoms[d] || ''}" placeholder="0" oninput="Reposicion.updateArqueoDenom(${d}, this.value)"></td>
          <td class="tot" id="ccArqDenomTotal-${d}">-</td>
        </tr>`).join('');
    }
    const cheque = document.getElementById('ccArqCheque');
    if(cheque) cheque.value = state.cheque || '';
    const nota = document.getElementById('ccArqNota');
    if(nota) nota.value = state.nota || '';
    renderArqueoTotals();
  }

  function cambiarCajaArqueo(caja){
    const locked = _lockedCajaId();
    const cajaDestino = locked || (caja === 'stgo' ? 'stgo' : 'sto_dgo');
    if(state && _dirty){
      _touchDates();
      state.fondo = _fondoFijo();
      Storage.savePeriodoActual(state);
    }
    Storage.setCaja(cajaDestino);
    state = null;
    _dirty = false;
    renderArqueoView();
  }

  function updateArqueoDenom(d, value){
    if(!state) _loadState();
    state.denoms[d] = value;
    _dirty = true;
    renderArqueoTotals();
  }

  function updateArqueoCheque(value){
    if(!state) _loadState();
    state.cheque = Number(value) || 0;
    _dirty = true;
    renderArqueoTotals();
  }

  function updateArqueoNota(value){
    if(!state) _loadState();
    state.nota = value || '';
    _dirty = true;
  }

  function guardarArqueo(){
    if(!state) _loadState();
    _touchDates();
    state.fondo = _fondoFijo();
    Storage.savePeriodoActual(state);
    _dirty = false;
    UI.toast('Arqueo guardado', 'ok');
  }

  /* ---------------- Guardar / Nueva reposición ---------------- */
  function guardar(){
    syncHeaderFromDOM();
    _touchDates();
    state.rows.forEach(_syncAuthorizationState);
    Storage.savePeriodoActual(state);
    _dirty = false;
    UI.toast('Reposición guardada', 'ok');
  }

  function iniciarNuevaReposicion(){
    syncHeaderFromDOM();
    _touchDates();
    const pending = _pendingRows();
    if(pending.length === 0){
      const pendientesAut = state.rows.filter(row => _isAuthPending(row)).length;
      if(pendientesAut > 0){
        UI.toast('Hay desembolsos pendientes de autorizacion', 'err');
        return;
      }
      UI.toast('No hay desembolsos pendientes de reposición', 'err');
      return;
    }
    _selectedPendingIds = new Set();
    renderPendingChecklist();
    UI.openModal('modalReposicion');
  }

  function renderPendingChecklist(){
    const body = document.getElementById('ccPendingBody');
    if(!body) return;
    const pending = _pendingRows();
    body.innerHTML = pending.map(row => `
      <tr>
        <td><input type="checkbox" class="chk" ${_selectedPendingIds.has(row.id) ? 'checked' : ''} onchange="Reposicion.togglePending('${Utils.jsAttr(row.id)}', this.checked)"></td>
        <td>${Utils.fmtDate(row.fecha)}</td>
        <td>${Utils.escapeHtml(row.beneficiario || '—')}</td>
        <td>${Utils.escapeHtml(row.descripcion || '—')}</td>
        <td class="num">${Utils.fmtMoney(row.monto)}</td>
        <td>${Utils.escapeHtml(row.comprobante || '—')}</td>
        <td><span class="status-pill status-pendiente">Para reposicion</span></td>
      </tr>`).join('');
    if(pending.length === 0){
      body.innerHTML = '<tr><td colspan="7" class="empty-hint">No hay desembolsos pendientes de reposición.</td></tr>';
    }
    updatePendingSummary();
  }

  function togglePending(id, checked){
    if(checked) _selectedPendingIds.add(id);
    else _selectedPendingIds.delete(id);
    updatePendingSummary();
  }

  function updatePendingSummary(){
    const selected = state.rows.filter(row => _selectedPendingIds.has(row.id));
    const total = selected.reduce((sum,row) => sum + (Number(row.monto)||0), 0);
    document.getElementById('ccSelectedCount').textContent = selected.length;
    document.getElementById('ccSelectedTotal').textContent = Utils.fmtMoney(total);
  }

  function confirmarReposicion(){
    syncHeaderFromDOM();
    const selected = state.rows.filter(row => _selectedPendingIds.has(row.id) && !_isRepuesto(row) && !_isAuthPending(row) && Number(row.monto) > 0);
    if(selected.length === 0){
      UI.toast('Selecciona al menos un desembolso', 'err');
      return;
    }
    const fechaReposicion = Utils.todayISO();
    const reposicionId = Utils.uid('rep');
    const codigo = `RC-${fechaReposicion.replace(/-/g,'')}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
    const montoTotal = selected.reduce((sum,row) => sum + (Number(row.monto)||0), 0);
    const detalle = selected.map(row => ({
      ...row,
      observaciones: row.observaciones || state.nota || '',
      estado: 'Repuesto',
      reposicionId
    }));
    const archive = {
      id: reposicionId,
      codigo,
      fechaReposicion,
      fechaDesde: state.fechaDesde,
      fechaHasta: state.fechaHasta,
      usuario: currentUserLabel(),
      estado: 'Confirmada',
      cantidadDesembolsos: detalle.length,
      montoTotal,
      fondo: state.fondo,
      nota: state.nota,
      desembolsos: detalle
    };
    const selectedIds = new Set(selected.map(row => row.id));
    state.rows = state.rows.filter(row => !selectedIds.has(row.id));
    Storage.addHistorialReposicion(archive);
    Storage.savePeriodoActual(state);
    _selectedPendingIds = new Set();
    UI.closeModal('modalReposicion');
    _dirty = false;
    render();
    UI.toast(`Reposición ${codigo} confirmada`, 'ok');
  }

  function renderHistory(){
    const host = document.getElementById('ccReposicionesList') || document.getElementById('ccHistoryList');
    if(!host) return;
    const list = Storage.getHistorialReposiciones().slice().sort((a,b) => (b.fechaReposicion||b.fechaHasta||'').localeCompare(a.fechaReposicion||a.fechaHasta||''));
    if(list.length === 0){
      host.innerHTML = '<div class="empty-hint">Aún no hay reposiciones archivadas.</div>';
      return;
    }
    host.innerHTML = list.map(it => `
      <div class="history-item">
        <div>
          <div><b>${Utils.escapeHtml(it.codigo || it.id || 'Reposición')}</b> · ${Utils.fmtDate(it.fechaReposicion || it.fechaHasta)}</div>
          <div class="h-meta">${Utils.escapeHtml(it.usuario || it.archivadoPor || 'Usuario')} · ${it.cantidadDesembolsos || (it.rows || []).filter(r => Number(r.monto) > 0).length} desembolso(s) · <span class="status-pill status-repuesto">${Utils.escapeHtml(it.estado || 'Confirmada')}</span></div>
        </div>
        <div><span class="h-amount">${Utils.fmtMoney(it.montoTotal != null ? it.montoTotal : it.totalFacturas)}</span><button class="btn btn-ghost" onclick="Reposicion.verDetalle('${Utils.jsAttr(it.id)}')">Ver detalle</button></div>
      </div>`).join('');
  }

  function renderHistoryView(){ renderHistory(); }

  // Borra el historial de reposiciones archivadas de la caja activa (Sto. Dgo
  // o Stgo, según cuál se esté viendo). No toca el período en curso ni la
  // otra caja. Requiere PIN de administrador por ser irreversible.
  function confirmarBorrarHistorial(){
    const list = Storage.getHistorialReposiciones();
    if(list.length === 0){ UI.toast('No hay historial para borrar', 'err'); return; }
    UI.requirePin(() => {
      UI.confirm('Borrar historial de reposiciones',
        `¿Borrar las ${list.length} reposición(es) archivada(s) de esta caja? Esta acción no se puede deshacer.`,
        () => {
          Storage.clearHistorialReposiciones();
          renderHistory();
          UI.toast('Historial de reposiciones borrado', 'ok');
        });
    });
  }

  function verDetalle(id){
    const item = Storage.getHistorialReposiciones().find(rep => rep.id === id);
    if(!item) return;
    const rows = item.desembolsos || item.rows || [];
    document.getElementById('ccRepDetailTitle').textContent = `${item.codigo || 'Reposición'} · Detalle`;
    document.getElementById('ccRepDetailBody').innerHTML = `
      <div class="field-row">
        <div><label class="f-label">Fecha de reposición</label><p>${Utils.fmtDate(item.fechaReposicion || item.fechaHasta)}</p></div>
        <div><label class="f-label">Usuario</label><p>${Utils.escapeHtml(item.usuario || item.archivadoPor || '—')}</p></div>
        <div><label class="f-label">Estado</label><p><span class="status-pill status-repuesto">${Utils.escapeHtml(item.estado || 'Confirmada')}</span></p></div>
      </div>
      <div class="table-scroll"><table class="checklist-table">
        <thead><tr><th>Fecha</th><th>Beneficiario</th><th>Concepto</th><th>Monto</th><th>Comprobante</th><th>Observaciones</th></tr></thead>
        <tbody>${rows.map(row => `<tr><td>${Utils.fmtDate(row.fecha)}</td><td>${Utils.escapeHtml(row.beneficiario || '—')}</td><td>${Utils.escapeHtml(row.descripcion || '—')}</td><td class="num">${Utils.fmtMoney(row.monto)}</td><td>${Utils.escapeHtml(row.comprobante || '—')}</td><td>${Utils.escapeHtml(row.observaciones || item.nota || '—')}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="checklist-summary"><div>${rows.length} desembolso(s)</div><strong>${Utils.fmtMoney(item.montoTotal != null ? item.montoTotal : item.totalFacturas)}</strong></div>`;
    UI.openModal('modalDetalleReposicion');
  }

  function _printValueFor(field){
    const raw = field.value || '';
    if(field.type === 'date') return Utils.fmtDate(raw);
    if(field.closest('td.num') && !raw.trim()) return ' ';
    if(field.closest('td.num') || ['ccFondo','ccFacturasView','ccDisponibleView','ccCheque','ccArqFondo','ccArqFacturas','ccArqDisponible','ccArqCheque'].includes(field.id)){
      return Utils.fmtMoney(raw);
    }
    return raw.trim() || ' ';
  }

  function syncPrintValues(){
    document.querySelectorAll('.repo-scope input, .repo-scope textarea').forEach(field => {
      let printValue = field.nextElementSibling;
      if(!printValue || !printValue.classList.contains('cc-print-value')){
        printValue = document.createElement('span');
        printValue.className = 'cc-print-value';
        field.insertAdjacentElement('afterend', printValue);
      }
      printValue.textContent = _printValueFor(field);
    });
  }

  function preparePrint(){
    if(document.body.classList.contains('cc-print-arqueo')){
      renderArqueoView();
      document.getElementById('ccArqNoteField')?.classList.toggle('cc-note-empty', !(state?.nota || '').trim());
      syncPrintValues();
      return;
    }
    if(state){
      syncHeaderFromDOM();
      renderRows();
      renderDenoms();
    }
    document.getElementById('ccNoteField')?.classList.toggle('cc-note-empty', !(state?.nota || '').trim());
    syncPrintValues();
  }

  function imprimir(){
    preparePrint();
    setTimeout(() => window.print(), 0);
  }

  function imprimirArqueo(){
    renderArqueoView();
    document.body.classList.add('cc-print-arqueo');
    setTimeout(() => window.print(), 0);
  }

  /* ---------------- Descargar desembolsos (Excel) ---------------- */
  // Junta los desembolsos del período en curso (pendientes o ya autorizados,
  // aún no repuestos) con todos los ya repuestos en reposiciones archivadas —
  // es decir, TODOS los desembolsos hechos hasta ahora en la caja activa.
  function exportarDesembolsos(){
    if(!_dirty || !state) _loadState();

    const cajaActual = _activeCajaId();
    const cajaLabel = cajaActual === 'stgo' ? 'Stgo' : 'Sto. Dgo';

    const enCurso = (state.rows || [])
      .filter(row => Number(row.monto) > 0)
      .map(row => ({
        no: row.no,
        fecha: row.fecha,
        beneficiario: row.beneficiario || '',
        descripcion: row.descripcion || '',
        monto: Number(row.monto) || 0,
        comprobante: row.comprobante || '',
        estado: _isRepuesto(row) ? 'Repuesto' : _isAuthPending(row) ? 'Pendiente autorización' : 'Para reposición',
        reposicion: '',
        observaciones: row.observaciones || ''
      }));

    const archivados = Storage.getHistorialReposiciones().flatMap(item =>
      (item.desembolsos || item.rows || [])
        .filter(row => Number(row.monto) > 0)
        .map(row => ({
          no: row.no,
          fecha: row.fecha,
          beneficiario: row.beneficiario || '',
          descripcion: row.descripcion || '',
          monto: Number(row.monto) || 0,
          comprobante: row.comprobante || '',
          estado: 'Repuesto',
          reposicion: item.codigo || item.id || '',
          observaciones: row.observaciones || item.nota || ''
        }))
    );

    const todos = [...archivados, ...enCurso].sort((a,b) => (a.fecha||'').localeCompare(b.fecha||''));

    if(todos.length === 0){ UI.toast('No hay desembolsos registrados todavía', 'err'); return; }

    const aoa = [
      ['No.','Fecha','Beneficiario','Descripción','Monto','Comprobante','Estado','Reposición','Observaciones'],
      ...todos.map(r => [r.no, r.fecha ? Utils.fmtDate(r.fecha) : '', r.beneficiario, r.descripcion, r.monto, r.comprobante, r.estado, r.reposicion, r.observaciones])
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{wch:8},{wch:12},{wch:26},{wch:34},{wch:13},{wch:16},{wch:20},{wch:16},{wch:30}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Desembolsos'.slice(0,31));
    XLSX.writeFile(wb, `CajaChica_Desembolsos_${cajaLabel.replace(/\s+|\./g,'')}_${Utils.todayISO()}.xlsx`);
    UI.toast('Excel descargado', 'ok');
  }

  window.addEventListener('beforeprint', preparePrint);
  window.addEventListener('afterprint', () => document.body.classList.remove('cc-print-arqueo'));

  return {
    render, addRow, deleteRow, updateRow, autorizarRow, updateDenom,
    guardar, iniciarNuevaReposicion, togglePending, confirmarReposicion, verDetalle, renderHistoryView, imprimir,
    renderArqueoView, cambiarCajaArqueo, updateArqueoDenom, updateArqueoCheque, updateArqueoNota, guardarArqueo, imprimirArqueo,
    exportarDesembolsos, confirmarBorrarHistorial
  };
})();
window.Reposicion = Reposicion;
