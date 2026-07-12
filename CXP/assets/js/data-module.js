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

  // ------ Pagos Fijos: sincronizados desde la Antigüedad de Saldo (Supabase) ------
  // No se registran manualmente. Se regeneran en cada sync (id determinístico por
  // proveedor+factura+fecha), pero cualquier campo editado a mano en el Reporte
  // (Suplidor, Concepto, Monto — ver updateField/_editedFields) queda "congelado"
  // y ya no se pisa con lo que traiga la Antigüedad; el resto sigue sincronizándose.
  // El Estado siempre se preserva (es un campo puramente local, no viene de Antigüedad).
  // Los Pagos Provisionales (manuales o importados) nunca se tocan aquí.
  async function syncFijosFromAging(){
    if(!window.Sync) return { ok:false, reason:'no-sync' };
    const aging = await Sync.pullAgingData();
    if(!aging) return { ok:false, reason:'no-data' };

    const nuevosFijos = Parser.buildFijosFromAging(aging);
    const existing = Storage.getRows();
    const prevById = new Map(existing.filter(r => r.tipoPago === 'Fijo').map(r => [r.id, r]));
    const provisionales = existing.filter(r => r.tipoPago !== 'Fijo');
    const fijosFinal = nuevosFijos.map(r => {
      const prev = prevById.get(r.id);
      if(!prev) return r;
      const merged = { ...r, estado: prev.estado, _editedFields: prev._editedFields || [] };
      merged._editedFields.forEach(f => { merged[f] = prev[f]; });
      return merged;
    });

    Storage.saveRows([...fijosFinal, ...provisionales]);
    load();
    return { ok:true, total: fijosFinal.length };
  }

  // ------ Edición inline: Suplidor, Concepto, Monto y Fechas (cualquier fila) ------
  // Para Pagos Fijos, el campo editado queda marcado en _editedFields y se
  // preserva en cada resync desde Antigüedad de Saldo (ver syncFijosFromAging).
  function updateField(id, field, rawValue){
    const row = _rows.find(r => r.id === id);
    if(!row) return;
    const patch = {};
    const editedFields = new Set(row._editedFields || []);

    if(field === 'proveedor'){
      const v = String(rawValue||'').trim();
      if(!v){ UI.toast('El suplidor no puede quedar vacío', 'err'); _renderTable(); return; }
      patch.proveedor = v;
      editedFields.add('proveedor');
    } else if(field === 'detalle'){
      const v = String(rawValue||'').trim();
      if(!v){ UI.toast('El concepto no puede quedar vacío', 'err'); _renderTable(); return; }
      patch.detalle = v;
      editedFields.add('detalle');
    } else if(field === 'saldoPendiente'){
      const monto = parseFloat(rawValue) || 0;
      if(monto <= 0){ UI.toast('El monto debe ser mayor a 0', 'err'); _renderTable(); return; }
      patch.montoTotal = monto;
      patch.saldoPendiente = monto;
      editedFields.add('montoTotal');
      editedFields.add('saldoPendiente');
    } else if(field === 'fecha' || field === 'fechaVencimiento'){
      const v = String(rawValue||'').trim();
      if(!v){ UI.toast('La fecha no puede quedar vacía', 'err'); _renderTable(); return; }
      patch[field] = v;
      editedFields.add(field);
    } else {
      return;
    }

    patch._editedFields = Array.from(editedFields);
    Storage.updateRow(id, patch);
    load();
    _renderTable();
    _renderKPIs();
  }

  // ------ Pagos Provisionales: importación de Excel (upsert por llave natural) ------
  function importProvisionalFile(file){
    return Parser.parseProvisionalFile(file).then(result => {
      const existing = Storage.getRows();
      const byKey = new Map(existing.map(r => [Parser.rowKey(r), r]));
      let added = 0, updated = 0;
      result.rows.forEach(nr => {
        const key = Parser.rowKey(nr);
        const prev = byKey.get(key);
        if(prev){
          Object.assign(prev, { ...nr, id:prev.id, estado:prev.estado, tipoPago:'Provisional' }); // conserva id y Estado local
          updated++;
        } else {
          byKey.set(key, nr);
          added++;
        }
      });
      const merged = Array.from(byKey.values());
      Storage.saveRows(merged);
      load();
      return { added, updated, total: merged.length, errors: result.errors || [] };
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
      tbody.innerHTML = `<tr><td colspan="12"><div class="t-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="32" height="32"><path d="M7 3h8l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M9 12h6M9 16h6M9 8h3"/></svg>
        <div>${_rows.length===0 ? 'Aún no hay datos. Los Pagos Fijos se sincronizan automáticamente desde Antigüedad de Saldo, o importa/agrega Pagos Provisionales.' : 'No hay facturas que coincidan con los filtros.'}</div>
      </div></td></tr>`;
    } else {
      tbody.innerHTML = pageRows.map(r => {
        const dv = _diasVencimiento(r);
        const vencida = _isVencida(r);
        const estadoCls = r.estado === 'Pagada' ? 'ok' : r.estado === 'Pagar' ? 'blue' : (vencida ? 'red' : 'warn');
        const tipoPago = r.tipoPago || 'Provisional';
        return `<tr>
          <td class="c"><input type="checkbox" class="chk" ${_selected.has(r.id)?'checked':''} onchange="DataModule.toggleSelect('${r.id}')"></td>
          <td><input type="text" class="input cxp-inline-input" value="${Utils.escapeHtml(r.proveedor)}"
                onblur="DataModule.updateField('${r.id}','proveedor', this.value)"
                onkeydown="if(event.key==='Enter')this.blur()"></td>
          <td class="mono" style="font-size:11.5px;">${Utils.escapeHtml(r.numeroFactura||'—')}</td>
          <td><input type="date" class="input cxp-inline-input" value="${r.fecha||''}"
                onchange="DataModule.updateField('${r.id}','fecha', this.value)"></td>
          <td><input type="date" class="input cxp-inline-input" value="${r.fechaVencimiento||''}"
                onchange="DataModule.updateField('${r.id}','fechaVencimiento', this.value)"></td>
          <td style="max-width:260px;"><input type="text" class="input cxp-inline-input" value="${Utils.escapeHtml(r.detalle)}" title="${Utils.escapeHtml(r.detalle)}"
                onblur="DataModule.updateField('${r.id}','detalle', this.value)"
                onkeydown="if(event.key==='Enter')this.blur()"></td>
          <td class="c">${Utils.escapeHtml(r.moneda)}</td>
          <td class="r"><input type="number" class="input cxp-inline-input r" step="0.01" min="0" value="${r.saldoPendiente}"
                onblur="DataModule.updateField('${r.id}','saldoPendiente', this.value)"
                onkeydown="if(event.key==='Enter')this.blur()"></td>
          <td class="c">${dv===null?'—':(vencida?`<span class="pill red">${dv}d</span>`:dv+'d')}</td>
          <td class="c">
            <select class="input data-status-sel" onchange="DataModule.updateEstado('${r.id}', this.value)">
              <option value="Pendiente" ${r.estado==='Pendiente'?'selected':''}>Pendiente</option>
              <option value="Pagar" ${r.estado==='Pagar'?'selected':''}>Pagar</option>
              <option value="Pagada" ${r.estado==='Pagada'?'selected':''}>Pagada</option>
            </select>
          </td>
          <td class="c"><span class="pill ${tipoPago==='Fijo'?'blue':'warn'}">${tipoPago}</span></td>
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

  // ------ Agregar Provisión manual al Reporte (no afecta Antigüedad de Saldo) ------
  function abrirModalAgregarProvision(){
    const hoy = Utils.todayISO();
    document.getElementById('cxpMiProveedor').value  = '';
    document.getElementById('cxpMiFactura').value    = '';
    document.getElementById('cxpMiDetalle').value    = '';
    document.getElementById('cxpMiMonto').value      = '';
    document.getElementById('cxpMiMoneda').value     = 'RD$';
    document.getElementById('cxpMiFecha').value      = hoy;
    document.getElementById('cxpMiVencimiento').value = hoy;
    const obs = document.getElementById('cxpMiObservaciones');
    if(obs) obs.value = '';
    UI.openModal('modalAgregarCXP');
    setTimeout(() => document.getElementById('cxpMiProveedor')?.focus(), 120);
  }

  function submitAgregarProvision(){
    const proveedor      = (document.getElementById('cxpMiProveedor')?.value      || '').trim();
    const numeroFactura  = (document.getElementById('cxpMiFactura')?.value        || '').trim();
    const detalle        = (document.getElementById('cxpMiDetalle')?.value        || '').trim();
    const monto          = parseFloat(document.getElementById('cxpMiMonto')?.value) || 0;
    const moneda         = document.getElementById('cxpMiMoneda')?.value          || 'RD$';
    const fecha          = document.getElementById('cxpMiFecha')?.value           || Utils.todayISO();
    const fechaVenc      = document.getElementById('cxpMiVencimiento')?.value     || fecha;
    const observaciones  = (document.getElementById('cxpMiObservaciones')?.value  || '').trim();

    if(!proveedor){ UI.toast('El suplidor es requerido', 'err'); document.getElementById('cxpMiProveedor')?.focus(); return; }
    if(!detalle)  { UI.toast('El concepto es requerido', 'err'); document.getElementById('cxpMiDetalle')?.focus();   return; }
    if(monto <= 0){ UI.toast('El monto debe ser mayor a 0', 'err'); document.getElementById('cxpMiMonto')?.focus(); return; }

    const fila = {
      id:               Utils.uid('prov'),
      tipoPago:         'Provisional',
      empresa:          Storage.getSettings().empresa?.nombre || 'Gstar Services',
      proveedor,
      numeroFactura,
      fecha,
      fechaVencimiento: fechaVenc,
      detalle,
      moneda,
      montoTotal:       monto,
      montoPagado:      0,
      saldoPendiente:   monto,
      estado:           'Pendiente',
      observaciones
    };

    const list = Storage.getRows();
    list.unshift(fila);
    Storage.saveRows(list);
    load();
    UI.closeModal('modalAgregarCXP');
    render();
    UI.toast(`Provisión de ${proveedor} agregada`, 'ok');
  }

  return {
    render, load, syncFijosFromAging, importProvisionalFile, setFilter, setSort, goPage,
    toggleSelect, selectAllVisible, clearSelection, getSelectedRows, getSelectedCount,
    updateEstado, updateField, deleteRow, abrirModalAgregarProvision, submitAgregarProvision
  };
})();
