/* ============================================================
   Cargar — importa el reporte "MOVIMIENTOS RAPID RESUMIDO" de ORKAPI.

   Formato real (verificado con VENTAS JV ORKAPI.xlsx):
     - Encabezado del reporte: DESDE / HASTA (período) y PRODUCTO.
     - Tabla: Item | Consorcios | Ventas Netas | Pagos | Cargo | Total Bruto
       Un renglón por consorcio, ej. "(02) UD ALEX". Pagos viene NEGATIVO.
       Total Bruto = Ventas Netas + Pagos (Cargo viene en 0).
     - Última fila: "TOTAL MONTOS".
     - NO existe un ID de venta: la clave única de una fila es
       período(desde|hasta) + código del consorcio (el "(02)").

   Seguridad de la importación:
     - Todo el lote (con sus filas) se guarda en UNA sola clave de Supabase
       (jv_lotes) => o queda completo o no queda.
     - Si no se puede confirmar la escritura en Supabase, se revierte el
       cambio local y se avisa (no quedan datos "a medias").
     - Doble clic bloqueado (_busy) y se re-validan duplicados contra la
       versión más reciente de Supabase justo antes de guardar.
   ============================================================ */
const Cargar = (() => {

  const COLS = {
    consorcio:  ['CONSORCIOS', 'CONSORCIO'],
    ventas:     ['VENTAS NETAS'],
    pagos:      ['PAGOS'],
    total:      ['TOTAL BRUTO'],
    cargo:      ['CARGO'],      // opcional
    item:       ['ITEM']        // opcional
  };
  const REQUERIDAS = [['consorcio', 'Consorcios'], ['ventas', 'Ventas Netas'], ['pagos', 'Pagos'], ['total', 'Total Bruto']];

  let _p = null;       // resultado del análisis del archivo actual
  let _busy = false;

  const _n = s => Utils.normalize(String(s == null ? '' : s));
  const money = v => Utils.fmtNum(v);

  // ---------- lectura ----------
  function handleFile(input){
    const file = input.files && input.files[0];
    if(!file) return;
    input.value = '';
    if(!/\.xlsx?$/i.test(file.name)){ UI.toast('Solo se aceptan archivos .xlsx o .xls', 'err'); return; }
    UI.toast('Leyendo archivo…', 'ok');
    const reader = new FileReader();
    reader.onerror = () => UI.toast('No se pudo leer el archivo', 'err');
    reader.onload = async () => {
      try{
        const buf = reader.result;
        const hash = await Utils.sha256Hex(buf);
        const wb = XLSX.read(buf, { type:'array', cellDates:true });
        analizar(wb, file.name, hash);
      }catch(err){
        console.error(err);
        UI.toast('Error al leer el archivo: ' + err.message, 'err');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // Busca, en TODAS las hojas, la que contiene la tabla de ventas ORKAPI.
  function _localizarTabla(wb){
    let mejor = null;
    wb.SheetNames.forEach(name => {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, defval:'', raw:true });
      for(let r = 0; r < Math.min(aoa.length, 40); r++){
        const celdas = (aoa[r] || []).map(_n);
        const idx = {};
        Object.keys(COLS).forEach(k => {
          const i = celdas.findIndex(c => COLS[k].indexOf(c) !== -1);
          if(i !== -1) idx[k] = i;
        });
        const aciertos = REQUERIDAS.filter(([k]) => idx[k] !== undefined).length;
        if(aciertos >= 2 && (!mejor || aciertos > mejor.aciertos)){
          mejor = { name, aoa, headerRow: r, idx, aciertos };
        }
      }
    });
    return mejor;
  }

  function _leerFecha(v){
    if(v instanceof Date) return Utils.excelDateToISO(v);
    // número de serie de Excel (años 2000–2099): algunos .xls guardan las fechas sin formato de fecha
    if(typeof v === 'number' && v >= 36526 && v <= 73050) return Utils.excelDateToISO(v);
    if(typeof v === 'string' && /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$|^\d{4}-\d{2}-\d{2}/.test(v.trim())) return Utils.excelDateToISO(v);
    return '';
  }

  // Período DESDE/HASTA: se busca por etiqueta (a la derecha o debajo de la
  // etiqueta); si el diseño es "etiquetas arriba, fechas abajo" (como el
  // archivo de ejemplo) se asignan en orden de aparición.
  function _leerPeriodo(aoa, headerRow){
    const filas = aoa.slice(0, headerRow);
    const out = { desde:'', hasta:'', producto:'' };
    const etiquetas = [];
    const fechas = [];
    filas.forEach((row, r) => (row || []).forEach((v, c) => {
      const t = _n(v);
      if(t === 'DESDE' || t === 'HASTA' || t === 'PRODUCTO') etiquetas.push({ t, r, c });
      const f = _leerFecha(v);
      if(f) fechas.push({ f, r, c });
    }));
    // 1) fecha pegada a la etiqueta (derecha o abajo inmediato)
    etiquetas.filter(e => e.t !== 'PRODUCTO').forEach(e => {
      const der = _leerFecha((filas[e.r] || [])[e.c + 1]);
      const aba = _leerFecha((filas[e.r + 1] || [])[e.c]);
      const val = der || aba;
      if(val) out[e.t === 'DESDE' ? 'desde' : 'hasta'] = val;
    });
    // 2) por orden de aparición (etiquetas listadas primero, fechas después)
    if(!out.desde || !out.hasta){
      const ord = etiquetas.filter(e => e.t !== 'PRODUCTO').map(e => e.t);
      if(ord.length && ord.length === fechas.length){
        ord.forEach((t, i) => { out[t === 'DESDE' ? 'desde' : 'hasta'] = fechas[i].f; });
      }
    }
    const ep = etiquetas.find(e => e.t === 'PRODUCTO');
    if(ep){
      const der = String((filas[ep.r] || [])[ep.c + 1] || '').trim();
      const aba = String((filas[ep.r + 1] || [])[ep.c] || '').trim();
      out.producto = der || aba;
    }
    return out;
  }

  function analizar(wb, archivo, hash){
    const errores = [];      // bloquean la importación
    const avisos = [];       // informativos
    const tabla = _localizarTabla(wb);

    _p = { archivo, hash, hoja: '', desde:'', hasta:'', periodoDetectado:false, producto:'',
           filas: [], errores, avisos, totalesArchivo: null, sumas: null,
           dup: { archivo:null, mismoPeriodo:null, solapa:[] } };

    if(!tabla){
      errores.push('No se encontró ninguna hoja con la tabla de ventas ORKAPI (columnas Consorcios, Ventas Netas, Pagos, Total Bruto).');
      return _render();
    }
    _p.hoja = tabla.name;
    const faltan = REQUERIDAS.filter(([k]) => tabla.idx[k] === undefined).map(([, n]) => n);
    if(faltan.length){
      errores.push('Faltan columnas obligatorias en la hoja "' + tabla.name + '": ' + faltan.join(', ') + '.');
      return _render();
    }

    // período
    const per = _leerPeriodo(tabla.aoa, tabla.headerRow);
    _p.desde = per.desde; _p.hasta = per.hasta; _p.producto = per.producto;
    _p.periodoDetectado = !!(per.desde && per.hasta);

    // filas
    const { idx, aoa, headerRow } = tabla;
    const vistos = new Set();
    let totalFila = null;
    for(let r = headerRow + 1; r < aoa.length; r++){
      const row = aoa[r] || [];
      if(row.every(c => String(c == null ? '' : c).trim() === '')) continue;
      const primera = _n(row[0]);
      const consRaw = String(row[idx.consorcio] == null ? '' : row[idx.consorcio]).trim();
      if(primera.indexOf('TOTAL') === 0 || _n(consRaw).indexOf('TOTAL') === 0){
        totalFila = {
          ventasNetas: Utils.parseNumber(row[idx.ventas], true),
          pagos: Utils.parseNumber(row[idx.pagos], true),
          cargo: idx.cargo !== undefined ? Utils.parseNumber(row[idx.cargo], true) : 0,
          totalBruto: Utils.parseNumber(row[idx.total], true)
        };
        break;
      }
      const m = consRaw.match(/^\((\d+)\)\s*(.+)$/);
      const f = {
        fila: r + 1,                                   // fila real en el Excel (1-based)
        item: idx.item !== undefined ? row[idx.item] : '',
        consorcio: consRaw,
        codigo: m ? m[1] : '',
        nombre: m ? m[2].trim() : consRaw,
        ventasNetas: Utils.parseNumber(row[idx.ventas], false),
        pagos: Utils.parseNumber(row[idx.pagos], false),
        cargo: idx.cargo !== undefined ? Utils.parseNumber(row[idx.cargo], true) : 0,
        totalBruto: Utils.parseNumber(row[idx.total], false),
        errs: [], warns: []
      };
      if(!consRaw) f.errs.push('Consorcio vacío');
      if(f.ventasNetas === null) f.errs.push('Ventas Netas no es un número válido');
      if(f.pagos === null) f.errs.push('Pagos no es un número válido');
      if(f.cargo === null) f.errs.push('Cargo no es un número válido');
      if(f.totalBruto === null) f.errs.push('Total Bruto no es un número válido');
      if(!f.errs.length){
        if(f.ventasNetas < 0) f.errs.push('Ventas Netas negativas');
        if(f.pagos > 0) f.warns.push('Pagos viene positivo; se usará su valor absoluto');
        if(f.cargo !== 0) f.warns.push('Tiene Cargo (' + money(f.cargo) + '); la plantilla de factura no contempla cargos');
        else{
          const dif = Utils.round2(f.totalBruto - (f.ventasNetas + f.pagos));
          if(Math.abs(dif) > 0.01) f.errs.push('Total Bruto no coincide con Ventas Netas + Pagos (diferencia ' + money(dif) + ')');
        }
      }
      f.clave = (_p.desde || '?') + '|' + (_p.hasta || '?') + '|' + (f.codigo || _n(f.nombre));
      const kk = f.codigo || _n(f.nombre);
      if(kk && vistos.has(kk)) f.errs.push('Consorcio repetido dentro del mismo archivo');
      vistos.add(kk);
      _p.filas.push(f);
    }

    if(!_p.filas.length){
      errores.push('El archivo no contiene registros de ventas bajo el encabezado.');
      return _render();
    }

    // totales del archivo vs suma de renglones
    const validas = _p.filas.filter(f => !f.errs.length);
    const sum = k => Utils.round2(_p.filas.reduce((s, f) => s + (typeof f[k] === 'number' ? f[k] : 0), 0));
    _p.sumas = { ventasNetas: sum('ventasNetas'), pagos: sum('pagos'), cargo: sum('cargo'), totalBruto: sum('totalBruto') };
    if(totalFila){
      _p.totalesArchivo = totalFila;
      ['ventasNetas', 'pagos', 'cargo', 'totalBruto'].forEach(k => {
        if(totalFila[k] !== null && Math.abs(Utils.round2(totalFila[k]) - _p.sumas[k]) > 0.01){
          avisos.push('El total del archivo (' + k + ': ' + money(totalFila[k]) + ') no coincide con la suma de los renglones (' + money(_p.sumas[k]) + ').');
        }
      });
    }else{
      avisos.push('El archivo no trae la fila "TOTAL MONTOS"; no se pudo cuadrar el total.');
    }

    if(!validas.length) errores.push('Ningún renglón del archivo es válido.');
    _revisarPeriodo();
    _revisarDuplicados();
    _render();
  }

  function _revisarPeriodo(){
    // sólo errores de período (los duplicados se revisan aparte)
    _p.errores = _p.errores.filter(e => e.indexOf('período') === -1 && e.indexOf('Período') === -1);
    if(!_p.desde || !_p.hasta){
      _p.errores.push('No se detectó el período (DESDE / HASTA) en el archivo. Indícalo manualmente abajo.');
    }else if(_p.desde > _p.hasta){
      _p.errores.push('Período inválido: la fecha DESDE es posterior a HASTA.');
    }
  }

  // Compara contra los lotes ya guardados (usa la versión local más reciente)
  function _revisarDuplicados(){
    const activos = Storage.getLotesActivos();
    _p.dup = { archivo: null, mismoPeriodo: null, solapa: [] };
    _p.filas.forEach(f => { f.clave = (_p.desde || '?') + '|' + (_p.hasta || '?') + '|' + (f.codigo || _n(f.nombre)); f.dupDe = null; });
    _p.dup.archivo = activos.find(l => l.hash && l.hash === _p.hash) || null;
    if(_p.desde && _p.hasta){
      _p.dup.mismoPeriodo = activos.find(l => l.desde === _p.desde && l.hasta === _p.hasta) || null;
      _p.dup.solapa = activos.filter(l => !(l.desde === _p.desde && l.hasta === _p.hasta) && l.desde <= _p.hasta && l.hasta >= _p.desde);
      if(_p.dup.mismoPeriodo){
        const claves = new Set(_p.dup.mismoPeriodo.filas.map(x => x.clave));
        _p.filas.forEach(f => { if(claves.has(f.clave)) f.dupDe = _p.dup.mismoPeriodo.id; });
      }
    }
  }

  function setPeriodo(campo, valor){
    if(!_p) return;
    _p[campo] = valor;
    _revisarPeriodo();
    _revisarDuplicados();
    _render();
  }

  // ---------- resumen de la vista previa ----------
  function _resumen(){
    const rechazados = _p.filas.filter(f => f.errs.length).length;
    const duplicados = _p.filas.filter(f => !f.errs.length && f.dupDe).length;
    const nuevos = _p.filas.filter(f => !f.errs.length && !f.dupDe).length;
    return { rechazados, duplicados, nuevos, total: _p.filas.length };
  }

  // Estado de la acción: 'importar' | 'reemplazar' | 'bloqueado'
  function _accion(){
    if(_p.errores.length) return { modo:'bloqueado', motivo: _p.errores[0] };
    const validas = _p.filas.filter(f => !f.errs.length);
    if(!validas.length) return { modo:'bloqueado', motivo:'No hay renglones válidos.' };
    if(_p.dup.solapa.length){
      const l = _p.dup.solapa[0];
      return { modo:'bloqueado', motivo:'El período se superpone con el lote "' + l.archivo + '" (' + Utils.fmtDate(l.desde) + ' al ' + Utils.fmtDate(l.hasta) + '). Anula ese lote antes de cargar este período.' };
    }
    if(_p.dup.mismoPeriodo){
      const facs = _facturasVigentesDeLote(_p.dup.mismoPeriodo.id);
      if(facs.length) return { modo:'bloqueado', motivo:'Este período ya está cargado y tiene facturas vigentes (' + facs.map(f => f.numero).join(', ') + '). Anúlalas primero para poder reemplazarlo.' };
      return { modo:'reemplazar', lote: _p.dup.mismoPeriodo };
    }
    return { modo:'importar' };
  }

  function _facturasVigentesDeLote(loteId){
    return Storage.getFacturasVigentes().filter(f => f.loteId === loteId);
  }

  // ---------- render ----------
  function _render(){
    const wrap = document.getElementById('cgPreviewWrap');
    if(!_p){ wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    const res = _resumen();
    const acc = _accion();

    document.getElementById('cgArchivoNombre').textContent = _p.archivo;
    document.getElementById('cgArchivoMeta').textContent = _p.hoja ? ('Hoja: ' + _p.hoja + ' · ' + res.total + ' registro(s) detectado(s)') : 'No se pudo leer la tabla de ventas';

    // período
    const perBox = document.getElementById('cgPeriodo');
    if(_p.periodoDetectado && _p.desde && _p.hasta){
      perBox.innerHTML = '<b>' + Utils.fmtDate(_p.desde) + '</b> al <b>' + Utils.fmtDate(_p.hasta) + '</b>' + (_p.producto ? ' · Producto: ' + Utils.escapeHtml(_p.producto) : '');
    }else{
      perBox.innerHTML = '<div class="field-row" style="grid-template-columns:1fr 1fr;max-width:420px;margin:0">'
        + '<div class="field" style="margin:0"><label class="f-label">Desde</label><input type="date" class="input" value="' + (_p.desde || '') + '" onchange="Cargar.setPeriodo(\'desde\',this.value)"></div>'
        + '<div class="field" style="margin:0"><label class="f-label">Hasta</label><input type="date" class="input" value="' + (_p.hasta || '') + '" onchange="Cargar.setPeriodo(\'hasta\',this.value)"></div></div>';
    }

    // alertas
    const alertas = [];
    _p.errores.forEach(e => alertas.push('<div class="cc-alert danger">' + Utils.escapeHtml(e) + '</div>'));
    if(_p.dup.archivo) alertas.push('<div class="cc-alert warn">Este mismo archivo ya fue importado el ' + Utils.fmtDate(String(_p.dup.archivo.importadoEn).slice(0, 10)) + ' (lote "' + Utils.escapeHtml(_p.dup.archivo.archivo) + '").</div>');
    if(acc.modo === 'reemplazar') alertas.push('<div class="cc-alert warn">Ya existe un lote para este mismo período (' + Utils.escapeHtml(acc.lote.archivo) + ', importado el ' + Utils.fmtDate(String(acc.lote.importadoEn).slice(0, 10)) + '). Puedes <b>reemplazarlo</b> con el PIN de administrador; el lote anterior queda guardado como "Reemplazado".</div>');
    if(acc.modo === 'bloqueado' && !_p.errores.length) alertas.push('<div class="cc-alert danger">' + Utils.escapeHtml(acc.motivo) + '</div>');
    if(res.rechazados && !_p.errores.length) alertas.push('<div class="cc-alert warn">' + res.rechazados + ' renglón(es) rechazado(s) NO se importarán (ver motivo en la tabla). Si necesitas esos consorcios, corrige el Excel y vuelve a cargarlo antes de confirmar.</div>');
    _p.avisos.forEach(a => alertas.push('<div class="cc-alert warn">' + Utils.escapeHtml(a) + '</div>'));
    document.getElementById('cgAlertas').innerHTML = alertas.join('');

    // resumen
    document.getElementById('cgResumen').innerHTML =
      '<div class="kpi ok"><div class="lbl">Nuevos</div><div class="val">' + res.nuevos + '</div></div>'
      + '<div class="kpi"><div class="lbl">Duplicados</div><div class="val">' + res.duplicados + '</div></div>'
      + '<div class="kpi red"><div class="lbl">Rechazados</div><div class="val">' + res.rechazados + '</div></div>'
      + '<div class="kpi blue"><div class="lbl">Total Ventas Netas</div><div class="val" style="font-size:18px">' + money(_p.sumas ? _p.sumas.ventasNetas : 0) + '</div></div>';

    // tabla
    document.getElementById('cgPreviewBody').innerHTML = _p.filas.map(f => {
      let est;
      if(f.errs.length) est = '<span class="pill red"><span class="pill-dot"></span>Rechazado</span><div class="sub" style="font-size:11px">' + Utils.escapeHtml(f.errs.join(' · ')) + '</div>';
      else if(f.dupDe) est = '<span class="pill warn"><span class="pill-dot"></span>Duplicado</span>';
      else est = '<span class="pill ok"><span class="pill-dot"></span>Nuevo</span>' + (f.warns.length ? '<div class="sub" style="font-size:11px">' + Utils.escapeHtml(f.warns.join(' · ')) + '</div>' : '');
      const n = v => (typeof v === 'number' ? money(v) : '<span style="color:var(--danger)">—</span>');
      return '<tr><td class="c">' + Utils.escapeHtml(f.item) + '</td><td>' + Utils.escapeHtml(f.consorcio) + '</td>'
        + '<td class="r">' + n(f.ventasNetas) + '</td><td class="r">' + n(f.pagos) + '</td><td class="r">' + n(f.cargo) + '</td><td class="r">' + n(f.totalBruto) + '</td><td>' + est + '</td></tr>';
    }).join('');

    // botón
    const btn = document.getElementById('cgBtnConfirmar');
    btn.disabled = _busy || acc.modo === 'bloqueado';
    btn.textContent = acc.modo === 'reemplazar' ? 'Reemplazar lote existente (PIN)' : 'Confirmar importación';
    btn.className = 'btn ' + (acc.modo === 'reemplazar' ? 'btn-danger' : 'btn-primary');
  }

  function cancelar(){
    _p = null;
    _busy = false;
    _render();
  }

  // ---------- confirmación ----------
  function confirmar(){
    if(!_p || _busy) return;
    const acc = _accion();
    if(acc.modo === 'bloqueado'){ UI.toast(acc.motivo, 'err'); return; }
    if(acc.modo === 'reemplazar'){ UI.requirePin(() => _guardar(true)); return; }
    _guardar(false);
  }

  async function _guardar(reemplazar){
    if(_busy) return;
    _busy = true; _render();
    const previo = Storage.getLotes();      // para revertir si Supabase no confirma
    try{
      // Re-valida contra lo más reciente de Supabase (otro usuario pudo importar mientras tanto)
      if(window.Sync){ try{ await Sync.pull(); }catch(e){} }
      _revisarDuplicados();
      const acc = _accion();
      if(acc.modo === 'bloqueado'){ UI.toast(acc.motivo, 'err'); return; }
      if(acc.modo === 'reemplazar' && !reemplazar){ UI.toast('Otro usuario cargó este período mientras revisabas. Vuelve a confirmar.', 'err'); return; }

      const usuario = (window.Auth && Auth.getUser && Auth.getUser()) || {};
      const validas = _p.filas.filter(f => !f.errs.length);
      const rechazados = _p.filas.length - validas.length;
      const lote = {
        id: Utils.uid('lote'),
        archivo: _p.archivo, hash: _p.hash, hoja: _p.hoja,
        desde: _p.desde, hasta: _p.hasta, producto: _p.producto || '',
        importadoEn: new Date().toISOString(),
        importadoPor: usuario.name || usuario.email || '—',
        estado: 'Activo',
        reemplazaA: reemplazar ? acc.lote.id : null,
        rechazados,
        avisos: _p.avisos.slice(),
        filas: validas.map(f => ({
          id: Utils.uid('vta'),
          item: f.item, consorcio: f.consorcio, codigo: f.codigo, nombre: f.nombre,
          ventasNetas: f.ventasNetas, pagos: f.pagos, cargo: f.cargo, totalBruto: f.totalBruto,
          clave: f.clave
        })),
        totales: {
          ventasNetas: Utils.round2(validas.reduce((s, f) => s + f.ventasNetas, 0)),
          pagos: Utils.round2(validas.reduce((s, f) => s + f.pagos, 0)),
          cargo: Utils.round2(validas.reduce((s, f) => s + f.cargo, 0)),
          totalBruto: Utils.round2(validas.reduce((s, f) => s + f.totalBruto, 0))
        }
      };

      const lotes = Storage.getLotes().map(l => (reemplazar && l.id === acc.lote.id)
        ? { ...l, estado: 'Reemplazado', reemplazadoPor: lote.id, reemplazadoEn: lote.importadoEn }
        : l);
      lotes.push(lote);
      Storage.saveLotes(lotes);

      const r = window.Sync ? await Sync.pushNow(Storage.KEYS.LOTES) : { ok:false, reason:'no-sync' };
      if(!r.ok){
        Storage.saveLotes(previo);                   // revertir: nada queda a medias
        if(window.Sync) Sync.push(Storage.KEYS.LOTES, previo);
        UI.toast('No se pudo guardar en Supabase (' + r.reason + '). No se importó nada; intenta de nuevo.', 'err');
        return;
      }
      Storage.addAuditoria({
        usuarioNombre: usuario.name || usuario.email || '—', accion: reemplazar ? 'reemplazar_lote' : 'importar_lote',
        entidad: 'lote', entidadId: lote.id,
        detalle: { archivo: lote.archivo, desde: lote.desde, hasta: lote.hasta, guardados: validas.length, rechazados, reemplazaA: lote.reemplazaA }
      });
      UI.toast('Importación completada: ' + validas.length + ' registro(s) guardado(s)' + (rechazados ? ', ' + rechazados + ' rechazado(s)' : ''), 'ok');
      _p = null;
      renderLotes();
      if(window.Facturas) Facturas.render();
    }catch(err){
      console.error(err);
      Storage.saveLotes(previo);
      UI.toast('Error al importar: ' + err.message, 'err');
    }finally{
      _busy = false;
      _render();
    }
  }

  // ---------- lotes importados ----------
  function renderLotes(){
    const lotes = Storage.getLotes().slice().sort((a, b) => String(b.importadoEn).localeCompare(String(a.importadoEn)));
    const body = document.getElementById('cgLotesBody');
    if(!lotes.length){
      body.innerHTML = '<tr><td colspan="7" class="t-empty" style="text-align:center;padding:28px;color:var(--ink-faint)">Aún no se ha importado ningún lote.</td></tr>';
      return;
    }
    body.innerHTML = lotes.map(l => {
      const facs = _facturasVigentesDeLote(l.id).length;
      const pill = l.estado === 'Activo' ? 'ok' : (l.estado === 'Reemplazado' ? 'warn' : 'gray');
      return '<tr><td>' + Utils.escapeHtml(l.archivo) + '</td>'
        + '<td>' + Utils.fmtDate(l.desde) + ' al ' + Utils.fmtDate(l.hasta) + '</td>'
        + '<td class="r">' + l.filas.length + '</td>'
        + '<td class="r">' + money(l.totales.ventasNetas) + '</td>'
        + '<td>' + Utils.escapeHtml(l.importadoPor || '—') + '<div class="sub" style="font-size:11px">' + new Date(l.importadoEn).toLocaleString('es-DO') + '</div></td>'
        + '<td><span class="pill ' + pill + '"><span class="pill-dot"></span>' + l.estado + '</span>' + (facs ? '<div class="sub" style="font-size:11px">' + facs + ' factura(s)</div>' : '') + '</td>'
        + '<td class="c" style="white-space:nowrap"><button class="btn btn-ghost btn-sm" onclick="Cargar.verLote(\'' + Utils.jsAttr(l.id) + '\')">Ver</button>'
        + (l.estado === 'Activo' ? ' <button class="btn btn-ghost btn-sm" onclick="Cargar.anularLote(\'' + Utils.jsAttr(l.id) + '\')">Anular</button>' : '') + '</td></tr>';
    }).join('');
  }

  function verLote(id){
    const l = Storage.getLote(id);
    if(!l) return;
    document.getElementById('loteDetTitle').textContent = 'Lote: ' + l.archivo;
    document.getElementById('loteDetBody').innerHTML =
      '<p class="sub" style="margin-bottom:10px">Período ' + Utils.fmtDate(l.desde) + ' al ' + Utils.fmtDate(l.hasta)
      + ' · Importado por ' + Utils.escapeHtml(l.importadoPor || '—') + ' el ' + new Date(l.importadoEn).toLocaleString('es-DO')
      + ' · ' + l.filas.length + ' registro(s)' + (l.rechazados ? ', ' + l.rechazados + ' rechazado(s)' : '')
      + (Storage.getFacturaGeneralDeLote(l.id) ? ' · Factura general: <b>' + Utils.escapeHtml(Storage.getFacturaGeneralDeLote(l.id).numero) + '</b>' : '') + '</p>'
      + '<div class="table-wrap"><table class="t"><thead><tr><th>Consorcio</th><th class="r">Ventas Netas</th><th class="r">Pagos</th><th class="r">Cargo</th><th class="r">Total Bruto</th><th>Factura</th></tr></thead><tbody>'
      + l.filas.map(f => {
          const fac = Storage.getFacturaDeFila(l.id, f.id);
          return '<tr><td>' + Utils.escapeHtml(f.consorcio) + '</td><td class="r">' + money(f.ventasNetas) + '</td><td class="r">' + money(f.pagos) + '</td><td class="r">' + money(f.cargo) + '</td><td class="r">' + money(f.totalBruto) + '</td><td>' + (fac ? Utils.escapeHtml(fac.numero) : '<span style="color:var(--ink-faint)">Sin facturar</span>') + '</td></tr>';
        }).join('')
      + '<tr style="font-weight:700"><td>TOTAL</td><td class="r">' + money(l.totales.ventasNetas) + '</td><td class="r">' + money(l.totales.pagos) + '</td><td class="r">' + money(l.totales.cargo) + '</td><td class="r">' + money(l.totales.totalBruto) + '</td><td></td></tr>'
      + '</tbody></table></div>';
    UI.openModal('modalLoteDetalle');
  }

  function anularLote(id){
    const l = Storage.getLote(id);
    if(!l) return;
    const facs = _facturasVigentesDeLote(id);
    if(facs.length){ UI.toast('El lote tiene facturas vigentes (' + facs.map(f => f.numero).join(', ') + '). Anúlalas primero.', 'err'); return; }
    UI.requirePin(() => {
      UI.confirm('Anular lote', '¿Anular el lote "' + l.archivo + '" (' + Utils.fmtDate(l.desde) + ' al ' + Utils.fmtDate(l.hasta) + ')? Sus ventas dejarán de estar disponibles para facturar. Podrás volver a cargar ese período.', async () => {
        const previo = Storage.getLotes();
        const usuario = (window.Auth && Auth.getUser && Auth.getUser()) || {};
        Storage.saveLotes(previo.map(x => x.id === id ? { ...x, estado:'Anulado', anuladoPor: usuario.name || usuario.email || '—', anuladoEn: new Date().toISOString() } : x));
        const r = window.Sync ? await Sync.pushNow(Storage.KEYS.LOTES) : { ok:false, reason:'no-sync' };
        if(!r.ok){ Storage.saveLotes(previo); UI.toast('No se pudo guardar en Supabase (' + r.reason + '). El lote no se anuló.', 'err'); renderLotes(); return; }
        Storage.addAuditoria({ usuarioNombre: usuario.name || usuario.email || '—', accion:'anular_lote', entidad:'lote', entidadId:id, detalle:{ archivo:l.archivo, desde:l.desde, hasta:l.hasta } });
        UI.toast('Lote anulado', 'ok');
        renderLotes();
        if(window.Facturas) Facturas.render();
      });
    });
  }

  function render(){ renderLotes(); _render(); }

  return { handleFile, analizar, setPeriodo, cancelar, confirmar, render, renderLotes, verLote, anularLote, _state: () => _p };
})();
window.Cargar = Cargar;
