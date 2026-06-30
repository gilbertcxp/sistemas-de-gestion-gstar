/* ============================================================
   DataModule — Reporte de Cuentas por Pagar
   Filtros, orden, selección temporal (checkbox) y KPIs
   ============================================================ */
const DataModule = (() => {

  let _rows = [];
  let _selected = new Set();
  let _page = 1;
  const PER_PAGE = 50;
  let _f = { proveedor:'', estado:'', desde:'', hasta:'', factura:'' };
  let _sort = { key:'fechaVencimiento', dir:'asc' };

  // ------ load ------
  function load(){
    _rows = Storage.getRows();
    _selected = new Set(Storage.getSeleccion().filter(id => _rows.some(r => r.id === id)));
  }

  // ------ computed helpers ------
  function _diasVencimiento(r){
    if(!r.fechaVencimiento) return null;
    const d = Utils.parseISODate(r.fechaVencimiento);
    if(!d) return null;
    return Math.floor((new Date().setHours(0,0,0,0) - d.setHours(0,0,0,0)) / 86400000);
  }
  function _isVencida(r){
    if(r.estado === 'Pagada') return false;
    const dv = _diasVencimiento(r);
    return dv !== null && dv > 0;
  }

  // ------ import (upsert por llave natural, no pisa Estado ya editado) ------
  function importFile(file){
    return Parser.parseFile(file).then(result => {
      const existing = Storage.getRows();
      const byKey = new Map(existing.map(r => [Parser.rowKey(r), r]));
      let added = 0, updated = 0;
      result.rows.forEach(nr => {
        const key = Parser.rowKey(nr);
        const prev = byKey.get(key);
        if(prev){
          Object.assign(prev, { ...nr, id:prev.id, estado:prev.estado }); // conserva id y Estado local
          updated++;
        } else {
          byKey.set(key, nr);
          added++;
        }
      });
      const merged = Array.from(byKey.values());
      Storage.saveRows(merged);
      load();
      return { added, updated, total: merged.length };
    });
  }

  // ------ filters ------
  function setFilter(key, val){ _f[key] = val; _page = 1; _renderTable(); }

  function _getFiltered(){
    return _rows.filter(r => {
      if(_f.proveedor && !Utils.normalize(r.proveedor).includes(Utils.normalize(_f.proveedor))) return false;
      if(_f.estado && r.estado !== _f.estado) return false;
      if(_f.factura && !Utils.normalize(r.numeroFactura).includes(Utils.normalize(_f.factura))) return false;
      if(_f.desde && r.fechaVencimiento && r.fechaVencimiento < _f.desde) return false;
      if(_f.hasta && r.fechaVencimiento && r.fechaVencimiento > _f.hasta) return false;
      return true;
    });
  }

  function _getSorted(list){
    const { key, dir } = _sort;
    const mul = dir === 'asc' ? 1 : -1;
    return [...list].sort((a,b) => {
      let va = a[key], vb = b[key];
      if(key === 'diasVencimiento'){ va = _diasVencimiento(a)||0; vb = _diasVencimiento(b)||0; }
      if(typeof va === 'string') va = va.toLowerCase();
      if(typeof vb === 'string') vb = vb.toLowerCase();
      if(va < vb) return -1*mul;
      if(va > vb) return 1*mul;
      return 0;
    });
  }

  function setSort(key){
    if(_sort.key === key){ _sort.dir = _sort.dir === 'asc' ? 'desc' : 'asc'; }
    else { _sort = { key, dir:'asc' }; }
    _renderTable();
  }

  // ------ selection (temporal, NO altera el reporte) ------
  function toggleSelect(id){
    if(_selected.has(id)) _selected.delete(id); else _selected.add(id);
    Storage.saveSeleccion(Array.from(_selected));
    _renderTable();
    _renderSelectionBar();
  }
  function selectAllVisible(checked){
    const visible = _getSorted(_getFiltered());
    visible.forEach(r => { if(checked) _selected.add(r.id); else _selected.delete(r.id); });
    Storage.saveSeleccion(Array.from(_selected));
    _renderTable();
    _renderSelectionBar();
  }
  function clearSelection(){
    _selected.clear();
    Storage.saveSeleccion([]);
    _renderTable();
    _renderSelectionBar();
  }
  function getSelectedRows(){
    return _rows.filter(r => _selected.has(r.id));
  }
  function getSelectedCount(){ return _selected.size; }

  // ------ row-level actions ------
  function updateEstado(id, estado){
    Storage.updateRow(id, { estado });
    load();
    _renderTable();
    _renderKPIs();
  }
  function deleteRow(id){
    UI.requirePin(() => {
      Storage.deleteRow(id);
      _selected.delete(id);
      Storage.saveSeleccion(Array.from(_selected));
      load();
      render();
      UI.toast('Factura eliminada', 'ok');
    });
  }

  // ------ filter selects population ------
  function _populateSelects(){
    const selEstado = document.getElementById('dfEstado');
    if(selEstado && !selEstado.dataset.bound){
      selEstado.dataset.bound = '1';
    }
  }

  function _distinctEmpresas(){ return [...new Set(_rows.map(r => r.empresa).filter(Boolean))]; }

  // ------ KPIs ------
  function _renderKPIs(){
    const pendientes = _rows.filter(r => r.estado !== 'Pagada');
    const totalPendiente = pendientes.reduce((s,r) => s + (r.saldoPendiente||0), 0);
    const totalVencido = pendientes.filter(_isVencida).reduce((s,r) => s + (r.saldoPendiente||0), 0);
    const proveedores = new Set(_rows.map(r => r.proveedor)).size;

    const set = (id,v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
    set('cxpKpiPendiente', Utils.fmtMoney(totalPendiente));
    set('cxpKpiVencido', Utils.fmtMoney(totalVencido));
    set('cxpKpiFacturas', _rows.length.toLocaleString());
    set('cxpKpiProveedores', proveedores.toLocaleString());
  }

  // ------ selection bar ------
  function _renderSelectionBar(){
    const bar = document.getElementById('cxpSelectionBar');
    if(!bar) return;
    const rows = getSelectedRows();
    const total = rows.reduce((s,r) => s + (r.saldoPendiente||0), 0);
    document.getElementById('cxpSelCount').textContent = rows.length;
    document.getElementById('cxpSelTotal').textContent = Utils.fmtMoney(total);
    const btn = document.getElementById('btnGenerarSolicitud');
    if(btn) btn.disabled = rows.length === 0;
    bar.style.display = rows.length > 0 ? 'flex' : 'none';
  }

  // ------ table render ------
  function _sortIcon(key){
    if(_sort.key !== key) return '';
    return _sort.dir === 'asc' ? ' ▲' : ' ▼';
  }

  function _renderTable(){
    const tbody = document.querySelector('#tblCXP tbody');
    if(!tbody) return;
    const filtered = _getSorted(_getFiltered());
    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if(_page > totalPages) _page = totalPages;
    const pageRows = filtered.slice((_page-1)*PER_PAGE, _page*PER_PAGE);

    if(pageRows.length === 0){
      tbody.innerHTML = `<tr><td colspan="10"><div class="t-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="32" height="32"><path d="M7 3h8l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M9 12h6M9 16h6M9 8h3"/></svg>
        <div>${_rows.length===0 ? 'Importa el Excel de Cuentas por Pagar para ver los datos aquí.' : 'No hay facturas que coincidan con los filtros.'}</div>
      </div></td></tr>`;
    } else {
      tbody.innerHTML = pageRows.map(r => {
        const dv = _diasVencimiento(r);
        const vencida = _isVencida(r);
        const estadoCls = r.estado === 'Pagada' ? 'ok' : r.estado === 'Pagar' ? 'blue' : (vencida ? 'red' : 'warn');
        return `<tr>
          <td class="c"><input type="checkbox" class="chk" ${_selected.has(r.id)?'checked':''} onchange="DataModule.toggleSelect('${r.id}')"></td>
          <td>${Utils.escapeHtml(r.proveedor)}</td>
          <td class="mono" style="font-size:11.5px;">${Utils.escapeHtml(r.numeroFactura||'—')}</td>
          <td>${Utils.fmtDate(r.fecha)}</td>
          <td>${Utils.fmtDate(r.fechaVencimiento)}</td>
          <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Utils.escapeHtml(r.detalle)}">${Utils.escapeHtml(r.detalle||'—')}</td>
          <td class="c">${Utils.escapeHtml(r.moneda)}</td>
          <td class="r num">${Utils.fmtNum(r.saldoPendiente)}</td>
          <td class="c">${dv===null?'—':(vencida?`<span class="pill red">${dv}d</span>`:dv+'d')}</td>
          <td class="c">
            <select class="input data-status-sel" onchange="DataModule.updateEstado('${r.id}', this.value)">
              <option value="Pendiente" ${r.estado==='Pendiente'?'selected':''}>Pendiente</option>
              <option value="Pagar" ${r.estado==='Pagar'?'selected':''}>Pagar</option>
              <option value="Pagada" ${r.estado==='Pagada'?'selected':''}>Pagada</option>
            </select>
          </td>
          <td class="c">
            <button class="btn btn-ghost btn-icon btn-sm" title="Eliminar" onclick="DataModule.deleteRow('${r.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
          </td>
        </tr>`;
      }).join('');
    }

    // header sort indicators
    document.querySelectorAll('#tblCXP thead th[data-sort]').forEach(th => {
      const key = th.dataset.sort;
      th.querySelector('.sort-ic') && (th.querySelector('.sort-ic').textContent = _sortIcon(key));
    });

    // select-all checkbox state
    const chkAll = document.getElementById('cxpChkAll');
    if(chkAll){
      chkAll.checked = pageRows.length > 0 && pageRows.every(r => _selected.has(r.id));
    }

    // pagination
    const pag = document.getElementById('cxpPagination');
    if(pag){
      pag.innerHTML = filtered.length === 0 ? '' : `
        <button class="btn btn-ghost btn-sm" ${_page<=1?'disabled':''} onclick="DataModule.goPage(${_page-1})">‹ Anterior</button>
        <span class="muted" style="margin:0 8px;">Página ${_page} de ${totalPages} · ${filtered.length.toLocaleString()} factura(s)</span>
        <button class="btn btn-ghost btn-sm" ${_page>=totalPages?'disabled':''} onclick="DataModule.goPage(${_page+1})">Siguiente ›</button>`;
    }

    _renderSelectionBar();
  }

  function goPage(p){ _page = p; _renderTable(); }

  // ------ public render ------
  function render(){
    load();
    _populateSelects();
    _renderKPIs();
    _renderTable();
    _renderSelectionBar();

    // Filtro de Empresa: solo se muestra si hay más de una empresa cargada
    const empresaField = document.getElementById('dfEmpresaField');
    if(empresaField) empresaField.style.display = _distinctEmpresas().length > 1 ? '' : 'none';
  }

  return {
    render, load, importFile, setFilter, setSort, goPage,
    toggleSelect, selectAllVisible, clearSelection, getSelectedRows, getSelectedCount,
    updateEstado, deleteRow
  };
})();
