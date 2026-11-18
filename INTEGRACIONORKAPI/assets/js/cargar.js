/* ============================================================
   Cargar — selección de semana, carga de los cuatro reportes de ORKAPI, validación y procesamiento
   ============================================================ */
const Cargar = (() => {
  const S = SemanaORK, V = ValidacionORK, PK = ParserORK;
  const esc = H.esc;
  let _leyendo = {};                                   // producto → true mientras se lee/valida (estado "Validando")

  const ESTADO_ARCH = {
    pendiente: ['Pendiente de carga', 'gray'], cargado: ['Archivo cargado', 'blue'], validando: ['Validando', 'blue'],
    validado: ['Validado', 'ok'], error: ['Error de estructura', 'red'], procesado: ['Procesado correctamente', 'ok']
  };
  function estadoArchivo(sem, p){
    const a = sem && sem.archivos && sem.archivos[p];
    if(_leyendo[p]) return 'validando';
    if(!a || !a.cargado) return 'pendiente';
    if(a.validacion && a.validacion.errores && a.validacion.errores.length) return 'error';
    const lista = ['procesado', 'en_revision', 'aprobado', 'cerrado'];
    if(sem.productos && sem.productos[p] && sem.productos[p].archivoHash === a.hash && lista.indexOf(sem.estado) !== -1) return 'procesado';
    return 'validado';
  }
  const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

  // ---------- semana: abrir / crear ----------
  function _fechasDeSemana(){
    const a = Number(document.getElementById('cgAnio').value), n = Number(document.getElementById('cgSemana').value);
    if(!a || !n) return;
    const r = S.semanaISO(a, n);
    document.getElementById('cgDesde').value = r.desde; document.getElementById('cgHasta').value = r.hasta;
  }
  function _crearOAbrir(){
    const anio = Number(document.getElementById('cgAnio').value), n = Number(document.getElementById('cgSemana').value);
    const desde = document.getElementById('cgDesde').value, hasta = document.getElementById('cgHasta').value;
    if(!anio || !n || n < 1 || n > S.semanasDelAnio(anio)){ UI.toast('Indica un año y un número de semana válidos', 'err'); return; }
    if(!desde || !hasta || desde > hasta){ UI.toast('Las fechas del corte no son válidas', 'err'); return; }
    const id = S.idSemana(anio, n);
    if(Storage.getIndice().some(s => s.id === id)){ App.setSemana(id); UI.toast('Semana ' + n + ' de ' + anio + ' abierta', 'ok'); return; }
    const hacer = async () => {
      const r = await App.guardar(async () => {
        if(Storage.getSemana(id)) throw new Error('La semana ya existe (la creó otro usuario).');
        const sem = S.nuevaSemana(anio, n, desde, hasta, Permisos.nombre());
        const claves = Storage.saveSemana(sem);
        Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'crear_semana', entidad: 'semana', entidadId: id, semanaId: id, detalle: desde + ' al ' + hasta });
        return { claves: claves.concat([Storage.KEYS.AUDIT]) };
      }, { semana: id });
      if(r.ok){ await App.setSemana(id); UI.toast('Semana ' + n + ' creada', 'ok'); }
    };
    const iso = S.semanaISO(anio, n);
    if(iso.desde !== desde || iso.hasta !== hasta) UI.confirm('Fechas distintas a la semana ISO', 'La semana ' + n + ' de ' + anio + ' va del ' + Utils.fmtDate(iso.desde) + ' al ' + Utils.fmtDate(iso.hasta) + ', pero indicaste ' + Utils.fmtDate(desde) + ' al ' + Utils.fmtDate(hasta) + '. ¿Crear la semana con esas fechas?', hacer);
    else hacer();
  }

  // ---------- lectura del archivo ----------
  async function _leer(file){
    const buf = await file.arrayBuffer(), bytes = new Uint8Array(buf);
    const tipo = PK.detectarTipo(bytes), hash = await Utils.sha256Hex(buf);
    const r = { nombre: file.name, tamano: file.size, tipo, hash, entrada: {}, original: null, aoa: null };
    if(tipo === 'html' || tipo === 'csv'){
      let txt = new TextDecoder('utf-8').decode(bytes);
      if(txt.indexOf('�') !== -1) txt = new TextDecoder('windows-1252').decode(bytes);
      r.entrada = { texto: txt }; r.original = txt;
    }else if(tipo === 'xls-binario' || tipo === 'xlsx'){
      const wb = XLSX.read(bytes, { type: 'array' });
      let aoa = null;
      for(const n of wb.SheetNames){ const a = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }); if(!aoa) aoa = a; if(!PK.leerAoA(a).errores.length){ aoa = a; break; } }
      r.aoa = aoa; r.entrada = { aoa };
    }
    return r;
  }
  function _contexto(sem, p, a){
    return { slot: p, semana: sem, catalogo: Storage.getCatalogoActivo(), productos: Storage.getProductosCfg(), loteria: Storage.getConfig().loteria, vinculos: sem.vinculos || {}, productoConfirmado: a && a.productoConfirmado };
  }
  // Valida y arma el registro que se guarda en la semana (sin los agrupados pesados: se recalculan)
  function _armar(sem, p, lec, a0){
    const rep = PK.leerReporte(lec.entrada, lec.tipo, a0 && a0.mapeoManual, a0 && a0.filaEncabezado);
    const val = V.validarReporte(rep, _contexto(sem, p, a0));
    return {
      cargado: true, nombre: lec.nombre, tamano: lec.tamano, hash: lec.hash, tipoArchivo: lec.tipo,
      encabezado: rep.encabezado, mapeo: rep.mapeo, columnas: rep.tabla ? rep.tabla.cabeceras : [], mapeoManual: a0 && a0.mapeoManual || null, filaEncabezado: a0 && a0.filaEncabezado || null,
      filas: rep.filas, total: rep.total, codigos: rep.filas.map(f => f.codigo), original: lec.original, aoa: lec.aoa,
      productoConfirmado: a0 && a0.productoConfirmado || null,
      validacion: { errores: val.errores, advertencias: val.advertencias, info: val.info, producto: val.producto, requiereConfirmacion: val.requiereConfirmacion, vinculacionPendiente: val.vinculacionPendiente,
        desconocidos: val.desconocidos.map(d => ({ linea: d.linea, codigoRaw: d.codigoRaw, nombre: d.nombre, clave: d.clave, sugerencia: d.sugerencia, ventasC: d.ventasC, premiosC: d.premiosC })),
        renombrados: val.renombrados, repetidos: val.repetidos.length, ausentes: val.ausentes, totales: val.totales },
      cargadoPor: Permisos.nombre(), cargadoEn: new Date().toISOString()
    };
  }
  function _lecturaGuardada(a){ return { nombre: a.nombre, tamano: a.tamano, tipo: a.tipoArchivo, hash: a.hash, entrada: a.original != null ? { texto: a.original } : { aoa: a.aoa }, original: a.original, aoa: a.aoa }; }
  // Revalida los cuatro archivos de la semana (cambió el catálogo, un vínculo, el mapeo o la confirmación de producto)
  function _revalidarTodos(sem){
    S.IDS.forEach(p => { const a = sem.archivos[p]; if(a && a.cargado) sem.archivos[p] = { ..._armar(sem, p, _lecturaGuardada(a), a), cargadoPor: a.cargadoPor, cargadoEn: a.cargadoEn }; });
  }

  // ---------- subir un archivo ----------
  async function onArchivo(p, input){
    const file = input.files && input.files[0]; input.value = '';
    const sem = App.Ctx.sem;
    if(!file) return;
    if(!sem){ UI.toast('Primero abre o crea la semana', 'err'); return; }
    if(S.estaBloqueada(sem)){ UI.toast('La semana está ' + S.ESTADOS[sem.estado].toLowerCase() + ': reábrela para cambiar archivos.', 'err'); return; }
    _leyendo[p] = true; render();
    let lec;
    try{ lec = await _leer(file); }
    catch(e){ _leyendo[p] = false; render(); UI.toast('No se pudo leer el archivo: ' + e.message, 'err'); return; }
    _leyendo[p] = false;
    const r = await App.guardar(async () => {
      const fresca = Storage.getSemana(sem.id); if(!fresca) throw new Error('La semana ya no existe.');
      if(S.estaBloqueada(fresca)) throw new Error('La semana cambió de estado: ' + S.ESTADOS[fresca.estado] + '.');
      const previo = fresca.archivos[p];
      fresca.archivos[p] = _armar(fresca, p, lec, previo && previo.cargado ? { mapeoManual: null, filaEncabezado: null, productoConfirmado: null } : null);
      fresca.estado = fresca.productos ? 'en_validacion' : S.estadoPorArchivos(fresca);
      S.evento(fresca, Permisos.nombre(), previo && previo.cargado ? 'reemplazar_archivo' : 'cargar_archivo', S.PRODUCTOS_DEF[p].nombre + ' · ' + lec.nombre + ' · ' + lec.tipo + ' · ' + lec.hash.slice(0, 10));
      const claves = Storage.saveSemana(fresca);
      Storage.addAuditoria({ usuario: Permisos.nombre(), accion: previo && previo.cargado ? 'reemplazar_archivo' : 'cargar_archivo', entidad: 'archivo', entidadId: p, semanaId: fresca.id, detalle: lec.nombre + ' (' + lec.tipo + ', ' + kb(lec.tamano) + ', sha256 ' + lec.hash.slice(0, 16) + ')' });
      return { claves: claves.concat([Storage.KEYS.AUDIT]) };
    }, { semana: sem.id });
    App.recargarSemana(); App.pintarContexto(); render();
    if(r.ok){ const v = App.Ctx.sem.archivos[p].validacion; UI.toast(v.errores.length ? 'Archivo cargado con errores: revísalos' : 'Archivo cargado y validado: ' + S.PRODUCTOS_DEF[p].nombre, v.errores.length ? 'err' : 'ok'); }
  }

  async function quitar(p){
    const sem = App.Ctx.sem;
    UI.confirm('Quitar archivo', 'Se quitará el archivo de ' + S.PRODUCTOS_DEF[p].nombre + ' de esta semana (queda registrado en el historial). ¿Continuar?', async () => {
      const r = await App.guardar(async () => {
        const f = Storage.getSemana(sem.id); if(S.estaBloqueada(f)) throw new Error('La semana está ' + S.ESTADOS[f.estado].toLowerCase() + '.');
        f.archivos[p] = { cargado: false, estado: 'pendiente' };
        if(f.productos){ f.productos = null; f.consolidado = null; f.resumen = null; }
        f.estado = S.estadoPorArchivos({ ...f, estado: 'borrador' }); f.version = f.version;
        S.evento(f, Permisos.nombre(), 'quitar_archivo', S.PRODUCTOS_DEF[p].nombre);
        const claves = Storage.saveSemana(f);
        Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'quitar_archivo', entidad: 'archivo', entidadId: p, semanaId: f.id });
        return { claves: claves.concat([Storage.KEYS.AUDIT]) };
      }, { semana: sem.id });
      App.recargarSemana(); App.pintarContexto(); render();
      if(r.ok) UI.toast('Archivo quitado', 'ok');
    });
  }

  // ---------- confirmar producto / mapeo / vincular ----------
  function confirmarProducto(p){
    const a = App.Ctx.sem.archivos[p], grupo = (a.encabezado && a.encabezado.grupoJuegos) || '—';
    UI.abrir({ titulo: 'Confirmar producto', ancho: 520,
      cuerpo: `<p>El reporte dice <b>Grupos de Juegos: "${esc(grupo)}"</b>, que no está configurado en ningún producto.</p><p style="margin-top:8px">¿Corresponde a <b>${esc(S.PRODUCTOS_DEF[p].nombre)}</b>?</p><p class="hint">Si lo confirmas, esta carga se acepta como ${esc(S.PRODUCTOS_DEF[p].nombre)}. Un administrador puede además guardar el texto como regla permanente.</p>`,
      botones: [{ t: 'Cancelar', c: 'btn-ghost', f: UI.cerrar },
        { t: 'Confirmar solo esta vez', c: 'btn-soft', f: () => { UI.cerrar(); _confirmarProducto(p, false); } },
        { t: 'Confirmar y guardar regla', c: 'btn-primary', f: () => { UI.cerrar(); App.protegida(() => _confirmarProducto(p, true)); } }] });
  }
  async function _confirmarProducto(p, guardarRegla){
    const sem = App.Ctx.sem;
    const r = await App.guardar(async () => {
      const f = Storage.getSemana(sem.id); const a = f.archivos[p];
      f.archivos[p] = { ..._armar(f, p, _lecturaGuardada(a), { ...a, productoConfirmado: p }), cargadoPor: a.cargadoPor, cargadoEn: a.cargadoEn };
      S.evento(f, Permisos.nombre(), 'confirmar_producto', S.PRODUCTOS_DEF[p].nombre + ' ← "' + ((a.encabezado && a.encabezado.grupoJuegos) || '') + '"');
      const claves = Storage.saveSemana(f);
      if(guardarRegla){
        const cfg = Storage.getConfig(), g = (a.encabezado && a.encabezado.grupoJuegos) || '';
        if(g && cfg.productos[p].patrones.map(PK.norm).indexOf(PK.norm(g)) === -1){ cfg.productos[p].patrones.push(g); Storage.saveConfig(cfg); claves.push(Storage.KEYS.CONFIG); }
      }
      Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'confirmar_producto', entidad: 'archivo', entidadId: p, semanaId: f.id, detalle: 'regla guardada: ' + !!guardarRegla });
      return { claves: claves.concat([Storage.KEYS.AUDIT]) };
    }, { semana: sem.id });
    App.recargarSemana(); render(); if(r.ok) UI.toast('Producto confirmado', 'ok');
  }

  function mapeo(p){
    const a = App.Ctx.sem.archivos[p], cols = a.columnas || [], m = a.mapeo || {};
    const opts = sel => '<option value="">(no usar)</option>' + cols.map((c, i) => `<option value="${i}"${String(sel) === String(i) ? ' selected' : ''}>${i + 1}. ${esc(c || '(sin título)')}</option>`).join('');
    const campos = [['item', 'ITEM (solo orden de aparición)'], ['consorcio', 'CONSORCIOS (código y nombre) *'], ['ventas', 'VENTA JUGADAS *'], ['premios', 'PREMIOS PAGADOS *'], ['balance', 'BALANCE FINAL']];
    UI.abrir({ titulo: 'Mapeo de columnas · ' + S.PRODUCTOS_DEF[p].nombre, ancho: 560,
      cuerpo: (a.tipoArchivo === 'html' ? '' : `<div class="field"><label class="f-label">Fila de encabezados (número de fila del archivo)</label><input class="input" id="mpFila" type="number" min="1" value="${a.filaEncabezado || ''}" placeholder="Automática"></div>`)
        + campos.map(([k, t]) => `<div class="field"><label class="f-label">${t}</label><select class="input" id="mp_${k}">${opts(m[k])}</select></div>`).join('')
        + '<p class="hint">Las columnas se detectan solas por su encabezado. Cámbialas solo si el reporte trae otros nombres.</p>',
      botones: [{ t: 'Cancelar', c: 'btn-ghost', f: UI.cerrar }, { t: 'Aplicar mapeo', c: 'btn-primary', f: () => _aplicarMapeo(p) }] });
  }
  async function _aplicarMapeo(p){
    const sem = App.Ctx.sem, man = {};
    ['item', 'consorcio', 'ventas', 'premios', 'balance'].forEach(k => { const v = document.getElementById('mp_' + k).value; if(v !== '') man[k] = Number(v); });
    const fila = document.getElementById('mpFila') ? document.getElementById('mpFila').value : null;
    UI.cerrar();
    const r = await App.guardar(async () => {
      const f = Storage.getSemana(sem.id); const a = f.archivos[p];
      f.archivos[p] = { ..._armar(f, p, _lecturaGuardada(a), { ...a, mapeoManual: man, filaEncabezado: fila ? Number(fila) : null }), cargadoPor: a.cargadoPor, cargadoEn: a.cargadoEn };
      S.evento(f, Permisos.nombre(), 'mapeo_columnas', S.PRODUCTOS_DEF[p].nombre);
      const claves = Storage.saveSemana(f);
      return { claves };
    }, { semana: sem.id });
    App.recargarSemana(); render(); if(r.ok) UI.toast('Mapeo aplicado y archivo revalidado', 'ok');
  }

  function vincular(p){
    const a = App.Ctx.sem.archivos[p], des = a.validacion.desconocidos || [], cat = Storage.getCatalogo();
    const opts = sug => '<option value="">— elegir —</option>' + `<option value="__nuevo__">➕ Crear consorcio nuevo (administrador)</option>` + cat.map(c => `<option value="${c.id}"${sug && sug.id === c.id ? ' selected' : ''}>${esc(c.nombre)}${c.codigo ? ' (' + esc(c.codigo) + ')' : ''}</option>`).join('');
    UI.abrir({ titulo: 'Vincular consorcios al catálogo · ' + S.PRODUCTOS_DEF[p].nombre, ancho: 760,
      cuerpo: `<p class="sub" style="margin-bottom:10px">Estos consorcios del reporte no están en el catálogo (se identifican por su <b>código de ORKAPI</b>). Vincúlalos a uno existente o créalos antes de procesar.</p>`
        + '<div class="table-wrap"><table class="t"><thead><tr><th>Código</th><th>Nombre en ORKAPI</th><th class="r">Ventas</th><th class="r">Premios</th><th>Vincular a</th></tr></thead><tbody>'
        + des.map((d, i) => `<tr><td class="mono">${esc(d.codigoRaw || '—')}</td><td>${esc(d.nombre)}</td>${H.tdm(d.ventasC)}${H.tdm(d.premiosC)}<td><select class="input" id="vc_${i}">${opts(d.sugerencia)}</select>${d.sugerencia ? `<div class="hint">${esc(d.sugerencia.motivo)}</div>` : ''}</td></tr>`).join('')
        + '</tbody></table></div>',
      botones: [{ t: 'Cancelar', c: 'btn-ghost', f: UI.cerrar }, { t: 'Guardar vinculación', c: 'btn-primary', f: () => _guardarVinculos(p, des) }] });
  }
  function _guardarVinculos(p, des){
    const eleg = des.map((d, i) => ({ d, v: document.getElementById('vc_' + i).value })).filter(x => x.v);
    if(!eleg.length){ UI.toast('Elige a qué consorcio corresponde al menos uno', 'err'); return; }
    const nuevos = eleg.filter(x => x.v === '__nuevo__');
    const ejecutar = async () => {
      const sem = App.Ctx.sem; UI.cerrar();
      const r = await App.guardar(async () => {
        const f = Storage.getSemana(sem.id), cat = Storage.getCatalogo(); let sig = cat.reduce((m, c) => Math.max(m, c.id), 0) + 1; const claves = [];
        eleg.forEach(x => {
          let id = x.v === '__nuevo__' ? null : Number(x.v);
          if(id === null){ id = sig++; cat.push({ id, codigo: x.d.codigoRaw ? PK.claveCodigo(x.d.codigoRaw) : '', nombre: x.d.nombre, alias: [], tipo: '', tipoValidado: false, estado: 'activo', origen: 'orkapi', creadoEn: new Date().toISOString(), creadoPor: Permisos.nombre() }); }
          f.vinculos[x.d.clave] = id;
        });
        if(nuevos.length){ Storage.saveCatalogo(cat); claves.push(Storage.KEYS.CATALOGO); }
        _revalidarTodos(f);
        S.evento(f, Permisos.nombre(), 'vincular_consorcios', eleg.length + ' vinculado(s)' + (nuevos.length ? ', ' + nuevos.length + ' nuevo(s) en el catálogo' : ''));
        Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'vincular_consorcios', entidad: 'semana', entidadId: f.id, semanaId: f.id, detalle: eleg.map(x => '(' + x.d.codigoRaw + ') ' + x.d.nombre + ' → ' + (x.v === '__nuevo__' ? 'nuevo' : x.v)).join('; ') });
        return { claves: claves.concat(Storage.saveSemana(f), [Storage.KEYS.AUDIT]) };
      }, { semana: sem.id });
      App.recargarSemana(); render(); if(r.ok) UI.toast('Vinculación guardada', 'ok');
    };
    if(nuevos.length) App.protegida(ejecutar); else ejecutar();
  }

  // ---------- vista previa de las filas ----------
  function vistaPrevia(p){
    const sem = App.Ctx.sem, a = sem.archivos[p], cat = Storage.getCatalogoActivo();
    const res = V.resolverConsorcios(a.filas, cat, sem.vinculos);
    const desc = new Set(res.desconocidos.map(d => d.linea)), ren = new Map(res.renombrados.map(r => [r.linea, r]));
    const cuenta = new Map(); a.filas.forEach(f => { const c = f.codigo ? cat.find(x => PK.claveCodigo(x.codigo) === f.codigo) : null; if(c) cuenta.set(c.id, (cuenta.get(c.id) || 0) + 1); });
    const filas = a.filas.map(f => {
      const c = f.codigo ? cat.find(x => x.codigo !== '' && PK.claveCodigo(x.codigo) === f.codigo) : null;
      const est = desc.has(f.linea) ? '<span class="pill red">Sin vincular</span>' : ren.has(f.linea) ? '<span class="pill warn">Nombre distinto</span>' : (c && cuenta.get(c.id) > 1 ? '<span class="pill warn">Repetido</span>' : '<span class="pill ok">OK</span>');
      return `<tr><td class="c">${f.linea}</td><td class="c">${esc(f.item)}</td><td class="mono">${esc(f.codigoRaw || '—')}</td><td>${esc(f.nombre)}</td><td>${c ? esc(c.nombre) : '<span class="muted">—</span>'}</td>${H.tdm(f.ventasC)}${H.tdm(f.premiosC)}${H.tdm(f.balanceC)}<td>${est}</td></tr>`;
    }).join('');
    const v = a.validacion.totales;
    UI.abrir({ titulo: 'Vista previa · ' + S.PRODUCTOS_DEF[p].nombre, sub: a.nombre + ' · ' + a.filas.length + ' filas', ancho: 1040,
      cuerpo: '<div class="table-wrap" style="max-height:62vh;overflow:auto"><table class="t"><thead><tr><th class="c">Fila</th><th class="c">ITEM</th><th>Código</th><th>Consorcio (ORKAPI)</th><th>Catálogo</th><th class="r">Ventas jugadas</th><th class="r">Premios pagados</th><th class="r">Balance final</th><th>Estado</th></tr></thead><tbody>' + filas
        + `</tbody><tfoot><tr style="font-weight:700"><td colspan="5">Suma de las filas</td>${H.tdm(v.ventasC)}${H.tdm(v.premiosC)}${H.tdm(v.balanceC)}<td></td></tr>`
        + (a.total ? `<tr style="font-weight:700"><td colspan="5">TOTAL GENERAL del reporte</td>${H.tdm(a.total.ventasC)}${H.tdm(a.total.premiosC)}${H.tdm(a.total.balanceC)}<td></td></tr>` : '') + '</tfoot></table></div>'
        + '<p class="hint">ITEM es solo el orden de aparición en el reporte: los consorcios se identifican por su código de ORKAPI.</p>' });
  }

  // ---------- procesar ----------
  async function procesar(){
    const sem = App.Ctx.sem;
    if(!sem) return;
    if(S.estaBloqueada(sem)){ UI.toast('La semana está ' + S.ESTADOS[sem.estado].toLowerCase() + '. Reábrela (Control semanal) para procesar de nuevo.', 'err'); return; }
    const conj = V.validarConjunto(sem.archivos, Storage.getProductosCfg(), S.IDS);
    if(conj.errores.length){ UI.toast('No se puede procesar: ' + conj.errores[0], 'err'); return; }
    let tmp;
    try{ tmp = JSON.parse(JSON.stringify(sem)); S.recalcular(tmp, Storage.getCatalogo(), Storage.getProductosCfg()); }
    catch(e){ UI.toast(e.message, 'err'); return; }
    const malos = S.IDS.filter(p => tmp.productos[p] && !tmp.productos[p].verificacion.ok);
    if(malos.length){ UI.toast('La verificación independiente del cálculo falló en ' + malos.map(H.NOMBRES).join(', ') + '. No se guardó nada.', 'err'); return; }
    if(sem.productos){
      const d = S.diferencias(sem, tmp);
      const hay = d.productos.some(x => x.difC !== 0);
      UI.abrir({ titulo: 'Revisión de diferencias antes de sustituir resultados', sub: 'La semana ya estaba procesada (versión ' + sem.version + ')', ancho: 760,
        cuerpo: (hay ? '' : '<div class="cc-alert warn">Los nuevos resultados son idénticos a los guardados.</div>')
          + '<div class="table-wrap"><table class="t"><thead><tr><th>Producto</th><th class="r">Antes</th><th class="r">Después</th><th class="r">Diferencia</th></tr></thead><tbody>'
          + d.productos.map(x => `<tr><td>${esc(H.NOMBRES(x.producto))}</td>${H.tdm(x.antesC)}${H.tdm(x.despuesC)}${H.tdm(x.difC)}</tr>`).join('') + '</tbody></table></div>'
          + (d.consorcios.length ? '<h4 style="margin:14px 0 6px">Consorcios con cambios (' + d.consorcios.length + ')</h4><div class="table-wrap" style="max-height:240px;overflow:auto"><table class="t"><thead><tr><th>Consorcio</th><th class="r">Antes</th><th class="r">Después</th><th class="r">Diferencia</th></tr></thead><tbody>'
            + d.consorcios.slice(0, 40).map(x => `<tr><td>${esc(x.nombre)}</td>${H.tdm(x.antesC)}${H.tdm(x.despuesC)}${H.tdm(x.difC)}</tr>`).join('') + '</tbody></table></div>' : '')
          + '<p class="hint">Nada se sustituye hasta que confirmes. El resultado anterior queda registrado en el historial de la semana.</p>',
        botones: [{ t: 'Cancelar', c: 'btn-ghost', f: UI.cerrar }, { t: 'Sustituir resultados', c: 'btn-primary', f: () => { UI.cerrar(); _guardarProceso(d); } }] });
    }else _guardarProceso(null);
  }
  async function _guardarProceso(dif){
    const sem = App.Ctx.sem;
    const r = await App.guardar(async () => {
      const f = Storage.getSemana(sem.id);
      if(S.estaBloqueada(f)) throw new Error('La semana cambió de estado: ' + S.ESTADOS[f.estado] + '.');
      const conj = V.validarConjunto(f.archivos, Storage.getProductosCfg(), S.IDS); if(conj.errores.length) throw new Error(conj.errores[0]);
      const previa = f.productos ? { resumen: f.resumen } : null;
      S.recalcular(f, Storage.getCatalogo(), Storage.getProductosCfg());
      const malos = S.IDS.filter(p => !f.productos[p].verificacion.ok); if(malos.length) throw new Error('La verificación independiente del cálculo falló: ' + malos.join(', '));
      f.version = (f.version || 0) + 1; f.estado = 'procesado';
      S.evento(f, Permisos.nombre(), 'procesar', 'versión ' + f.version + ' · consolidado ' + Dinero.fmt(f.resumen.consolidadoC) + (previa && previa.resumen ? ' (antes ' + Dinero.fmt(previa.resumen.consolidadoC) + ')' : ''));
      const claves = Storage.saveSemana(f);
      Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'procesar_semana', entidad: 'semana', entidadId: f.id, semanaId: f.id, detalle: 'v' + f.version + ' consolidado ' + Dinero.fmt(f.resumen.consolidadoC) + (dif ? ' · ' + dif.consorcios.length + ' consorcio(s) con cambios' : '') });
      return { claves: claves.concat([Storage.KEYS.AUDIT]) };
    }, { semana: sem.id });
    App.recargarSemana(); App.pintarContexto(); render();
    if(r.ok) UI.toast('Semana procesada: consolidado ' + Dinero.fmt(App.Ctx.sem.resumen.consolidadoC), 'ok');
  }

  // ---------- pantalla ----------
  function _slot(sem, p){
    const def = S.PRODUCTOS_DEF[p], cfg = Storage.getProductosCfg()[p], a = sem && sem.archivos[p], est = estadoArchivo(sem, p), [txt, cls] = ESTADO_ARCH[est];
    const bloq = !sem || S.estaBloqueada(sem);
    let cuerpo = '';
    if(a && a.cargado){
      const v = a.validacion, e = a.encabezado || {}, t = v.totales || {};
      cuerpo = `<div class="slot-info"><b>${esc(a.nombre)}</b><span class="sub"> · ${esc(a.tipoArchivo)} · ${kb(a.tamano)} · sha256 ${esc(a.hash.slice(0, 10))}…</span></div>
        <div class="slot-grid"><span>Grupo de juegos</span><b>${esc(e.grupoJuegos || '—')}</b><span>Lotería</span><b>${esc(e.loteria || '—')}</b>
          <span>Período</span><b>${e.desde ? Utils.fmtDate(e.desde) + ' – ' + Utils.fmtDate(e.hasta) : '—'}</b><span>Filas</span><b>${t.filas || 0}</b>
          <span>Ventas</span><b>${H.money(t.ventasC)}</b><span>Premios</span><b>${H.money(t.premiosC)}</b></div>`
        + v.errores.map(m => `<div class="cc-alert danger">${esc(m)}</div>`).join('') + v.advertencias.map(m => `<div class="cc-alert warn">${esc(m)}</div>`).join('')
        + (v.info || []).map(m => `<div class="slot-nota">${esc(m)}</div>`).join('')
        + `<div class="slot-acc"><button class="btn btn-ghost btn-sm" onclick="Cargar.vistaPrevia('${p}')">Vista previa</button><button class="btn btn-ghost btn-sm" onclick="Cargar.mapeo('${p}')">Mapeo de columnas</button>`
        + (v.requiereConfirmacion ? `<button class="btn btn-soft btn-sm" onclick="Cargar.confirmarProducto('${p}')">Confirmar producto</button>` : '')
        + (v.vinculacionPendiente ? `<button class="btn btn-soft btn-sm" onclick="Cargar.vincular('${p}')">Vincular consorcios (${(v.desconocidos || []).length})</button>` : '')
        + (!bloq ? `<label class="btn btn-ghost btn-sm" style="cursor:pointer">Reemplazar<input type="file" accept=".xls,.xlsx,.html,.htm,.csv,.txt" style="display:none" onchange="Cargar.onArchivo('${p}', this)"></label><button class="btn btn-ghost btn-sm" onclick="Cargar.quitar('${p}')">Quitar</button>` : '')
        + '</div>';
    }else{
      cuerpo = `<label class="dropzone" style="padding:26px 16px;${bloq ? 'opacity:.5;pointer-events:none' : ''}"><b>${est === 'validando' ? 'Leyendo y validando…' : 'Subir reporte de ' + esc(def.nombre)}</b><div class="sub">resultados_propietario.xls (el contenido real se detecta solo)</div><input type="file" accept=".xls,.xlsx,.html,.htm,.csv,.txt" onchange="Cargar.onArchivo('${p}', this)"></label>`;
    }
    return `<div class="card slot"><div class="card-head"><div><h3>${esc(def.nombre)}</h3><p class="sub">Comisión ventas ${Dinero.bpATexto(cfg.tasaVentasBp)} · premios ${Dinero.bpATexto(cfg.tasaPremiosBp)}</p></div><span class="pill ${cls}"><span class="pill-dot"></span>${txt}</span></div><div class="card-body">${cuerpo}</div></div>`;
  }

  function render(){
    const el = document.getElementById('cargarBody'); if(!el) return;
    const sem = App.Ctx.sem, hoy = S.semanaDeFecha(Utils.todayISO());
    const anio = sem ? sem.anio : (App.Ctx.anio || hoy.anio), n = sem ? sem.semana : hoy.semana, r = S.semanaISO(anio, n);
    const nSem = S.semanasDelAnio(anio);
    let html = `<div class="card"><div class="card-body"><div class="filters" style="grid-template-columns:1fr 1.2fr 1.3fr 1.3fr auto">
      <div class="field" style="margin:0"><label class="f-label">Año</label><input class="input" id="cgAnio" type="number" value="${anio}" onchange="Cargar._fechas()"></div>
      <div class="field" style="margin:0"><label class="f-label">Número de semana</label><select class="input" id="cgSemana" onchange="Cargar._fechas()">${Array.from({ length: nSem }, (_, i) => `<option value="${i + 1}"${i + 1 === n ? ' selected' : ''}>Semana ${i + 1}</option>`).join('')}</select></div>
      <div class="field" style="margin:0"><label class="f-label">Fecha inicial del corte</label><input class="input" id="cgDesde" type="date" value="${sem ? sem.desde : r.desde}"></div>
      <div class="field" style="margin:0"><label class="f-label">Fecha final del corte</label><input class="input" id="cgHasta" type="date" value="${sem ? sem.hasta : r.hasta}"></div>
      <button class="btn btn-primary" onclick="Cargar._crearOAbrir()">${sem ? 'Abrir otra semana' : 'Abrir / crear semana'}</button></div>
      <p class="hint">El corte va de lunes a domingo (semana ISO). ${sem ? '<b>Semana activa:</b> ' + sem.semana + ' de ' + sem.anio + ' · ' + H.corte(sem) + ' · ' + H.pillEstado(sem.estado) : 'Elige la semana y pulsa “Abrir / crear semana”.'}</p></div></div>`;
    if(sem){
      const cargados = S.IDS.filter(p => sem.archivos[p] && sem.archivos[p].cargado).length;
      const validados = S.IDS.filter(p => ['validado', 'procesado'].indexOf(estadoArchivo(sem, p)) !== -1).length;
      html += `<div class="card" style="margin-top:14px"><div class="card-body" style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
        <div style="flex:1;min-width:240px"><div class="sub" style="margin-bottom:4px">Avance de la carga</div>
        <div style="height:10px;background:var(--canvas-deep);border-radius:6px;overflow:hidden"><div style="height:100%;width:${cargados * 25}%;background:var(--brand-red)"></div></div>
        <div class="sub" style="margin-top:4px">${cargados} de 4 archivos cargados · ${validados} validados</div></div></div></div>`;
      html += '<div class="slots">' + S.IDS.map(p => _slot(sem, p)).join('') + '</div>';
      const conj = V.validarConjunto(sem.archivos, Storage.getProductosCfg(), S.IDS);
      html += '<div class="card" style="margin-top:14px"><div class="card-body">'
        + (conj.errores.length ? conj.errores.map(m => `<div class="cc-alert danger">${esc(m)}</div>`).join('') : '<div class="cc-alert" style="background:var(--ok-soft,#E6F6EE);color:#15875A">Los cuatro archivos están completos y validados.</div>')
        + conj.advertencias.map(m => `<div class="cc-alert warn">${esc(m)}</div>`).join('')
        + `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><button class="btn btn-primary" ${conj.errores.length || S.estaBloqueada(sem) ? 'disabled' : ''} onclick="Cargar.procesar()">${sem.productos ? 'Procesar de nuevo' : 'Procesar semana'}</button>`
        + (sem.productos ? `<button class="btn btn-soft" onclick="App.switchView('consolidado')">Ver consolidado</button><button class="btn btn-soft" onclick="Exportar.completa()">Descargar integración completa</button>` : '')
        + (S.estaBloqueada(sem) ? `<span class="sub">La semana está ${esc(S.ESTADOS[sem.estado].toLowerCase())}: para cambiar archivos debe reabrirse (Control semanal).</span>` : '') + '</div></div></div>';
    }
    el.innerHTML = html;
  }

  return { render, onArchivo, quitar, confirmarProducto, mapeo, vincular, vistaPrevia, procesar, estadoArchivo, _fechas: _fechasDeSemana, _crearOAbrir, _revalidarTodos };
})();
window.Cargar = Cargar;
