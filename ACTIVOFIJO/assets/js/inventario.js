/* ============================================================
   Inventario — pantalla principal: indicadores, filtros, tabla y paginación.
   Todo se calcula sobre los activos COMPLETOS guardados (no solo la página
   visible): los filtros, los indicadores y las exportaciones ven el inventario entero.
   ============================================================ */
const Inventario = (() => {

  const esc = Utils.escapeHtml;
  const money = v => (v === null || v === undefined) ? '—' : Utils.fmtMoney(v);
  const fecha = v => v ? Utils.fmtDate(v) : '—';
  const txt = v => (v === null || v === undefined || v === '') ? '—' : esc(v);

  // Columnas: base = visibles de entrada; el resto se activa desde "Columnas"
  const COLS = [
    { k:'numero',            t:'No. activo',          base:true,  get:r => r.a.numero, fmt:r => '<b>' + txt(r.a.numero) + '</b>', filtro:true, tipo:'num' },
    { k:'descripcion',       t:'Descripción',         base:true,  get:r => r.a.descripcion, fmt:r => '<span class="af-desc" title="' + esc(r.a.descripcion || '') + '">' + txt(r.a.descripcion) + '</span>', filtro:true },
    { k:'proveedor',         t:'Proveedor',           base:true,  get:r => r.a.proveedor, fmt:r => txt(r.a.proveedor), filtro:true },
    { k:'referencia',        t:'Referencia / serial', base:true,  get:r => r.a.referencia, fmt:r => txt(r.a.referencia), filtro:true },
    { k:'ubicacion',         t:'Ubicación',           base:true,  get:r => r.a.ubicacion, fmt:r => txt(r.a.ubicacion), filtro:true },
    { k:'fechaAdquisicion',  t:'F. adquisición',      base:true,  get:r => r.a.fechaAdquisicion, fmt:r => fecha(r.a.fechaAdquisicion), tipo:'fecha' },
    { k:'valorAdquisicion',  t:'Valor adquisición',   base:true,  get:r => r.a.valorAdquisicion, fmt:r => money(r.a.valorAdquisicion), tipo:'num', der:true },
    { k:'amAcumulada',       t:'Dep. acumulada',      base:true,  get:r => r.v ? r.v.amAcumulada : null, fmt:r => money(r.v && r.v.amAcumulada), tipo:'num', der:true },
    { k:'pendiente',         t:'Valor pendiente',     base:true,  get:r => r.v ? r.v.pendiente : null, fmt:r => money(r.v && r.v.pendiente), tipo:'num', der:true },
    { k:'gastoPeriodo',      t:'Dep. del período',    base:true,  get:r => r.v ? r.v.gastoPeriodo : null, fmt:r => money(r.v && r.v.gastoPeriodo), tipo:'num', der:true },
    { k:'estado',            t:'Estado',              base:true,  get:r => r.estado, fmt:r => pillEstado(r.estado) },
    { k:'inicioDepreciacion',t:'Inicio dep.',         base:false, get:r => r.a.inicioDepreciacion, fmt:r => fecha(r.a.inicioDepreciacion), tipo:'fecha' },
    { k:'finDepreciacion',   t:'Fin dep. (calculado)',base:false, get:r => r.a.finDepreciacion, fmt:r => fecha(r.a.finDepreciacion), tipo:'fecha' },
    { k:'mesesDepreciados',  t:'Meses deprec.',       base:false, get:r => r.v ? r.v.mesesDepreciados : null, fmt:r => (r.v && r.v.mesesDepreciados !== null) ? (Math.round(r.v.mesesDepreciados * 10) / 10) : '—', tipo:'num', der:true },
    { k:'depMensual',        t:'Dep. mensual',        base:false, get:r => r.v ? r.v.depMensual : null, fmt:r => money(r.v && r.v.depMensual), tipo:'num', der:true },
    { k:'categoria',         t:'Categoría',           base:false, get:r => r.categoria, fmt:r => txt(r.categoria) },
    { k:'cuentaActivo',      t:'Cuenta activo',       base:false, get:r => r.a.cuentaActivo, fmt:r => txt(r.a.cuentaActivo) },
    { k:'cuentaDepAcum',     t:'Cuenta dep. acum.',   base:false, get:r => r.a.cuentaDepAcum, fmt:r => txt(r.a.cuentaDepAcum) },
    { k:'cuentaGasto',       t:'Cuenta gasto',        base:false, get:r => r.a.cuentaGasto, fmt:r => txt(r.a.cuentaGasto) }
  ];
  const BASE = COLS.filter(c => c.base).map(c => c.k);

  const ESTADOS = ['En depreciación', 'Totalmente depreciado', 'Retirado', 'Pendiente de revisión', 'Inactivo'];
  function pillEstado(e){
    const cls = { 'En depreciación':'blue', 'Totalmente depreciado':'ok', 'Retirado':'gray', 'Pendiente de revisión':'warn', 'Inactivo':'gray' }[e] || 'gray';
    return '<span class="pill ' + cls + '"><span class="pill-dot"></span>' + esc(e) + '</span>';
  }

  const F0 = { q:'', estado:'', ubicacion:'', categoria:'', cuenta:'', adqDesde:'', adqHasta:'', valMin:'', valMax:'', depDesde:'', depHasta:'', inactivos:false, col:{} };
  let _f = JSON.parse(JSON.stringify(F0));
  let _sort = { k:'numero', dir:1 };
  let _page = 1, _size = 50;
  let _cols = BASE.slice();
  let _rows = [];                 // todas las filas (activos + importes del período)

  function init(){
    try{ const c = JSON.parse(localStorage.getItem('afColumnas') || 'null'); if(Array.isArray(c) && c.length) _cols = c.filter(k => COLS.some(x => x.k === k)); }catch(e){}
    try{ const s = parseInt(localStorage.getItem('afPageSize') || '50', 10); if([25,50,100].indexOf(s) !== -1) _size = s; }catch(e){}
    document.getElementById('fPageSize').value = String(_size);
  }

  // ---------- filtros ----------
  const norm = s => Utils.normalize(s);
  function _pasa(r){
    const a = r.a, f = _f;
    if(!f.inactivos && r.estado === 'Inactivo') return false;
    if(f.estado && r.estado !== f.estado) return false;
    if(f.ubicacion && (a.ubicacion || '') !== f.ubicacion) return false;
    if(f.categoria && r.categoria !== f.categoria) return false;
    if(f.cuenta && [a.cuentaActivo, a.cuentaDepAcum, a.cuentaGasto].indexOf(f.cuenta) === -1) return false;
    if(f.adqDesde && (!a.fechaAdquisicion || a.fechaAdquisicion < f.adqDesde)) return false;
    if(f.adqHasta && (!a.fechaAdquisicion || a.fechaAdquisicion > f.adqHasta)) return false;
    if(f.depDesde && (!a.inicioDepreciacion || a.inicioDepreciacion < f.depDesde)) return false;
    if(f.depHasta && (!a.inicioDepreciacion || a.inicioDepreciacion > f.depHasta)) return false;
    if(f.valMin !== '' && !(Number(a.valorAdquisicion) >= Number(f.valMin))) return false;
    if(f.valMax !== '' && !(Number(a.valorAdquisicion) <= Number(f.valMax))) return false;
    for(const k of Object.keys(f.col)){
      const v = f.col[k]; if(!v) continue;
      const c = COLS.find(x => x.k === k); const val = c ? c.get(r) : '';
      if(norm(val === null || val === undefined ? '' : val).indexOf(norm(v)) === -1) return false;
    }
    if(f.q){
      const hay = norm([a.numero, a.descripcion, a.proveedor, a.referencia, a.ubicacion, a.cuentaActivo, a.cuentaDepAcum, a.cuentaGasto, r.categoria].join(' '));
      if(hay.indexOf(norm(f.q)) === -1) return false;
    }
    return true;
  }
  function _ordenar(list){
    const c = COLS.find(x => x.k === _sort.k) || COLS[0];
    return list.slice().sort((x, y) => {
      let a = c.get(x), b = c.get(y);
      const na = (a === null || a === undefined || a === ''), nb = (b === null || b === undefined || b === '');
      if(na && nb) return 0; if(na) return 1; if(nb) return -1;               // vacíos siempre al final
      if(typeof a === 'number' && typeof b === 'number') return (a - b) * _sort.dir;
      return String(a).localeCompare(String(b), 'es', { numeric:true }) * _sort.dir;
    });
  }
  function getFiltrado(){ return _ordenar(_rows.filter(_pasa)); }

  // Texto de los filtros activos (para encabezados de reportes/exportaciones)
  function describeFiltros(){
    const p = [], f = _f;
    if(f.q) p.push('Búsqueda: "' + f.q + '"');
    if(f.estado) p.push('Estado: ' + f.estado);
    if(f.ubicacion) p.push('Ubicación: ' + f.ubicacion);
    if(f.categoria) p.push('Categoría: ' + f.categoria);
    if(f.cuenta) p.push('Cuenta: ' + f.cuenta);
    if(f.adqDesde || f.adqHasta) p.push('F. adquisición: ' + (f.adqDesde ? Utils.fmtDate(f.adqDesde) : '…') + ' a ' + (f.adqHasta ? Utils.fmtDate(f.adqHasta) : '…'));
    if(f.depDesde || f.depHasta) p.push('Inicio depreciación: ' + (f.depDesde ? Utils.fmtDate(f.depDesde) : '…') + ' a ' + (f.depHasta ? Utils.fmtDate(f.depHasta) : '…'));
    if(f.valMin !== '' || f.valMax !== '') p.push('Valor adquisición: ' + (f.valMin !== '' ? Utils.fmtMoney(f.valMin) : '…') + ' a ' + (f.valMax !== '' ? Utils.fmtMoney(f.valMax) : '…'));
    Object.keys(f.col).forEach(k => { if(f.col[k]){ const c = COLS.find(x => x.k === k); p.push((c ? c.t : k) + ' contiene "' + f.col[k] + '"'); } });
    if(f.inactivos) p.push('Incluye inactivos');
    return p.length ? p.join(' · ') : 'Sin filtros (inventario completo)';
  }

  // ---------- entradas de la interfaz ----------
  function setF(k, v){ _f[k] = v; _page = 1; _pintar(); }
  function setColF(k, v){ _f.col[k] = v; _page = 1; _pintar(true); }
  function limpiar(){
    _f = JSON.parse(JSON.stringify(F0)); _page = 1;
    ['fBuscar','fEstado','fUbicacion','fCategoria','fCuenta','fAdqDesde','fAdqHasta','fValMin','fValMax','fDepDesde','fDepHasta'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
    const ch = document.getElementById('fInactivos'); if(ch) ch.checked = false;
    _pintar();
  }
  function sortBy(k){ if(_sort.k === k) _sort.dir *= -1; else { _sort.k = k; _sort.dir = 1; } _pintar(); }
  function goPage(p){ _page = p; _pintar(true); }
  function setSize(n){ _size = parseInt(n, 10) || 50; _page = 1; try{ localStorage.setItem('afPageSize', String(_size)); }catch(e){} _pintar(true); }
  function setPeriodo(p){ Datos.setPeriodo(p); render(); }

  // ---------- columnas visibles ----------
  function abrirColumnas(){
    document.getElementById('colList').innerHTML = COLS.map(c => '<label style="display:flex;align-items:center;gap:10px;padding:6px 2px;font-size:13px"><input type="checkbox" class="chk col-chk" data-k="' + c.k + '"' + (_cols.indexOf(c.k) !== -1 ? ' checked' : '') + '> ' + esc(c.t) + '</label>').join('');
    UI.openModal('modalColumnas');
  }
  function aplicarColumnas(){
    const sel = [...document.querySelectorAll('.col-chk')].filter(c => c.checked).map(c => c.dataset.k);
    if(!sel.length){ UI.toast('Deja al menos una columna visible', 'err'); return; }
    _cols = COLS.map(c => c.k).filter(k => sel.indexOf(k) !== -1);
    try{ localStorage.setItem('afColumnas', JSON.stringify(_cols)); }catch(e){}
    UI.closeModal('modalColumnas'); _pintar();
  }
  function columnasBase(){ _cols = BASE.slice(); try{ localStorage.removeItem('afColumnas'); }catch(e){} UI.closeModal('modalColumnas'); _pintar(); }

  // ---------- pintado ----------
  function _llenarSelects(){
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es'));
    const fill = (id, vals, todos) => {
      const el = document.getElementById(id); if(!el) return; const cur = el.value;
      el.innerHTML = '<option value="">' + todos + '</option>' + vals.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
      el.value = vals.indexOf(cur) !== -1 ? cur : '';
    };
    fill('fUbicacion', uniq(_rows.map(r => r.a.ubicacion)), 'Todas las ubicaciones');
    fill('fCategoria', uniq(_rows.map(r => r.categoria)), 'Todas las categorías');
    fill('fCuenta', uniq([].concat(..._rows.map(r => [r.a.cuentaActivo, r.a.cuentaDepAcum, r.a.cuentaGasto]))), 'Todas las cuentas');
    const e = document.getElementById('fEstado'); if(e){ const cur = e.value; e.innerHTML = '<option value="">Todos los estados</option>' + ESTADOS.map(s => '<option>' + s + '</option>').join(''); e.value = cur; }
  }

  function _kpis(list){
    const hay = _rows.length > 0 && Datos.periodo();
    const t = Datos.totales(list);
    const set = (id, v, sub) => { const el = document.getElementById(id); if(el) el.textContent = v; const s = document.getElementById(id + 'Sub'); if(s && sub !== undefined) s.textContent = sub; };
    const per = Datos.periodo();
    const corte = Datos.fechaCorte(per);
    if(!hay){
      ['kTotal','kCosto','kAcum','kPend','kGasto','kRetirados'].forEach(id => set(id, '—', 'Sin datos importados'));
      return;
    }
    set('kTotal', t.total.toLocaleString('es-DO'), t.enDep + ' en depreciación · ' + t.totalDep + ' totalmente depreciados · ' + t.revision + ' en revisión');
    set('kCosto', Utils.fmtMoney(t.costo), 'Suma de valores de adquisición (excluye retirados e inactivos)');
    set('kAcum', Utils.fmtMoney(t.acumulada), 'Registrada al corte ' + (corte ? Utils.fmtDate(corte) : Datos.etiquetaPeriodo(per)));
    set('kPend', Utils.fmtMoney(t.pendiente), 'Importe pendiente de depreciar');
    set('kGasto', Utils.fmtMoney(t.gasto), 'Gasto del período ' + Datos.etiquetaPeriodo(per));
    set('kRetirados', String(t.retirados), 'Activos con fecha de retiro registrada');
  }

  function _pintar(soloTabla){
    const list = getFiltrado();
    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / _size));
    if(_page > pages) _page = pages;
    const slice = list.slice((_page - 1) * _size, _page * _size);
    const cols = COLS.filter(c => _cols.indexOf(c.k) !== -1);

    _kpis(_rows.filter(_pasa));
    // El encabezado (con los filtros por columna) solo se redibuja cuando cambia el orden o las columnas:
    // si se rehiciera al escribir, el cuadro de texto perdería el foco en cada letra.
    if(!soloTabla){
    const thead = '<tr>' + cols.map(c => '<th class="' + (c.der ? 'r' : '') + ' af-th" onclick="Inventario.sortBy(\'' + c.k + '\')">' + esc(c.t) + (_sort.k === c.k ? (_sort.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>').join('') + '<th class="c">Acciones</th></tr>'
      + '<tr class="af-filtros">' + cols.map(c => '<th>' + (c.filtro ? '<input type="text" class="input af-fi" placeholder="Filtrar…" value="' + esc(_f.col[c.k] || '') + '" oninput="Inventario.setColF(\'' + c.k + '\', this.value)" onclick="event.stopPropagation()">' : '') + '</th>').join('') + '<th></th></tr>';
    document.getElementById('afThead').innerHTML = thead;
    }

    const body = document.getElementById('afTbody');
    if(!_rows.length){
      body.innerHTML = '<tr><td colspan="' + (cols.length + 1) + '" class="t-empty" style="text-align:center;padding:46px">Aún no se ha importado ningún corte de activos fijos.' + (Permisos.esAdmin() ? '<br><button class="btn btn-accent" style="margin-top:12px" onclick="Importador.abrir()">Importar corte</button>' : '<br>Un administrador debe importar el archivo.') + '</td></tr>';
    }else if(!slice.length){
      body.innerHTML = '<tr><td colspan="' + (cols.length + 1) + '" class="t-empty" style="text-align:center;padding:40px">No hay activos que coincidan con los filtros. <a href="#" onclick="Inventario.limpiar();return false;">Limpiar filtros</a></td></tr>';
    }else{
      body.innerHTML = slice.map(r => '<tr class="row-clickable" onclick="Ficha.abrir(\'' + Utils.jsAttr(r.a.id) + '\')">'
        + cols.map(c => '<td class="' + (c.der ? 'r mono' : '') + '">' + c.fmt(r) + (c.k === 'numero' && r.a.numeroOrigen === 'asignado' ? ' <span class="af-asig" title="Número asignado por el sistema: no existe en el Excel">*</span>' : '') + '</td>').join('')
        + '<td class="c"><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();Ficha.abrir(\'' + Utils.jsAttr(r.a.id) + '\')">Ver</button></td></tr>').join('');
    }
    document.getElementById('afPag').innerHTML = total
      ? '<button class="btn btn-ghost btn-sm" ' + (_page <= 1 ? 'disabled' : '') + ' onclick="Inventario.goPage(' + (_page - 1) + ')">‹ Anterior</button>'
        + '<span class="sub" style="margin:0 10px">Página ' + _page + ' de ' + pages + ' · ' + total.toLocaleString('es-DO') + ' activo(s)</span>'
        + '<button class="btn btn-ghost btn-sm" ' + (_page >= pages ? 'disabled' : '') + ' onclick="Inventario.goPage(' + (_page + 1) + ')">Siguiente ›</button>'
      : '';
    document.getElementById('afCuenta').textContent = _rows.length ? (total.toLocaleString('es-DO') + ' de ' + _rows.length.toLocaleString('es-DO') + ' activos') : '';
  }

  // ---------- render completo ----------
  function render(){
    const per = Datos.periodo();
    _rows = Datos.todas(per);
    // selector de período
    const sel = document.getElementById('afPeriodo');
    const ps = Datos.periodos();
    sel.innerHTML = ps.length ? ps.map(p => '<option value="' + p + '"' + (p === per ? ' selected' : '') + '>Período ' + Datos.etiquetaPeriodo(p) + '</option>').join('') : '<option value="">Sin períodos</option>';
    // fecha de actualización de los datos
    const imps = Storage.getImportaciones();
    const ult = imps.length ? imps[imps.length - 1] : null;
    document.getElementById('afActualizado').textContent = ult ? new Date(ult.importadoEn).toLocaleString('es-DO') : '—';
    const corte = Datos.fechaCorte(per);
    document.getElementById('afCorte').textContent = corte ? Utils.fmtDate(corte) : '—';
    _llenarSelects();
    _pintar();
  }

  return { init, render, setF, setColF, limpiar, sortBy, goPage, setSize, setPeriodo, getFiltrado, describeFiltros,
           abrirColumnas, aplicarColumnas, columnasBase, COLS, ESTADOS, pillEstado, filas: () => _rows };
})();
window.Inventario = Inventario;
