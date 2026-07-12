/* ============================================================
   SolicitudPago — arma, edita, paga e imprime la Solicitud
   de Pago a partir de las facturas seleccionadas en el Reporte
   ============================================================ */
const SolicitudPago = (() => {

  let _sol    = null;   // solicitud activa (Pendiente) o cargada del historial
  let _locked = false;  // true cuando se cargó solo para ver (historial)
  let _dragIdx = null;  // índice del ítem que se está arrastrando

  // ------ helpers ------
  function _getBankInputs(){
    const n = id => parseFloat(document.getElementById(id)?.value)||0;
    return {
      cuentaLabel:     document.getElementById('spCuentaLabel')?.value || Storage.getBank().cuentaLabel,
      balanceBanco:    n('spBalanceBanco'),
      chequesTransito: n('spChequesTransito'),
      provisiones:     n('spProvisiones'),
      depositos:       n('spDepositos')
    };
  }

  function _calcTotals(bank){
    bank = bank || _getBankInputs();
    const items = _sol?.items || [];
    const montoDisponible        = bank.balanceBanco - bank.chequesTransito - bank.provisiones + bank.depositos;
    const montoAPagar            = items.reduce((s,i)=>s+(i.valor||0),0);
    const disponibilidadActualizada = montoDisponible - montoAPagar;
    return { bank, montoDisponible, montoAPagar, disponibilidadActualizada };
  }

  function _fmtDateShort(iso){
    const d = Utils.parseISODate(iso);
    if(!d) return '—';
    return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
  }

  function _fmtSigned(n){
    n = Number(n)||0;
    return n < 0 ? `<span class="neg">(${Utils.fmtNum(Math.abs(n))})</span>` : Utils.fmtNum(n);
  }

  function _getActive(){
    return Storage.getSolicitudes().find(s => s.estado === 'Pendiente') || null;
  }

  // ------ Public: cargar la solicitud Pendiente al entrar desde la barra lateral ------
  function loadActive(){
    const active = _getActive();
    if(active){
      _sol    = { ...active, items: active.items.map(i=>({...i})) };
      _locked = false;
    } else {
      _sol    = null;
      _locked = false;
    }
    // render() lo llama App.renderView()
  }

  // ------ Public: crear / agregar items desde la selección del Reporte ------
  function generar(rows){
    if(!rows || rows.length === 0){ UI.toast('Selecciona al menos una factura', 'err'); return false; }

    const newItems = rows.map(r => ({
      rowId:        r.id,
      fecha:        r.fechaVencimiento || r.fecha,
      proveedor:    r.proveedor,
      empresa:      r.empresa || 'Gstar Services',
      moneda:       r.moneda || 'RD$',
      valor:        r.saldoPendiente || 0,
      detalle:      r.detalle || '',
      observaciones: ''
    }));

    const active = _getActive();
    if(active){
      // Agrega a la solicitud pendiente existente (sin duplicados)
      const existingIds = new Set(active.items.map(i => i.rowId));
      const added = newItems.filter(i => !existingIds.has(i.rowId));
      if(added.length === 0){ UI.toast('Esas facturas ya están en la solicitud activa', 'err'); return false; }
      _sol = { ...active, items: [...active.items, ...added] };
      _sol.totalGeneral = _sol.items.reduce((s,i)=>s+(i.valor||0),0);
      _sol.totalDocs    = _sol.items.length;
      Storage.upsertSolicitud(_sol);
      UI.toast(`${added.length} factura(s) agregada(s) a Solicitud #${_sol.numero}`, 'ok');
    } else {
      // Nueva solicitud con número consecutivo
      const numero = Storage.getNextNumero();
      _sol = {
        id:              Utils.uid('sol'),
        numero,
        fecha:           Utils.todayISO(),
        guardadaEn:      new Date().toISOString(),
        fechaPago:       null,
        estado:          'Pendiente',
        bank:            Storage.getBank(),
        items:           newItems,
        totalGeneral:    newItems.reduce((s,i)=>s+(i.valor||0),0),
        totalPagado:     0,
        totalDocs:       newItems.length,
        totalDocsPagados: 0
      };
      Storage.upsertSolicitud(_sol);
      UI.toast(`Solicitud #${numero} creada`, 'ok');
    }
    _locked = false;
    // render() lo llama App.switchView()
    return true;
  }

  // ------ Public: cargar desde historial (solo lectura) ------
  function cargar(sol){
    _sol    = { ...sol, items: (sol.items||[]).map(i=>({...i})) };
    _locked = true;
    // render() lo llama App.switchView()
  }

  function setObservacion(idx, val){
    if(_locked || !_sol) return;
    if(_sol.items[idx]) _sol.items[idx].observaciones = val;
    Storage.upsertSolicitud(_sol);
  }

  function eliminarItem(idx){
    if(_locked || !_sol) return;
    _sol.items.splice(idx,1);
    _sol.totalGeneral = _sol.items.reduce((s,i)=>s+(i.valor||0),0);
    _sol.totalDocs    = _sol.items.length;
    Storage.upsertSolicitud(_sol);
    render();
  }

  // ------ Orden manual de los documentos (sube/baja, drag & drop) ------
  function _persistOrder(){
    Storage.upsertSolicitud(_sol);
    render();
    UI.toast('Orden del reporte actualizado correctamente.', 'ok');
  }

  function moveItem(idx, dir){
    if(_locked || !_sol) return;
    const newIdx = idx + dir;
    if(newIdx < 0 || newIdx >= _sol.items.length) return;
    const items = _sol.items;
    [items[idx], items[newIdx]] = [items[newIdx], items[idx]];
    _persistOrder();
  }

  function dragStart(idx, ev){
    if(_locked){ ev.preventDefault(); return; }
    _dragIdx = idx;
    ev.dataTransfer.effectAllowed = 'move';
    ev.currentTarget.classList.add('dragging');
  }

  function dragOver(idx, ev){
    ev.preventDefault();
    if(_locked || _dragIdx === null) return;
    ev.currentTarget.classList.add('drag-over');
  }

  function dragLeave(ev){
    ev.currentTarget.classList.remove('drag-over');
  }

  function dragEnd(ev){
    ev.currentTarget.classList.remove('dragging');
    document.querySelectorAll('#spItemsTable tr.drag-over').forEach(el => el.classList.remove('drag-over'));
    _dragIdx = null;
  }

  function drop(idx, ev){
    ev.preventDefault();
    ev.currentTarget.classList.remove('drag-over');
    if(_locked || !_sol || _dragIdx === null || _dragIdx === idx) { _dragIdx = null; return; }
    const items = _sol.items;
    const [moved] = items.splice(_dragIdx, 1);
    items.splice(idx, 0, moved);
    _dragIdx = null;
    _persistOrder();
  }

  function habilitarEdicion(){
    if(!_sol || _sol.estado !== 'Pendiente'){
      UI.toast('Solo se pueden editar solicitudes Pendientes', 'err'); return;
    }
    _locked = false;
    render();
    UI.toast('Edición habilitada', 'ok');
  }

  function guardar(){
    if(!_sol || _sol.items.length === 0){ UI.toast('No hay documentos en la solicitud', 'err'); return; }
    _sol.guardadaEn   = new Date().toISOString();
    _sol.estado       = 'Pendiente';
    _sol.bank         = _getBankInputs();
    _sol.totalGeneral = _sol.items.reduce((s,i)=>s+(i.valor||0),0);
    _sol.totalDocs    = _sol.items.length;
    Storage.upsertSolicitud(_sol);
    render();
    UI.toast(`Solicitud #${_sol.numero} guardada`, 'ok');
  }

  // ------ Agregar documento manual ------
  function abrirModalAgregar(){
    document.getElementById('miFecha').value      = Utils.todayISO();
    document.getElementById('miProveedor').value  = '';
    document.getElementById('miDetalle').value    = '';
    document.getElementById('miValor').value      = '';
    document.getElementById('miMoneda').value     = 'RD$';
    document.getElementById('miObservaciones').value = '';
    UI.openModal('modalAgregarItem');
    setTimeout(() => document.getElementById('miProveedor')?.focus(), 120);
  }

  function submitItemManual(){
    const proveedor = (document.getElementById('miProveedor')?.value || '').trim();
    const detalle   = (document.getElementById('miDetalle')?.value  || '').trim();
    const fecha     = document.getElementById('miFecha')?.value     || Utils.todayISO();
    const valor     = parseFloat(document.getElementById('miValor')?.value) || 0;
    const moneda    = document.getElementById('miMoneda')?.value    || 'RD$';
    const obs       = (document.getElementById('miObservaciones')?.value || '').trim();

    if(!proveedor){ UI.toast('El suplidor es requerido', 'err'); document.getElementById('miProveedor')?.focus(); return; }
    if(!detalle)  { UI.toast('El detalle es requerido', 'err');   document.getElementById('miDetalle')?.focus();   return; }
    if(valor <= 0){ UI.toast('El valor debe ser mayor a 0', 'err'); document.getElementById('miValor')?.focus();   return; }

    const newItem = {
      rowId:         Utils.uid('mi'),
      fecha,
      proveedor,
      empresa:       Storage.getSettings().empresa?.nombre || 'Gstar Services',
      moneda,
      valor,
      detalle,
      observaciones: obs
    };

    const active = _getActive();
    if(active){
      _sol = { ...active, items: [...active.items, newItem] };
      _sol.totalGeneral = _sol.items.reduce((s,i)=>s+(i.valor||0),0);
      _sol.totalDocs    = _sol.items.length;
      Storage.upsertSolicitud(_sol);
      UI.toast(`Documento agregado a Solicitud #${_sol.numero}`, 'ok');
    } else {
      const numero = Storage.getNextNumero();
      _sol = {
        id:               Utils.uid('sol'),
        numero,
        fecha:            Utils.todayISO(),
        guardadaEn:       new Date().toISOString(),
        fechaPago:        null,
        estado:           'Pendiente',
        bank:             Storage.getBank(),
        items:            [newItem],
        totalGeneral:     valor,
        totalPagado:      0,
        totalDocs:        1,
        totalDocsPagados: 0
      };
      Storage.upsertSolicitud(_sol);
      UI.toast(`Solicitud #${numero} creada`, 'ok');
    }
    _locked = false;
    UI.closeModal('modalAgregarItem');
    render();
  }

  // ------ Pagar: abre modal de checklist ------
  function pagar(){
    if(!_sol || _sol.items.length === 0){ UI.toast('No hay documentos en la solicitud', 'err'); return; }
    if(_sol.estado !== 'Pendiente'){ UI.toast('Esta solicitud ya fue procesada', 'err'); return; }

    const numEl = document.getElementById('pagarNumero');
    if(numEl) numEl.textContent = `#${_sol.numero}`;

    const checklist = document.getElementById('pagarChecklist');
    if(!checklist) return;

    checklist.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:var(--surface);border-bottom:2px solid var(--line)">
            <th style="padding:10px 12px;text-align:center;width:44px">
              <input type="checkbox" id="pagarChkAll" checked
                onchange="SolicitudPago.toggleAllPagar(this.checked)">
            </th>
            <th style="padding:10px 12px;text-align:left;font-weight:600">Suplidor</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600">Detalle</th>
            <th style="padding:10px 12px;text-align:right;font-weight:600">Valor</th>
          </tr>
        </thead>
        <tbody>
          ${_sol.items.map((item, idx) => `
            <tr style="border-bottom:1px solid var(--line)">
              <td style="padding:10px 12px;text-align:center">
                <input type="checkbox" class="pagar-chk" data-idx="${idx}" checked
                  onchange="SolicitudPago.updatePagarSummary()">
              </td>
              <td style="padding:10px 12px;font-weight:600">${Utils.escapeHtml(item.proveedor)}</td>
              <td style="padding:10px 12px;color:var(--ink-soft);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                  title="${Utils.escapeHtml(item.detalle||'')}">
                ${Utils.escapeHtml(item.detalle||'—')}
              </td>
              <td style="padding:10px 12px;text-align:right;font-family:monospace;font-weight:600;white-space:nowrap">
                ${Utils.fmtNum(item.valor)}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    updatePagarSummary();
    UI.openModal('modalPagar');
  }

  function toggleAllPagar(checked){
    document.querySelectorAll('.pagar-chk').forEach(c => c.checked = checked);
    updatePagarSummary();
  }

  function updatePagarSummary(){
    const items = _sol?.items || [];
    let count = 0, total = 0;
    document.querySelectorAll('.pagar-chk').forEach((c, idx) => {
      if(c.checked){ count++; total += items[idx]?.valor||0; }
    });
    const countEl = document.getElementById('pagarSelCount');
    const montoEl = document.getElementById('pagarTotalMonto');
    const chkAll  = document.getElementById('pagarChkAll');
    if(countEl) countEl.textContent = count;
    if(montoEl) montoEl.textContent = Utils.fmtMoney(total);
    if(chkAll)  chkAll.indeterminate = (count > 0 && count < items.length);
    if(chkAll && !chkAll.indeterminate) chkAll.checked = (count === items.length && items.length > 0);
  }

  // ------ Confirmar los pagos seleccionados ------
  function confirmarPago(){
    if(!_sol) return;
    const items  = _sol.items;
    const checks = [...document.querySelectorAll('.pagar-chk')];

    const pagados    = [];
    const pendientes = [];
    checks.forEach((c, idx) => {
      if(c.checked) pagados.push(items[idx]);
      else           pendientes.push(items[idx]);
    });

    if(pagados.length === 0){ UI.toast('Marca al menos un pago para confirmar', 'err'); return; }

    UI.closeModal('modalPagar');

    const totalPagado = pagados.reduce((s,i)=>s+(i.valor||0),0);
    const estado      = pendientes.length === 0 ? 'Pagada' : 'Parcialmente Pagada';
    const session     = window.Auth ? Auth.getSession() : null;
    const usuario     = session?.user?.email || session?.user?.name || '';

    // Guarda la solicitud actual como Pagada / Parcialmente Pagada
    const solFinal = {
      ..._sol,
      estado,
      items:             pagados,
      itemsNoProcesados: pendientes,
      fechaPago:         new Date().toISOString(),
      totalDocsPagados:  pagados.length,
      totalPagado,
      totalDocs:         pagados.length,
      totalGeneral:      totalPagado,
      usuarioPago:       usuario
    };
    Storage.upsertSolicitud(solFinal);

    let msg = `Solicitud #${_sol.numero} marcada como ${estado}`;

    // Si hay items sin pagar, crea la siguiente solicitud consecutiva
    if(pendientes.length > 0){
      const nextNum = Storage.getNextNumero();
      const nextSol = {
        id:              Utils.uid('sol'),
        numero:          nextNum,
        fecha:           Utils.todayISO(),
        guardadaEn:      new Date().toISOString(),
        fechaPago:       null,
        estado:          'Pendiente',
        bank:            Storage.getBank(),
        items:           pendientes,
        totalGeneral:    pendientes.reduce((s,i)=>s+(i.valor||0),0),
        totalPagado:     0,
        totalDocs:       pendientes.length,
        totalDocsPagados: 0
      };
      Storage.upsertSolicitud(nextSol);
      _sol    = { ...nextSol };
      _locked = false;
      msg += ` · ${pendientes.length} ítem(s) movido(s) a Solicitud #${nextNum}`;
    } else {
      _sol    = null;
      _locked = false;
    }

    Historial.render();
    UI.toast(msg, 'ok');
    setTimeout(() => App.switchView('historial'), 1500);
  }

  // ------ Construye el HTML del documento (vista previa / impresión) ------
  function _buildDocHTML(){
    if(!_sol){
      return `<div class="t-empty" style="padding:60px 20px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="36" height="36"><path d="M7 3h8l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="m9 13 2 2 4-4"/></svg>
        <div>Selecciona facturas en el Reporte de CXP para generar la solicitud.</div>
      </div>`;
    }

    const { bank, montoDisponible, montoAPagar, disponibilidadActualizada } = _calcTotals(_sol.bank);
    const cuenta = bank.cuentaLabel || 'Balance en banco';

    const bbRow = (label, val, extra='') =>
      `<div class="bb-row${extra}">
         <span class="l">${Utils.escapeHtml(label)}</span>
         <span class="v">${_fmtSigned(val)}</span>
       </div>`;
    const bbRowText = (label, text, extra='') =>
      `<div class="bb-row${extra}">
         <span class="l">${Utils.escapeHtml(label)}</span>
         <span class="v">${Utils.escapeHtml(text)}</span>
       </div>`;

    const tableRows = _sol.items.length === 0
      ? `<tr><td colspan="4"><div class="t-empty">No hay documentos en esta solicitud.</div></td></tr>`
      : _sol.items.map(i => {
          const det = Utils.escapeHtml(i.detalle||'—') + (i.observaciones ? ` <i>(${Utils.escapeHtml(i.observaciones)})</i>` : '');
          return `<tr>
            <td>${Utils.fmtDate(i.fecha)}</td>
            <td>${Utils.escapeHtml(i.proveedor)}</td>
            <td>${det}</td>
            <td class="r">${Utils.fmtNum(i.valor)}</td>
          </tr>`;
        }).join('');

    return `
      <div class="doc-page">
        <div class="doc-top">
          <img src="assets/img/logo.png" class="doc-logo2" alt="Logo" onerror="this.style.display='none'">
          <div class="doc-bankblock">
            ${bbRowText('Actualizado', _fmtDateShort(_sol.fecha || Utils.todayISO()), ' header')}
            ${bbRow(cuenta, bank.balanceBanco)}
            ${bbRow('Menos: Cheques o transferencias en transito', -bank.chequesTransito)}
            ${bbRow('Menos: Provisiones, Reservas y pagos de compensacion de la sem.', -bank.provisiones)}
            ${bbRow('Mas: Depositos o transferencias entre cuentas', bank.depositos)}
            ${bbRow('Monto disponible para pagos', montoDisponible, ' total')}
            <div class="bb-spacer"></div>
            ${bbRow('Monto a Pagar', montoAPagar, ' pagar')}
            ${bbRow(`Disponibilidad actualizada ${cuenta}`, disponibilidadActualizada, ' total')}
          </div>
        </div>

        <div class="doc-title-bar">Solicitud De Pagos #${_sol.numero}</div>
        <table class="doc-table2">
          <thead>
            <tr><th>FECHA</th><th>SUPLIDOR</th><th class="c">DETALLE</th><th class="r">VALOR</th></tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>

        <div class="doc-firmas">
          <div class="doc-firma">
            <div class="firma-line"></div>
            <div class="firma-nombre">Sr. Gilbert Sanchez</div>
            <div class="firma-cargo">Cuentas por Pagar</div>
          </div>
          <div class="doc-firma">
            <div class="firma-line"></div>
            <div class="firma-nombre">Sr. Carlos Montas</div>
            <div class="firma-cargo">Vicepresidente Ejecutivo</div>
          </div>
          <div class="doc-firma">
            <div class="firma-line"></div>
            <div class="firma-nombre">Sra. Giselandia Carrasco</div>
            <div class="firma-cargo">Gerente General</div>
          </div>
        </div>
      </div>`;
  }

  // ------ Tabla editable de items (pantalla, no impresión) ------
  function _buildItemsTable(){
    if(!_sol || _sol.items.length === 0){
      return `<div class="t-empty" style="padding:40px 20px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="32" height="32"><path d="M7 3h8l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="m9 13 2 2 4-4"/></svg>
        <div>Selecciona facturas en el Reporte de CXP y presiona "Generar Solicitud de Pago".</div>
      </div>`;
    }
    return `<div class="table-wrap"><table class="t">
      <thead><tr><th style="width:28px"></th><th>Fecha</th><th>Suplidor</th><th>Detalle</th><th class="c">Moneda</th><th class="r">Valor</th><th>Observaciones</th><th class="c">Acción</th></tr></thead>
      <tbody>
        ${_sol.items.map((i,idx) => `<tr class="sp-drag-row" draggable="${_locked?'false':'true'}"
              ondragstart="SolicitudPago.dragStart(${idx}, event)"
              ondragover="SolicitudPago.dragOver(${idx}, event)"
              ondragleave="SolicitudPago.dragLeave(event)"
              ondrop="SolicitudPago.drop(${idx}, event)"
              ondragend="SolicitudPago.dragEnd(event)">
          <td class="c"><span class="sp-drag-handle" title="${_locked?'':'Arrastra para reordenar'}">
            ${_locked?'':'<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><circle cx="8" cy="6" r="1.6"/><circle cx="16" cy="6" r="1.6"/><circle cx="8" cy="12" r="1.6"/><circle cx="16" cy="12" r="1.6"/><circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/></svg>'}
          </span></td>
          <td>${Utils.fmtDate(i.fecha)}</td>
          <td>${Utils.escapeHtml(i.proveedor)}</td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
              title="${Utils.escapeHtml(i.detalle)}">${Utils.escapeHtml(i.detalle||'—')}</td>
          <td class="c">${Utils.escapeHtml(i.moneda)}</td>
          <td class="r num">${Utils.fmtNum(i.valor)}</td>
          <td>
            <input type="text" class="input" style="font-size:12px;padding:5px 8px;" placeholder="Observación…"
              value="${Utils.escapeHtml(i.observaciones||'')}" ${_locked?'disabled':''}
              oninput="SolicitudPago.setObservacion(${idx}, this.value)">
          </td>
          <td class="c">
            <div style="display:flex;gap:2px;justify-content:center;">
              <button class="btn btn-ghost btn-icon btn-sm" ${_locked||idx===0?'disabled':''} title="Subir"
                onclick="SolicitudPago.moveItem(${idx},-1)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
              </button>
              <button class="btn btn-ghost btn-icon btn-sm" ${_locked||idx===_sol.items.length-1?'disabled':''} title="Bajar"
                onclick="SolicitudPago.moveItem(${idx},1)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
              </button>
              <button class="btn btn-ghost btn-icon btn-sm" ${_locked?'disabled':''} title="Quitar de la solicitud"
                onclick="SolicitudPago.eliminarItem(${idx})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  }

  // ------ Render principal ------
  function render(){
    // Inputs del banco
    const bankData = _sol ? _sol.bank : Storage.getBank();
    // Sincronizar balance/transito/transfer desde Disponibilidad Bancaria
    try{
      const raw = localStorage.getItem('gstar_disp_banco');
      if(raw){
        const d = JSON.parse(raw);
        if(d.balance  !== undefined) bankData.balanceBanco    = d.balance;
        if(d.transito !== undefined) bankData.chequesTransito = d.transito;
        if(d.transfer !== undefined) bankData.depositos       = d.transfer;
      }
    }catch(e){}
    const set = (id,v) => { const el = document.getElementById(id); if(el) el.value = v ?? ''; };
    set('spCuentaLabel',     bankData.cuentaLabel);
    set('spBalanceBanco',    bankData.balanceBanco);
    set('spChequesTransito', bankData.chequesTransito);
    set('spProvisiones',     bankData.provisiones);
    set('spDepositos',       bankData.depositos);
    document.querySelectorAll('#spBankFields input').forEach(el => { el.disabled = _locked; });

    // Tabla de items
    const itemsWrap = document.getElementById('spItemsTable');
    if(itemsWrap) itemsWrap.innerHTML = _buildItemsTable();

    // Vista previa del documento
    const doc = document.getElementById('spDocument');
    if(doc) doc.innerHTML = _buildDocHTML();

    // Badge de estado
    const badge = document.getElementById('spEstadoBadge');
    if(badge){
      if(!_sol){
        badge.textContent = 'Sin solicitud activa';
        badge.className   = 'pill gray';
      } else {
        const e = _sol.estado || 'Pendiente';
        badge.textContent = `#${_sol.numero} · ${e}`;
        badge.className   = 'pill ' + (e==='Pendiente' ? 'warn' : e==='Pagada' ? 'ok' : 'blue');
      }
    }

    // Visibilidad de botones
    const hasSol      = !!_sol;
    const isPendiente = hasSol && _sol.estado === 'Pendiente';
    const btnGuardar  = document.getElementById('btnGuardarSolicitud');
    const btnEditar   = document.getElementById('btnEditarSolicitud');
    const btnPagar    = document.getElementById('btnPagar');
    if(btnGuardar) btnGuardar.style.display = (!_locked && isPendiente) ? '' : 'none';
    if(btnEditar)  btnEditar.style.display  = (_locked  && isPendiente) ? '' : 'none';
    if(btnPagar)   btnPagar.style.display   = isPendiente               ? '' : 'none';
  }

  function updatePreview(){
    if(!_sol) return;
    _sol.bank = _getBankInputs();
    Storage.upsertSolicitud(_sol);
    const doc = document.getElementById('spDocument');
    if(doc) doc.innerHTML = _buildDocHTML();
  }

  // ------ Imprimir ------
  function printDoc(){
    if(!_sol){ UI.toast('No hay documento para imprimir', 'err'); return; }
    const content = document.getElementById('spDocument').innerHTML;
    const w = window.open('', '_blank', 'width=900,height=700');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Solicitud de Pago #${_sol.numero}</title>
      <style>${_printCSS()}</style></head><body>${content}</body></html>`);
    w.document.close(); w.focus();
    w.onload = () => { w.print(); w.onafterprint = () => w.close(); };
  }

  // ------ PDF ------
  function exportPDF(){
    if(!_sol){ UI.toast('No hay documento para exportar', 'err'); return; }
    const el = document.querySelector('#spDocument .doc-page');
    if(!el){ UI.toast('No hay documento para exportar', 'err'); return; }
    UI.toast('Generando PDF…', 'ok');
    html2canvas(el, { scale:2, useCORS:true, backgroundColor:'#ffffff', logging:false })
      .then(canvas => {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
        const imgData = canvas.toDataURL('image/jpeg', 0.97);
        const pgW = 297, pgH = 210, imgW = pgW;
        const imgH = (canvas.height / canvas.width) * pgW;
        if(imgH <= pgH){ pdf.addImage(imgData, 'JPEG', 0, 0, imgW, imgH); }
        else { let yOff=0; while(yOff<imgH){ if(yOff>0) pdf.addPage(); pdf.addImage(imgData,'JPEG',0,-yOff,imgW,imgH); yOff+=pgH; } }
        pdf.save(`Solicitud_${_sol.numero}_CXP_${Utils.todayISO()}.pdf`);
        UI.toast('PDF descargado', 'ok');
      })
      .catch(() => UI.toast('Error al generar el PDF', 'err'));
  }

  // ------ Excel ------
  function exportExcel(){
    if(!_sol || _sol.items.length === 0){ UI.toast('No hay documentos para exportar', 'err'); return; }
    try{
      const data = _sol.items.map(i => ({
        'Fecha':          Utils.fmtDate(i.fecha),
        'Suplidor':       i.proveedor,
        'Empresa':        i.empresa,
        'Detalle':        i.detalle,
        'Moneda':         i.moneda,
        'Valor':          i.valor,
        'Observaciones':  i.observaciones||''
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws['!cols'] = [{wch:12},{wch:30},{wch:18},{wch:40},{wch:8},{wch:14},{wch:30}];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Solicitud de Pago');
      XLSX.writeFile(wb, `Solicitud_${_sol.numero}_CXP_${Utils.todayISO()}.xlsx`);
      UI.toast('Excel descargado', 'ok');
    }catch(err){
      console.error('exportExcel error:', err);
      UI.toast('No se pudo generar el Excel', 'err');
    }
  }

  function _printCSS(){ return `
    @page{ size:A4 landscape; margin:12mm 14mm; }
    *{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:Arial,sans-serif;color:#1f2937}
    .doc-page{max-width:100%}
    .doc-top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:18px}
    .doc-logo2{height:130px}
    .doc-bankblock{min-width:400px}
    .bb-row{display:flex;justify-content:space-between;gap:20px;padding:2px 0;font-size:11.5px}
    .bb-row .l{flex:1;text-align:right;color:#1f2937}
    .bb-row .v{font-weight:700;text-align:right;min-width:110px}
    .bb-row .v .neg{color:#dc2626}
    .bb-row.header .l,.bb-row.header .v{font-weight:800}
    .bb-row.total{background:#d9d9d9;font-weight:800}
    .bb-row.total .l,.bb-row.total .v{font-weight:800}
    .bb-row.pagar .l{font-weight:700}
    .bb-row.pagar .v{color:#dc2626;font-weight:800}
    .bb-spacer{height:6px}
    .doc-title-bar{background:#1f3864;color:#fff;text-align:center;font-weight:700;font-size:12.5px;letter-spacing:.3px;padding:8px;margin-top:4px}
    .doc-table2{width:100%;border-collapse:collapse;font-size:11px}
    .doc-table2 th{background:#1f3864;color:#fff;padding:7px 10px;text-align:left;font-size:10.5px;font-weight:700}
    .doc-table2 th.r,.doc-table2 td.r{text-align:right}
    .doc-table2 th.c,.doc-table2 td.c{text-align:center}
    .doc-table2 td{padding:5px 10px;border-bottom:1px solid #f1f5f9}
    .doc-table2 td.r{font-weight:600}
    .t-empty{text-align:center;padding:20px;color:#94a3b8;font-size:12px}
    .doc-firmas{display:flex;justify-content:space-between;margin-top:64px;gap:32px}
    .doc-firma{flex:1;text-align:center}
    .firma-line{border-top:1px solid #1f2937;margin-bottom:8px}
    .firma-nombre{font-size:11px;font-weight:700;color:#1f2937}
    .firma-cargo{font-size:10px;color:#64748b;margin-top:2px}
  `; }

  return {
    generar, cargar, loadActive, render, updatePreview,
    setObservacion, eliminarItem, habilitarEdicion, guardar,
    abrirModalAgregar, submitItemManual,
    moveItem, dragStart, dragOver, dragLeave, dragEnd, drop,
    pagar, confirmarPago, toggleAllPagar, updatePagarSummary,
    printDoc, exportPDF, exportExcel
  };
})();
