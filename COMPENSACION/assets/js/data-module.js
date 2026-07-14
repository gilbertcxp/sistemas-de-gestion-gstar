/* ============================================================
   DataModule — importa y visualiza el historial de compensación
   Hoja "Data" del Excel: 14 columnas, ~2825 filas
   ============================================================ */
const DataModule = (() => {

  let _rows = [];
  let _page = 1;
  const PER_PAGE = 50;
  let _f = { consorcio:'', tipo:'', corte:'', año:'', estado:'' };

  // ------ helpers ------
  function _round2(n){ return Math.round((Number(n)||0)*100)/100; }

  // Estado derivado EXCLUSIVAMENTE de los montos (alimentado por el módulo Pagos).
  //   sin pago            -> Por Cobrar (CXC) / Pendiente (CXP)
  //   pago parcial        -> Parcial
  //   pagado por completo -> Cobrada (CXC) / Pagada (CXP)
  function _deriveEstado(tipo, monto, pago, pendiente){
    const m    = Number(monto)||0;
    const paid = Number(pago)||0;
    const pend = (pendiente != null && pendiente !== '') ? (Number(pendiente)||0) : _round2(m - paid);
    if(pend <= 0.001) return tipo === 'CXC' ? 'Cobrada' : 'Pagada';
    if(paid > 0.001)  return 'Parcial';
    return tipo === 'CXC' ? 'Por Cobrar' : 'Pendiente';
  }

  function _estadoPill(estado){
    const map = { 'Por Cobrar':'warn', 'Pendiente':'warn', 'Parcial':'blue', 'Cobrada':'ok', 'Pagada':'ok' };
    const cls = map[estado] || 'gray';
    return `<span class="pill ${cls}"><span class="pill-dot"></span>${Utils.escapeHtml(estado)}</span>`;
  }

  function _excelDateToISO(val){
    if(val === null || val === undefined || val === '') return '';
    if(val instanceof Date){
      if(isNaN(val)) return '';
      const y = val.getFullYear(), m = String(val.getMonth()+1).padStart(2,'0'), d = String(val.getDate()).padStart(2,'0');
      return `${y}-${m}-${d}`;
    }
    if(typeof val === 'number'){
      // Serial de Excel (días desde 1899-12-30). Se lee en UTC para no depender
      // de la zona horaria del navegador — mezclar UTC (cálculo) con local
      // (lectura) corría la fecha un día hacia atrás en RD (UTC-4).
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(val) * 86400000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    }
    const s = String(val).trim();
    // Ya viene en formato ISO (YYYY-MM-DD…) — se deja tal cual, sin re-parsear
    // con `new Date()` (un string "YYYY-MM-DD" se interpreta como UTC, no local).
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    // DD/MM/YYYY or DD-MM-YYYY
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if(m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    const dt = new Date(s);
    return isNaN(dt) ? '' : Utils.toISODate(dt);
  }

  function _parseNum(val){
    if(val === null || val === undefined || val === '') return 0;
    if(typeof val === 'number') return val;
    const n = parseFloat(String(val).replace(/[RD$\s,]/g,''));
    return isNaN(n) ? 0 : n;
  }

  // ------ Excel parser ------
  function _parseDataSheet(wb){
    // Try to find a sheet named "Data" (case-insensitive), else try all
    let targetSheet = null, sheetName = '';
    const dataSheet = wb.SheetNames.find(n => /^data$/i.test(n.trim()));
    const candidates = dataSheet ? [dataSheet, ...wb.SheetNames.filter(n=>n!==dataSheet)] : wb.SheetNames;

    for(const sn of candidates){
      const ws = wb.Sheets[sn];
      const aoa = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:'' });
      let headerIdx = -1, colMap = {};

      for(let r = 0; r < Math.min(aoa.length, 20); r++){
        const row = aoa[r].map(c => Utils.normalize(String(c||'')));
        if(row.some(c => c === 'CONSORCIO') && row.some(c => c === 'TIPO') && row.some(c => c === 'MONTO')){
          headerIdx = r;
          row.forEach((h, i) => {
            if(h === 'CONSORCIO')           colMap.consorcio = i;
            else if(h === 'FECHA')          colMap.fecha = i;
            else if(h === 'MES LETRA')      colMap.mesLetra = i;
            else if(h === 'MES')            colMap.mes = i;
            else if(h === 'ANO' || h === 'AO') colMap.año = i;
            else if(h === 'CORTE')          colMap.corte = i;
            else if(h === 'S/N')            colMap.grupo = i;
            else if(h === 'TIPO')           colMap.tipo = i;
            else if(h === 'ACCION')         colMap.accion = i;
            else if(h.startsWith('FECHA DE P')) colMap.fechaPago = i;
            else if(h === 'MONTO')          colMap.monto = i;
            else if(h === 'PAGO')           colMap.pago = i;
            else if(h === 'PENDIENTE')      colMap.pendiente = i;
            else if(h === 'NO')             colMap.numero = i;
          });
          targetSheet = { aoa, headerIdx, colMap };
          sheetName = sn;
          break;
        }
      }
      if(targetSheet) break;
    }

    if(!targetSheet) throw new Error('No se encontró la hoja "Data" con el formato esperado.\nVerifica que el archivo sea el historial correcto con columnas: CONSORCIO, TIPO, MONTO, PENDIENTE.');

    const { aoa, headerIdx, colMap } = targetSheet;
    const rows = [];

    for(let r = headerIdx + 1; r < aoa.length; r++){
      const row = aoa[r];
      const consorcio = String(row[colMap.consorcio]||'').trim();
      if(!consorcio) continue;
      const tipo = String(row[colMap.tipo]||'').trim().toUpperCase();
      if(tipo !== 'CXC' && tipo !== 'CXP') continue;

      let monto    = _parseNum(row[colMap.monto]);
      let pago     = _parseNum(row[colMap.pago]);
      let pendiente = _parseNum(row[colMap.pendiente]);
      // CXC amounts are stored as negatives in this Excel (debit to consortium)
      if(tipo === 'CXC'){ monto = Math.abs(monto); pago = Math.abs(pago); pendiente = Math.abs(pendiente); }

      rows.push({
        id:        Utils.uid('dr'),
        consorcio,
        fecha:     _excelDateToISO(colMap.fecha !== undefined ? row[colMap.fecha] : ''),
        mesLetra:  String(row[colMap.mesLetra]||'').trim(),
        mes:       _parseNum(row[colMap.mes]),
        año:       _parseNum(row[colMap.año]),
        corte:     String(row[colMap.corte]||'').trim(),
        grupo:     String(row[colMap.grupo]||'').trim(),
        tipo,
        accion:    String(row[colMap.accion]||'').trim(),
        fechaPago: _excelDateToISO(colMap.fechaPago !== undefined ? row[colMap.fechaPago] : ''),
        monto,
        pago,
        pendiente,
        numero:    String(row[colMap.numero]||'').trim(),
        estado:    _deriveEstado(tipo, monto, pago, pendiente)
      });
    }

    return { sheetName, count: rows.length, rows };
  }

  // ------ Public: importar archivo ------
  function importFile(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.onload = () => {
        try{
          const wb = XLSX.read(reader.result, { type:'array', cellDates:true });
          const result = _parseDataSheet(wb);
          if(result.count === 0) throw new Error('No se encontraron registros válidos en la hoja Data.');
          Storage.clearDataRows();
          Storage.saveDataRows(result.rows);
          _rows = result.rows;
          resolve(result);
        }catch(err){ reject(err); }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // ------ Internal load ------
  // El estado se recalcula siempre desde los montos: nunca es editable a mano.
  function load(){
    _rows = Storage.getDataRows().map(r => ({
      ...r,
      estado: _deriveEstado(r.tipo, r.monto, r.pago, r.pendiente)
    }));
  }

  // ------ Filters ------
  function _getFiltered(){
    return _rows.filter(r => {
      if(_f.consorcio && r.consorcio !== _f.consorcio) return false;
      if(_f.tipo && r.tipo !== _f.tipo) return false;
      if(_f.corte && r.corte !== _f.corte) return false;
      if(_f.año && String(r.año) !== _f.año) return false;
      if(_f.estado && r.estado !== _f.estado) return false;
      return true;
    });
  }

  // ------ Populate filter selects ------
  function _populateConsorcios(){
    const consorcios = getConsorcios();
    const el = document.getElementById('dfConsorcio');
    if(!el) return;
    const prev = _f.consorcio;
    el.innerHTML = `<option value="">Todos los consorcios</option>` +
      consorcios.map(c => `<option value="${Utils.escapeHtml(c)}">${Utils.escapeHtml(c)}</option>`).join('');
    if(prev && consorcios.includes(prev)) el.value = prev; else _f.consorcio = '';
  }

  function _populateAños(){
    const años = [...new Set(_rows.map(r => r.año).filter(Boolean))].sort((a,b)=>b-a);
    const el = document.getElementById('dfAño');
    if(!el) return;
    el.innerHTML = `<option value="">Todos los años</option>` +
      años.map(a => `<option value="${a}">${a}</option>`).join('');
    if(_f.año) el.value = _f.año;
  }

  // El corte depende del año seleccionado: solo muestra cortes de ese año.
  function _populateCortes(){
    const source = _f.año ? _rows.filter(r => String(r.año) === String(_f.año)) : _rows;
    const cortes = [...new Set(source.map(r => r.corte).filter(Boolean))].sort();
    const el = document.getElementById('dfCorte');
    if(!el) return;
    const prev = _f.corte;
    el.innerHTML = `<option value="">Todos los cortes</option>` +
      cortes.map(c => `<option value="${Utils.escapeHtml(c)}">${Utils.escapeHtml(c)}</option>`).join('');
    if(prev && cortes.includes(prev)) el.value = prev; else _f.corte = '';
  }

  function _populateSelects(){ _populateConsorcios(); _populateAños(); _populateCortes(); }

  // ------ Render summary chips ------
  function _renderSummary(){
    const total = _rows.length;
    const cxc   = _rows.filter(r => r.tipo === 'CXC').length;
    const cxp   = _rows.filter(r => r.tipo === 'CXP').length;
    const pend  = _rows.filter(r => r.estado === 'Pendiente').length;
    const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
    set('dSumTotal', total.toLocaleString());
    set('dSumCXC',   cxc.toLocaleString());
    set('dSumCXP',   cxp.toLocaleString());
    set('dSumPend',  pend.toLocaleString());
  }

  // ------ Agrupa todas las filas UD en una o dos filas consolidadas ------
  function _groupUD(rows){
    const nonUD = rows.filter(r => r.grupo !== 'UD');
    const udRows = rows.filter(r => r.grupo === 'UD');
    if(udRows.length === 0) return rows;

    const agg = [];
    ['CXC','CXP'].forEach(tipo => {
      const sub = udRows.filter(r => r.tipo === tipo);
      if(sub.length === 0) return;
      agg.push({
        id:        sub.length === 1 ? sub[0].id : 'ud-' + tipo + '-group',
        consorcio: 'Grupo UD',
        fecha:     sub[0].fecha,
        mesLetra:  sub[0].mesLetra,
        mes:       sub[0].mes,
        año:       sub[0].año,
        corte:     sub[0].corte,
        grupo:     'UD',
        tipo,
        accion:    '',
        fechaPago: '',
        monto:     sub.reduce((s,r) => s + r.monto, 0),
        pago:      sub.reduce((s,r) => s + r.pago,  0),
        pendiente: sub.reduce((s,r) => s + r.pendiente, 0),
        numero:    '',
        estado:    tipo === 'CXC'
          ? (sub.some(r => r.estado === 'Por Cobrar') ? 'Por Cobrar' : 'Cobrada')
          : (sub.some(r => r.estado === 'Pendiente')  ? 'Pendiente'  : 'Pagada'),
        _count:    sub.length
      });
    });
    return [...agg, ...nonUD];
  }

  // ------ Render table ------
  function _renderTable(){
    const filtered   = _groupUD(_getFiltered());
    const total      = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
    if(_page > totalPages) _page = totalPages;
    const start    = (_page - 1) * PER_PAGE;
    const pageRows = filtered.slice(start, start + PER_PAGE);

    const tbody = document.querySelector('#tblData tbody');
    if(!tbody) return;

    if(pageRows.length === 0){
      tbody.innerHTML = `<tr><td colspan="10"><div class="t-empty">No se encontraron registros con estos filtros.</div></td></tr>`;
    } else {
      tbody.innerHTML = pageRows.map(r => {
        const tipoPill = r.tipo === 'CXP'
          ? `<span class="pill red" style="font-size:10.5px"><span class="pill-dot"></span>CXP</span>`
          : `<span class="pill indigo" style="font-size:10.5px"><span class="pill-dot"></span>CXC</span>`;

        // El estado ya no es editable: se alimenta desde el módulo Pagos.
        const estadoCell = _estadoPill(r.estado);

        const nombreCell = r._count
          ? `<b>${Utils.escapeHtml(r.consorcio)}</b> <span class="muted" style="font-size:11px">(${r._count} consorcios)</span>`
          : Utils.escapeHtml(r.consorcio);
        return `<tr>
          <td>${nombreCell}</td>
          <td style="white-space:nowrap">${r.fecha ? Utils.fmtDate(r.fecha) : '—'}</td>
          <td>${Utils.escapeHtml(r.mesLetra||'—')}</td>
          <td class="corte-cell" title="${Utils.escapeHtml(r.corte)}">${Utils.escapeHtml(r.corte)}</td>
          <td>${Utils.escapeHtml(r.grupo||'—')}</td>
          <td>${tipoPill}</td>
          <td>${estadoCell}</td>
          <td class="r num">${Utils.fmtNum(r.monto)}</td>
          <td class="r num">${Utils.fmtNum(r.pago)}</td>
          <td class="r num"><b>${Utils.fmtNum(r.pendiente)}</b></td>
        </tr>`;
      }).join('');
    }

    // Pagination
    const pEl = document.getElementById('dataPagination');
    if(pEl){
      if(total === 0){
        pEl.innerHTML = '';
      } else {
        pEl.innerHTML = `
          <span class="muted" style="font-size:12px">${start+1}–${Math.min(start+PER_PAGE, total)} de ${total.toLocaleString()} registros</span>
          <button class="btn btn-ghost btn-sm" ${_page<=1?'disabled':''} onclick="DataModule.goPage(${_page-1})">‹ Anterior</button>
          <button class="btn btn-ghost btn-sm" ${_page>=totalPages?'disabled':''} onclick="DataModule.goPage(${_page+1})">Siguiente ›</button>`;
      }
    }
  }

  // ------ Public API ------
  function render(){
    load();
    _populateSelects();
    _renderSummary();
    _renderTable();
  }

  function goPage(p){
    _page = p;
    _renderTable();
  }

  function setFilter(key, val){
    _f[key] = val;
    _page = 1;
    // El corte depende del año: al cambiar el año se reconstruye la lista de cortes.
    if(key === 'año'){ _f.corte = ''; _populateCortes(); }
    _renderTable();
  }

  // ------ Actualización de estado desde el módulo Pagos ------
  // Registra un cobro (abono) sobre una fila CXC y recalcula pago/pendiente/estado.
  function applyCobro(id, abono){
    const r = Storage.getDataRows().find(x => x.id === id);
    if(!r) return null;
    const monto   = Number(r.monto)||0;
    const pagoNew = _round2(Math.min((Number(r.pago)||0) + (Number(abono)||0), monto));
    const pendNew = _round2(Math.max(monto - pagoNew, 0));
    const estado  = _deriveEstado(r.tipo, monto, pagoNew, pendNew);
    Storage.updateDataRow(id, { pago:pagoNew, pendiente:pendNew, estado, fechaPago: Utils.todayISO() });
    return { pago:pagoNew, pendiente:pendNew, estado };
  }

  // Marca una fila como saldada por completo (CXP -> Pagada, CXC -> Cobrada).
  function applyPagoTotal(id){
    const r = Storage.getDataRows().find(x => x.id === id);
    if(!r) return null;
    const monto = Number(r.monto)||0;
    Storage.updateDataRow(id, { pago:monto, pendiente:0, estado: r.tipo === 'CXC' ? 'Cobrada' : 'Pagada', fechaPago: Utils.todayISO() });
    return true;
  }

  // Refresca la data en memoria y la vista Data si está activa (tras aplicar pagos).
  function refresh(){
    load();
    const active = document.querySelector('.view.active');
    if(active && active.id === 'view-data'){ _populateSelects(); _renderSummary(); _renderTable(); }
    if(typeof Dashboard !== 'undefined' && Dashboard.renderKPIs) Dashboard.renderKPIs();
  }

  // Facturas CXC pendientes (Por Cobrar / Parcial) de un consorcio — para Recibo de Pago.
  function getCXCByConsorcio(consorcio){
    return Storage.getDataRows()
      .filter(r => r.tipo === 'CXC' && r.consorcio === consorcio && _round2((Number(r.monto)||0) - (Number(r.pago)||0)) > 0.001)
      .map(r => {
        const pend = _round2((Number(r.monto)||0) - (Number(r.pago)||0));
        return { ...r, pendiente: pend, estado: _deriveEstado(r.tipo, r.monto, r.pago, pend) };
      })
      .sort((a,b) => (a.corte||'').localeCompare(b.corte||''));
  }

  // Consorcios que tienen al menos una CXC pendiente — para el selector de cliente.
  function getConsorciosConCXC(){
    return [...new Set(Storage.getDataRows()
      .filter(r => r.tipo === 'CXC' && _round2((Number(r.monto)||0) - (Number(r.pago)||0)) > 0.001)
      .map(r => r.consorcio).filter(Boolean))].sort();
  }

  // ------ Eliminar Corte (Admin) ------
  function showDeleteCorteModal(){
    const cortes = [...new Set(_rows.map(r => r.corte).filter(Boolean))].sort();
    const sel = document.getElementById('deleteCorteSelect');
    if(sel) sel.innerHTML = cortes.map(c => `<option value="${Utils.escapeHtml(c)}">${Utils.escapeHtml(c)}</option>`).join('');
    const pin = document.getElementById('deleteCortePin');
    if(pin) pin.value = '';
    const modal = document.getElementById('modalDeleteCorte');
    if(modal){ modal.style.display = 'flex'; setTimeout(()=>pin&&pin.focus(), 100); }
  }

  function closeDeleteCorteModal(){
    const modal = document.getElementById('modalDeleteCorte');
    if(modal) modal.style.display = 'none';
  }

  function confirmDeleteCorte(){
    const pin      = (document.getElementById('deleteCortePin')?.value || '').trim();
    const adminPin = String(Storage.getSettings().adminPin || '1234');
    if(pin !== adminPin){ UI.toast('PIN incorrecto', 'err'); return; }
    const corte = document.getElementById('deleteCorteSelect')?.value;
    if(!corte){ UI.toast('Selecciona un corte', 'err'); return; }
    const remaining = Storage.getDataRows().filter(r => r.corte !== corte);
    Storage.saveDataRows(remaining);
    load();
    render();
    closeDeleteCorteModal();
    UI.toast(`Corte eliminado correctamente`, 'ok');
    if(typeof Dashboard !== 'undefined' && Dashboard.renderKPIs) Dashboard.renderKPIs();
  }

  function getCortes(){
    return [...new Set(_rows.filter(r => r.tipo==='CXP' && r.estado==='Pendiente').map(r=>r.corte).filter(Boolean))].sort();
  }

  function getConsorcios(){
    return [...new Set(_rows.map(r => r.consorcio).filter(Boolean))].sort();
  }

  function getCXPByCorte(corte){
    return _rows.filter(r => r.tipo==='CXP' && r.corte===corte && r.estado==='Pendiente');
  }

  function getByConsorcio(consorcio){
    return _rows.filter(r => r.consorcio===consorcio).sort((a,b)=>(a.corte||'').localeCompare(b.corte||''));
  }

  function getRows(){ return _rows; }

  // ------ Public: import from weekly Cargar-Excel ------
  // staged = Invoices.getStaged(), desde/hasta = ISO date strings from the UI inputs
  function importFromWeekly(staged, desde, hasta){
    if(!staged || staged.length === 0) return 0;

    const corteLabel = desde && hasta
      ? `${Utils.fmtDate(desde)} – ${Utils.fmtDate(hasta)}`
      : desde ? Utils.fmtDate(desde) : 'Sin fecha';

    let mes = 0, año = 0, mesLetra = '';
    if(desde){
      const dt = new Date(desde + 'T00:00:00');
      if(!isNaN(dt)){
        mes      = dt.getMonth() + 1;
        año      = dt.getFullYear();
        mesLetra = dt.toLocaleDateString('es-DO', { month:'long' }).toUpperCase();
      }
    }

    const pct    = Number(Storage.getSettings().porcentaje) || 2;
    const round2 = n => Math.round(n * 100) / 100;

    const mkRow = (consorcio, balance, grupo) => {
      const montoBase  = Math.abs(balance);
      const comision   = round2(montoBase * (pct / 100));
      const montoTotal = round2(montoBase + comision);
      const tipo       = balance > 0 ? 'CXP' : 'CXC';  // monto positivo = CXP (por pagar)
      return {
        id:        Utils.uid('dr'),
        consorcio,
        fecha:     desde || '',
        mesLetra,
        mes,
        año,
        corte:     corteLabel,
        grupo,
        tipo,
        accion:    '',
        fechaPago: '',
        monto:     montoTotal,
        pago:      0,
        pendiente: montoTotal,
        numero:    '',
        estado:    tipo === 'CXC' ? 'Por Cobrar' : 'Pendiente'
      };
    };

    // Separar UD de no-UD
    const udStaged    = staged.filter(r => r.isUD    && r.balance !== 0);
    const nonUDStaged = staged.filter(r => !r.isUD   && r.balance !== 0);

    // Neto del Grupo UD: suma de balances (positivo = CXP, negativo = CXC)
    const udNet = udStaged.reduce((s, r) => s + r.balance, 0);

    const newRows = [
      // Una sola fila con el balance neto del Grupo UD
      ...(udNet !== 0 ? [mkRow('Grupo UD', udNet, 'UD')] : []),
      // Filas individuales para consorcios fuera del grupo UD
      ...nonUDStaged.map(r => mkRow(r.excelName || r.consorcio || '', r.balance, '')),
    ];

    if(newRows.length === 0) return 0;

    const existing = Storage.getDataRows();
    Storage.saveDataRows([...existing, ...newRows]);
    load();
    return newRows.length;
  }

  return { render, importFile, load, goPage, setFilter,
           applyCobro, applyPagoTotal, refresh, getCXCByConsorcio, getConsorciosConCXC,
           getCortes, getConsorcios, getCXPByCorte, getByConsorcio, getRows,
           importFromWeekly,
           showDeleteCorteModal, closeDeleteCorteModal, confirmDeleteCorte };
})();
