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

  function guardarRecibo(){
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
    const estadoPill = sol.estado === 'Aplicada'
      ? `<span class="pill ok"><span class="pill-dot"></span>Aplicada</span>`
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

      ${sol.estado !== 'Aplicada' && pendingCount > 0 ? `
        <button class="btn btn-accent" onclick="Pagos.aplicarPago()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="m5 13 4 4L19 7"/></svg>
          Aplicar Pago (${pendingCount} ítem${pendingCount !== 1 ? 's' : ''} pendiente${pendingCount !== 1 ? 's' : ''})
        </button>` : ''}
    `;
  }

  function aplicarPago(){
    if(!_solicitudLoaded){ UI.toast('No hay solicitud cargada', 'err'); return; }
    const sol = _solicitudLoaded;
    const rows = Storage.getDataRows();
    let applied = 0;
    sol.items.forEach(item => {
      const dataRow = rows.find(r => r.id === item.dataRowId);
      if(dataRow && (Number(dataRow.pendiente)||0) > 0.001){
        DataModule.applyPagoTotal(item.dataRowId);
        applied++;
      }
    });
    if(applied === 0){ UI.toast('Todos los ítems ya están pagados', 'ok'); return; }
    Storage.updateSolicitud(sol.numero, { estado:'Aplicada', fechaAplicacion: Utils.todayISO() });
    _solicitudLoaded = Storage.getSolicitud(sol.numero);
    DataModule.load();
    _renderSolicitudPanel();
    UI.toast(`Solicitud No.${sol.numero} aplicada — ${applied} pago(s) registrado(s)`, 'ok');
  }

  return { render, switchTab, onConsorcioChange, guardarRecibo, onSolicitudSearch, aplicarPago, _onAbonoInput };
})();
