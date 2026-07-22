/* ============================================================
   Pagos — registra cobros CXC (Recibo de Pago) y
   aplica pagos CXP por número de Solicitud
   ============================================================ */
const Pagos = (() => {

  let _tab = 'recibo';           // 'recibo' | 'solicitud'
  let _consorcioSelected = '';
  let _cxcRows = [];
  let _solicitudLoaded = null;

  // ------ Render principal ------
  function render(){
    DataModule.load();
    _populateConsorcioPicker();
    if(_consorcioSelected){
      _cxcRows = DataModule.getCXCByConsorcio(_consorcioSelected);
    }
    _renderRecibo();
    _switchTab(_tab);
  }

  // ------ Sub-tabs ------
  function switchTab(t){
    _tab = t;
    _switchTab(t);
  }

  function _switchTab(t){
    document.querySelectorAll('.pagos-tab-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === t));
    const panelR = document.getElementById('pagosPanelRecibo');
    const panelS = document.getElementById('pagosPanelSolicitud');
    if(panelR) panelR.style.display = t === 'recibo' ? '' : 'none';
    if(panelS) panelS.style.display = t === 'solicitud' ? '' : 'none';
  }

  // ------ Recibo de Pago ------
  function _populateConsorcioPicker(){
    const sel = document.getElementById('pagosConsorcioSel');
    if(!sel) return;
    const consorcios = DataModule.getConsorciosConCXC();
    sel.innerHTML = `<option value="">-- Seleccionar consorcio --</option>` +
      consorcios.map(c =>
        `<option value="${Utils.escapeHtml(c)}"${c === _consorcioSelected ? ' selected' : ''}>${Utils.escapeHtml(c)}</option>`
      ).join('');
  }

  function onConsorcioChange(val){
    _consorcioSelected = val;
    _cxcRows = val ? DataModule.getCXCByConsorcio(val) : [];
    _renderRecibo();
  }

  function _renderRecibo(){
    const tbody = document.querySelector('#pagosReciboTable tbody');
    if(!tbody) return;
    const pending = _cxcRows.filter(r => (Number(r.pendiente)||0) > 0.001);

    if(!_consorcioSelected){
      tbody.innerHTML = `<tr><td colspan="6"><div class="t-empty">Selecciona un consorcio para ver las cuentas pendientes.</div></td></tr>`;
    } else if(pending.length === 0){
      tbody.innerHTML = `<tr><td colspan="6"><div class="t-empty">Este consorcio no tiene CXC pendientes de cobro.</div></td></tr>`;
    } else {
      tbody.innerHTML = pending.map(r => {
        const pend = Number(r.pendiente)||0;
        return `<tr>
          <td>${Utils.escapeHtml(r.consorcio)}</td>
          <td class="corte-cell">${Utils.escapeHtml(r.corte)}</td>
          <td class="r">${Utils.fmtMoney(Number(r.monto)||0)}</td>
          <td class="r">${Utils.fmtMoney(Number(r.pago)||0)}</td>
          <td class="r">${Utils.fmtMoney(pend)}</td>
          <td>
            <input type="number" class="input" style="width:130px;font-size:12px;padding:4px 8px;"
              min="0" max="${pend.toFixed(2)}" step="0.01" value="${pend.toFixed(2)}"
              data-rowid="${Utils.escapeHtml(r.id)}"
              oninput="Pagos._onAbonoInput(this)">
          </td>
        </tr>`;
      }).join('');
    }
    _updateReciboTotal();
  }

  function _onAbonoInput(){ _updateReciboTotal(); }

  function _updateReciboTotal(){
    let total = 0;
    document.querySelectorAll('#pagosReciboTable tbody input[data-rowid]').forEach(inp => {
      total += parseFloat(inp.value)||0;
    });
    const el = document.getElementById('pagosReciboTotal');
    if(el) el.textContent = Utils.fmtMoney(total);
  }

  async function guardarRecibo(){
    if(!_consorcioSelected){ UI.toast('Selecciona un consorcio', 'err'); return; }
    const inputs = document.querySelectorAll('#pagosReciboTable tbody input[data-rowid]');
    let applied = 0, total = 0;
    inputs.forEach(inp => {
      const abono = parseFloat(inp.value)||0;
      if(abono > 0.001){
        DataModule.applyCobro(inp.dataset.rowid, abono);
        total += abono;
        applied++;
      }
    });
    if(applied === 0){ UI.toast('Ingresa un monto a cobrar', 'err'); return; }
    const numero = Storage.nextPagoNumber();
    Storage.addPago({
      numero,
      tipo: 'recibo',
      consorcio: _consorcioSelected,
      fecha: Utils.todayISO(),
      total,
      registros: applied
    });
    // Espera a que el cambio llegue a Supabase antes de continuar: si el envío
    // se queda en el debounce (400ms) y el usuario recarga o tiene otra pestaña
    // abierta, la nube "gana" en el próximo pull y borra el pago recién aplicado.
    if(window.Sync && Sync.publishAll){ try{ await Sync.publishAll(); }catch(e){ console.warn('publishAll', e); } }
    UI.toast(`Recibo No.${numero} guardado — ${applied} registro(s) actualizado(s)`, 'ok');
    DataModule.load();
    _cxcRows = DataModule.getCXCByConsorcio(_consorcioSelected);
    _renderRecibo();
  }

  // ------ Aplicación por Solicitud ------
  function onSolicitudSearch(){
    const input = document.getElementById('pagosSolicitudNum');
    if(!input) return;
    const numStr = input.value.trim();
    if(!numStr){ UI.toast('Ingresa el número de solicitud', 'err'); return; }
    const sol = Storage.getSolicitud(numStr);
    _solicitudLoaded = sol || null;
    _renderSolicitudPanel();
    if(!sol) UI.toast('Solicitud No.' + numStr + ' no encontrada', 'err');
  }

  function _renderSolicitudPanel(){
    const container = document.getElementById('pagosSolicitudDoc');
    if(!container) return;

    if(!_solicitudLoaded){
      container.innerHTML = `<div class="t-empty" style="padding:40px;">Ingresa un número de solicitud para ver sus detalles.</div>`;
      return;
    }

    const sol = _solicitudLoaded;
    const rows = Storage.getDataRows();

    const itemsHTML = sol.items.map(item => {
      const dataRow = rows.find(r => r.id === item.dataRowId);
      const pend = dataRow ? (Number(dataRow.pendiente)||0) : item.monto;
      const isPaid = pend <= 0.001;
      return `<tr${isPaid ? ' style="opacity:.6"' : ''}>
        <td>${Utils.escapeHtml(item.consorcio)}</td>
        <td>${Utils.escapeHtml(item.corte)}</td>
        <td class="r">${Utils.fmtMoney(item.monto)}</td>
        <td>${isPaid
          ? `<span class="pill ok"><span class="pill-dot"></span>Pagada</span>`
          : `<span class="pill warn"><span class="pill-dot"></span>Pendiente</span>`}
        </td>
      </tr>`;
    }).join('');

    const pendingCount = sol.items.filter(item => {
      const dataRow = rows.find(r => r.id === item.dataRowId);
      return dataRow ? (Number(dataRow.pendiente)||0) > 0.001 : true;
    }).length;

    const totalMonto = sol.items.reduce((s, i) => s + (Number(i.monto)||0), 0);
    const estado = sol.estado || 'Pendiente';
    const estadoPill = (estado === 'Pagada' || estado === 'Aplicada')
      ? `<span class="pill ok"><span class="pill-dot"></span>Pagada</span>`
      : estado === 'Parcialmente Pagada'
        ? `<span class="pill blue"><span class="pill-dot"></span>Parcialmente Pagada</span>`
        : `<span class="pill warn"><span class="pill-dot"></span>Pendiente — ${pendingCount} ítem${pendingCount !== 1 ? 's' : ''}</span>`;

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;">Solicitud de Pago</div>
          <div style="font-size:22px;font-weight:800;color:#0f172a;">No. ${sol.numero}</div>
          <div style="font-size:12.5px;color:#64748b;margin-top:3px;">
            Corte: <b>${Utils.escapeHtml(sol.corte)}</b> &nbsp;·&nbsp; Fecha: ${Utils.fmtDate(sol.fecha)}
          </div>
        </div>
        <div>${estadoPill}</div>
      </div>

      <table class="t" style="margin-bottom:16px;">
        <thead><tr>
          <th>Consorcio</th><th>Corte</th><th class="r">Monto</th><th>Estado</th>
        </tr></thead>
        <tbody>${itemsHTML}</tbody>
        <tfoot><tr>
          <td colspan="2"><b>TOTAL</b></td>
          <td class="r"><b>${Utils.fmtMoney(totalMonto)}</b></td>
          <td></td>
        </tr></tfoot>
      </table>

      ${pendingCount > 0 ? `
        <button class="btn btn-accent" onclick="Pagos.abrirModalPagarSolicitud()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="m5 13 4 4L19 7"/></svg>
          Aplicar Pago (${pendingCount} ítem${pendingCount !== 1 ? 's' : ''} pendiente${pendingCount !== 1 ? 's' : ''})
        </button>` : ''}
    `;
  }

  // ------ Confirmar pagos: checklist (igual que Solicitud de Pago de CXP) ------
  function abrirModalPagarSolicitud(){
    if(!_solicitudLoaded){ UI.toast('No hay solicitud cargada', 'err'); return; }
    const sol = _solicitudLoaded;
    const rows = Storage.getDataRows();

    const numEl = document.getElementById('pagarSolNumero');
    if(numEl) numEl.textContent = '#' + sol.numero;

    const checklist = document.getElementById('pagarSolChecklist');
    if(!checklist) return;

    const rowsHTML = sol.items.map((item, idx) => {
      const dataRow = rows.find(r => r.id === item.dataRowId);
      const pend = dataRow ? (Number(dataRow.pendiente)||0) : 0;
      if(pend <= 0.001) return '';   // ya pagado en una ronda anterior — no se lista
      return `<tr style="border-bottom:1px solid var(--line)">
        <td style="padding:10px 12px;text-align:center">
          <input type="checkbox" class="pagar-sol-chk" data-idx="${idx}" checked onchange="Pagos.updatePagarSolSummary()">
        </td>
        <td style="padding:10px 12px;font-weight:600">${Utils.escapeHtml(item.consorcio)}</td>
        <td style="padding:10px 12px;color:var(--ink-soft)">${Utils.escapeHtml(item.corte)}</td>
        <td style="padding:10px 12px;text-align:right;font-family:monospace;font-weight:600;white-space:nowrap">${Utils.fmtMoney(item.monto)}</td>
      </tr>`;
    }).join('');

    checklist.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:var(--canvas);border-bottom:2px solid var(--line)">
            <th style="padding:10px 12px;text-align:center;width:44px">
              <input type="checkbox" id="pagarSolChkAll" checked onchange="Pagos.toggleAllPagarSol(this.checked)">
            </th>
            <th style="padding:10px 12px;text-align:left;font-weight:600">Consorcio</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600">Corte</th>
            <th style="padding:10px 12px;text-align:right;font-weight:600">Monto</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>`;

    updatePagarSolSummary();
    UI.openModal('modalPagarSolicitud');
  }

  function toggleAllPagarSol(checked){
    document.querySelectorAll('.pagar-sol-chk').forEach(c => c.checked = checked);
    updatePagarSolSummary();
  }

  function updatePagarSolSummary(){
    const items = _solicitudLoaded ? _solicitudLoaded.items : [];
    const checks = [...document.querySelectorAll('.pagar-sol-chk')];
    let count = 0, total = 0;
    checks.forEach(c => {
      if(c.checked){ count++; total += Number(items[+c.dataset.idx]?.monto)||0; }
    });
    const countEl = document.getElementById('pagarSolSelCount');
    const montoEl = document.getElementById('pagarSolTotalMonto');
    const chkAll  = document.getElementById('pagarSolChkAll');
    if(countEl) countEl.textContent = count;
    if(montoEl) montoEl.textContent = Utils.fmtMoney(total);
    if(chkAll)  chkAll.indeterminate = (count > 0 && count < checks.length);
    if(chkAll && !chkAll.indeterminate) chkAll.checked = (count === checks.length && checks.length > 0);
  }

  // ------ Confirmar: paga los marcados, arrastra los desmarcados a la siguiente solicitud ------
  async function confirmarPagoSolicitud(){
    if(!_solicitudLoaded) return;
    const sol = _solicitudLoaded;
    const items = sol.items;
    const checks = [...document.querySelectorAll('.pagar-sol-chk')];
    if(checks.length === 0) return;

    const checkedIdx   = new Set(checks.filter(c => c.checked).map(c => +c.dataset.idx));
    const listedIdx    = new Set(checks.map(c => +c.dataset.idx));
    if(checkedIdx.size === 0){ UI.toast('Marca al menos un pago para confirmar', 'err'); return; }

    const rows = Storage.getDataRows();
    const pagados = [], pendientes = [];
    let missing = 0;

    items.forEach((item, idx) => {
      if(!listedIdx.has(idx)) return;   // ya estaba pagado antes de abrir el modal — se deja como está
      if(checkedIdx.has(idx)){
        const dataRow = rows.find(r => r.id === item.dataRowId);
        if(!dataRow){ missing++; pendientes.push(item); return; }  // ya no existe en Data — se conserva pendiente
        DataModule.applyPagoTotal(item.dataRowId);
        pagados.push(item);
      } else {
        pendientes.push(item);
      }
    });

    UI.closeModal('modalPagarSolicitud');

    if(missing > 0){
      UI.toast(`${missing} ítem(s) marcados ya no existen en Data (el corte fue eliminado o vuelto a cargar) — quedaron pendientes para la siguiente solicitud`, 'err');
    }
    if(pagados.length === 0 && missing === 0){ return; }

    const totalPagado = pagados.reduce((s,i) => s + (Number(i.monto)||0), 0);
    const estado       = pendientes.length === 0 ? 'Pagada' : 'Parcialmente Pagada';
    const session      = window.Auth ? Auth.getSession() : null;
    const usuario       = session?.user?.email || session?.user?.name || '';

    Storage.updateSolicitud(sol.numero, {
      estado,
      items: pagados,
      itemsNoProcesados: pendientes,
      fechaPago: new Date().toISOString(),
      totalDocsPagados: pagados.length,
      totalPagado,
      totalDocs: pagados.length,
      totalGeneral: totalPagado,
      usuarioPago: usuario
    });

    let msg = `Solicitud No.${sol.numero} marcada como ${estado} — ${pagados.length} pago(s) registrado(s)`;

    // Los ítems desmarcados (o sin registro en Data) pasan a una nueva solicitud
    // consecutiva, para no perderlos ni duplicarlos en la próxima aplicación.
    if(pendientes.length > 0){
      const nextNum = Storage.nextSolicitudNumber();
      const nextSol = {
        numero: nextNum,
        corte: sol.corte,
        fecha: Utils.todayISO(),
        creadoEn: new Date().toISOString(),
        estado: 'Pendiente',
        items: pendientes
      };
      Storage.addSolicitud(nextSol);
      _solicitudLoaded = nextSol;
      msg += ` · ${pendientes.length} ítem(s) movido(s) a Solicitud No.${nextNum}`;
    } else {
      _solicitudLoaded = Storage.getSolicitud(sol.numero);
    }

    // Espera a que el pago llegue a Supabase antes de continuar: si el envío se
    // queda en el debounce (400ms) y el usuario recarga o tiene otra pestaña
    // abierta con datos viejos, la nube "gana" en el próximo pull y el pago
    // recién aplicado se pierde silenciosamente.
    if(window.Sync && Sync.publishAll){ try{ await Sync.publishAll(); }catch(e){ console.warn('publishAll', e); } }

    DataModule.load();
    _renderSolicitudPanel();
    UI.toast(msg, 'ok');
  }

  return { render, switchTab, onConsorcioChange, guardarRecibo, onSolicitudSearch,
    abrirModalPagarSolicitud, toggleAllPagarSol, updatePagarSolSummary, confirmarPagoSolicitud,
    _onAbonoInput };
})();
