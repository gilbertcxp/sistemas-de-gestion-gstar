/* ============================================================
   SaldoFavor — Saldo a Favor de Compensación
   Estado de cuenta automático (sin registro manual): un movimiento
   por cada corte pagado en Solicitud de Pago (fc_solicitudes con
   estado 'Aplicada') y uno por cada Transferencia Propia registrada
   en Disponibilidad Bancaria (Compensación → Operativa).
   El saldo se recalcula siempre desde cero, en orden cronológico,
   por lo que cualquier cambio en las fuentes se refleja solo con
   volver a renderizar — no hay estado intermedio que mantener.
   ============================================================ */
const SaldoFavor = (() => {
  const SALDO_INICIAL = 3000034689.70;

  let _rows = [];       // movimientos calculados, incluye la fila de saldo inicial
  let _filtered = [];
  let _f = { desde:'', hasta:'' };
  let _sort = { key:'fecha', dir:'asc' };

  // ------ construcción de movimientos a partir de las dos fuentes ------
  function _buildMovimientos(solicitudes, transferencias){
    const movs = [];

    solicitudes
      .filter(s => s.estado === 'Aplicada')
      .forEach(s => {
        const total = (s.items||[]).reduce((sum,i) => sum + (Number(i.monto)||0), 0);
        if(total <= 0) return;
        const fecha = s.fechaAplicacion || s.fecha;
        movs.push({
          id: 'sol_' + s.numero,
          fecha,
          orden: Date.parse(s.creadoEn) || 0,
          transferencia: 0,
          pago: total,
          ref: 'Corte ' + (s.corte || ('#'+s.numero))
        });
      });

    transferencias
      .filter(t => t.origen === 'compensacion' && t.destino === 'operativa')
      .forEach(t => {
        const monto = Number(t.monto) || 0;
        if(monto <= 0) return;
        movs.push({
          id: 'tr_' + t.id,
          fecha: t.fecha,
          orden: Date.parse(t.registradoEn) || 0,
          transferencia: monto,
          pago: 0,
          ref: t.observacion ? t.observacion : 'Transferencia a Cuenta Operativa'
        });
      });

    // Orden cronológico estricto para el cálculo (fecha asc; empate por marca de registro)
    movs.sort((a,b) => {
      const fa = a.fecha||'', fb = b.fecha||'';
      if(fa !== fb) return fa.localeCompare(fb);
      return (a.orden||0) - (b.orden||0);
    });

    let saldo = SALDO_INICIAL;
    const rows = [{ id:'inicial', esInicial:true, fecha:null, transferencia:0, pago:0, ref:'Saldo Inicial', saldo }];
    movs.forEach(m => {
      saldo = saldo + m.transferencia - m.pago;
      rows.push({ ...m, saldo });
    });
    return rows;
  }

  async function _cargar(){
    const solicitudes = Storage.getSolicitudes();
    let transferencias = [];
    if(window.Sync && Sync.pullTransferData){
      transferencias = (await Sync.pullTransferData()) || [];
    }
    _rows = _buildMovimientos(solicitudes, transferencias);
  }

  // ------ filtros y orden (solo afectan la presentación, no el cálculo) ------
  function _getFiltered(){
    return _rows.filter(r => {
      if(r.esInicial) return true; // el saldo inicial siempre se muestra
      if(_f.desde && r.fecha && r.fecha < _f.desde) return false;
      if(_f.hasta && r.fecha && r.fecha > _f.hasta) return false;
      return true;
    });
  }

  function _getSorted(list){
    const { key, dir } = _sort;
    const mul = dir === 'asc' ? 1 : -1;
    const inicial = list.filter(r => r.esInicial);
    const resto = list.filter(r => !r.esInicial).slice();
    resto.sort((a,b) => {
      let va, vb;
      if(key === 'fecha'){ va = a.fecha||''; vb = b.fecha||''; }
      else if(key === 'transferencia'){ va = a.transferencia||0; vb = b.transferencia||0; }
      else if(key === 'pago'){ va = a.pago||0; vb = b.pago||0; }
      else { va = a.saldo||0; vb = b.saldo||0; }
      if(va < vb) return -1*mul;
      if(va > vb) return 1*mul;
      return 0;
    });
    // El saldo inicial siempre queda primero, sin importar el orden elegido
    return dir === 'asc' ? [...inicial, ...resto] : [...resto, ...inicial];
  }

  function _sortIcon(key){
    if(_sort.key !== key) return '';
    return _sort.dir === 'asc' ? ' ▲' : ' ▼';
  }

  // ------ render ------
  function _renderTable(){
    const tbody = document.getElementById('sfBody');
    if(!tbody) return;
    _filtered = _getSorted(_getFiltered());

    if(_filtered.length === 0){
      tbody.innerHTML = `<tr><td colspan="4"><div class="t-empty">Sin movimientos en el rango seleccionado.</div></td></tr>`;
    } else {
      tbody.innerHTML = _filtered.map(r => `
        <tr>
          <td>${r.esInicial
              ? '<b>Saldo Inicial</b>'
              : `${Utils.fmtDate(r.fecha)}<div class="muted" style="font-size:11px;margin-top:2px;">${Utils.escapeHtml(r.ref)}</div>`}</td>
          <td class="r num">${r.transferencia > 0 ? Utils.fmtMoney(r.transferencia) : '—'}</td>
          <td class="r num">${r.pago > 0 ? Utils.fmtMoney(r.pago) : '—'}</td>
          <td class="r num"><b>${Utils.fmtMoney(r.saldo)}</b></td>
        </tr>`).join('');
    }

    ['fecha','transferencia','pago','saldo'].forEach(key => {
      const el = document.getElementById('sfIc' + key.charAt(0).toUpperCase() + key.slice(1));
      if(el) el.textContent = _sortIcon(key);
    });
  }

  function _renderResumen(){
    const ultimo = _rows[_rows.length - 1];
    const saldo = ultimo ? ultimo.saldo : SALDO_INICIAL;
    const elMonto = document.getElementById('sfSaldoActual');
    if(elMonto) elMonto.textContent = Utils.fmtMoney(saldo);
    const n = Math.max(0, _rows.length - 1); // sin contar la fila de Saldo Inicial
    const elDesc = document.getElementById('sfSaldoDesc');
    if(elDesc) elDesc.textContent = n === 0
      ? 'Sin movimientos registrados todavía'
      : `${n} movimiento${n!==1?'s':''} registrado${n!==1?'s':''} · actualizado automáticamente`;
  }

  async function render(){
    const tbody = document.getElementById('sfBody');
    if(tbody) tbody.innerHTML = `<tr><td colspan="4"><div class="t-empty">Cargando…</div></td></tr>`;
    await _cargar();
    _renderResumen();
    _renderTable();
  }

  // ------ filtros / orden (UI) ------
  function filter(){
    _f.desde = document.getElementById('sfDesde').value;
    _f.hasta = document.getElementById('sfHasta').value;
    _renderTable();
  }
  function clearFilters(){
    document.getElementById('sfDesde').value = '';
    document.getElementById('sfHasta').value = '';
    _f = { desde:'', hasta:'' };
    _renderTable();
  }
  function setSort(key){
    if(_sort.key === key){ _sort.dir = _sort.dir === 'asc' ? 'desc' : 'asc'; }
    else { _sort = { key, dir:'asc' }; }
    _renderTable();
  }

  // ------ export ------
  function exportExcel(){
    if(_rows.length <= 1){ UI.toast('No hay movimientos para exportar', 'err'); return; }
    const rows = _getSorted(_getFiltered()).map(r => ({
      'Fecha': r.esInicial ? 'Saldo Inicial' : Utils.fmtDate(r.fecha),
      'Referencia': r.esInicial ? '' : r.ref,
      'Transferencia Propia': r.transferencia || 0,
      'Pago de la Semana': r.pago || 0,
      'Nuevo Saldo': r.saldo
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch:14},{wch:34},{wch:18},{wch:18},{wch:18}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Saldo a Favor');
    XLSX.writeFile(wb, `Saldo_Favor_Compensacion_${Utils.todayISO()}.xlsx`);
    UI.toast('Excel descargado', 'ok');
  }

  return { render, filter, clearFilters, setSort, exportExcel };
})();
