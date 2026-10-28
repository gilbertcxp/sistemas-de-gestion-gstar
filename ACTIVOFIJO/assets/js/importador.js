/* ============================================================
   Importador — carga un corte (hoja "MM-AAAA") de 02.MOBILIARIO Y EQUIPO.xls

   Flujo: elegir archivo → elegir hoja (por defecto la más reciente tipo MM-AAAA)
          → vista previa con resumen y conciliación → confirmar (Administrador + PIN).

   Garantías:
     - No se importan filas de totales, encabezados ni asiento contable como activos.
     - No se recalculan importes: se guardan los del archivo.
     - Idempotente: reimportar no duplica.
     - Si Supabase no confirma el guardado, se revierte todo (nada a medias).
     - Los datos reales NUNCA se guardan en el código: solo van al navegador y a Supabase.
   ============================================================ */
const Importador = (() => {

  const esc = Utils.escapeHtml;
  const money = v => (v === null || v === undefined) ? '—' : Utils.fmtNum(v);

  let _buf = null, _archivo = '', _hash = '', _hojas = [], _parsed = null, _plan = null, _busy = false;

  function abrir(){
    if(!Permisos.esAdmin()){ UI.toast('Importar requiere el rol Administrador', 'err'); return; }
    _buf = null; _parsed = null; _plan = null; _hojas = [];
    document.getElementById('impHojaWrap').style.display = 'none';
    document.getElementById('impPreview').innerHTML = '<p class="sub" style="text-align:center;padding:30px">Selecciona el archivo <b>02.MOBILIARIO Y EQUIPO.xls</b> para ver la vista previa antes de importar.</p>';
    document.getElementById('impBtnConfirmar').disabled = true;
    document.getElementById('impBtnConfirmar').textContent = 'Importar';
    document.getElementById('impArchivo').value = '';
    UI.openModal('modalImportar');
  }

  function elegirArchivo(input){
    const file = input.files && input.files[0];
    if(!file) return;
    if(!/\.xlsx?$/i.test(file.name)){ UI.toast('Solo se aceptan archivos .xls o .xlsx', 'err'); return; }
    UI.toast('Leyendo archivo…', 'ok');
    const reader = new FileReader();
    reader.onerror = () => UI.toast('No se pudo leer el archivo', 'err');
    reader.onload = async () => {
      try{
        _buf = reader.result; _archivo = file.name;
        _hash = await Utils.sha256Hex(_buf);
        const wb = XLSX.read(_buf, { type:'array', bookSheets:true });
        _hojas = wb.SheetNames.slice();
        const periodicas = _hojas.filter(n => ParserAF.periodoDeHoja(n));
        // Por defecto: la hoja del mes más reciente (p. ej. 10-2026). Se puede cambiar.
        const orden = periodicas.slice().sort((a, b) => ParserAF.periodoDeHoja(a).periodo.localeCompare(ParserAF.periodoDeHoja(b).periodo));
        const defecto = orden.length ? orden[orden.length - 1] : _hojas[0];
        const sel = document.getElementById('impHoja');
        sel.innerHTML = _hojas.map(n => '<option value="' + esc(n) + '"' + (n === defecto ? ' selected' : '') + '>' + esc(n) + (ParserAF.periodoDeHoja(n) ? '' : ' (no es un corte mensual)') + '</option>').join('');
        document.getElementById('impHojaWrap').style.display = '';
        cargarHoja(defecto);
      }catch(e){ console.error(e); UI.toast('No se pudo leer el archivo: ' + e.message, 'err'); }
    };
    reader.readAsArrayBuffer(file);
  }

  function cargarHoja(nombre){
    try{
      const wb = XLSX.read(_buf, { type:'array', sheets:nombre, cellDates:false, cellFormula:true });
      _parsed = ParserAF.parsearHoja(XLSX, wb.Sheets[nombre], nombre);
      _plan = PlanAF.planificar(_parsed, Storage.getActivos(), {});
      _render();
    }catch(e){ console.error(e); UI.toast('No se pudo analizar la hoja: ' + e.message, 'err'); }
  }
  function cambiarHoja(n){ cargarHoja(n); }

  function _kpi(l, v, cls){ return '<div class="kpi ' + (cls || '') + '"><div class="lbl">' + l + '</div><div class="val" style="font-size:20px">' + v + '</div></div>'; }

  function _render(){
    const p = _plan, el = document.getElementById('impPreview'), btn = document.getElementById('impBtnConfirmar');
    if(p.errores.length){
      el.innerHTML = p.errores.map(e => '<div class="cc-alert danger">' + esc(e) + '</div>').join('');
      btn.disabled = true; return;
    }
    const r = p.resumen;
    const alertas = [];
    if(!_parsed.periodo) alertas.push('<div class="cc-alert warn">El nombre de la hoja no indica un período (MM-AAAA): no se puede importar como corte.</div>');
    if(_parsed.periodo && _parsed.fechaCorte && _parsed.fechaCorte.slice(0, 7) !== _parsed.periodo) alertas.push('<div class="cc-alert warn">La hoja se llama ' + esc(Datos.etiquetaPeriodo(_parsed.periodo)) + ' pero la fecha de corte que trae el archivo es ' + esc(Utils.fmtDate(_parsed.fechaCorte)) + ' (otro mes). Verifica que sea la hoja correcta antes de importar.</div>');
    if(p.periodoYaImportado) alertas.push('<div class="cc-alert warn">Este período ya fue importado. Al confirmar solo se actualizarán los valores que hayan cambiado; no se duplica ningún activo (' + p.sinCambios + ' sin cambios · ' + p.actualizados + ' con cambios · ' + p.nuevos + ' nuevos).</div>');
    if(r.diferenciasConciliacion) alertas.push('<div class="cc-alert warn">' + r.diferenciasConciliacion + ' total(es) de la fila "TOTALES" del archivo NO coinciden con la suma real de los activos (ver conciliación abajo). Se importan los valores de cada activo; no se ajusta nada para forzar el cuadre.</div>');

    if(r.ausentes) alertas.push('<div class="cc-alert warn">' + r.ausentes + ' activo(s) ya registrado(s) en el sistema NO vienen en este corte. No se modifican ni se inactivan; en este período aparecerán sin importes (ver detalle abajo).</div>');

    const concil = p.conciliacion.map(c => '<tr><td>' + esc(c.concepto) + '</td><td class="r mono">' + money(c.totalArchivo) + '</td><td class="r mono">' + money(c.sumaFilas) + '</td><td class="r mono">' + money(c.importado) + '</td>'
      + '<td class="r mono" style="' + (c.diferencia !== null && Math.abs(c.diferencia) > 0.01 ? 'color:var(--danger);font-weight:700' : '') + '">' + money(c.diferencia) + '</td><td style="font-size:11.5px;color:var(--ink-soft)">' + esc(c.nota) + '</td></tr>').join('');
    const asiento = p.asiento ? p.asiento.filas.map(a => '<tr><td>' + esc(a.cuenta) + '</td><td>' + esc(a.descripcion) + '</td><td class="r mono">' + money(a.archivo) + '</td><td class="r mono">' + money(a.sistema) + '</td><td class="r mono" style="' + (Math.abs(a.diferencia) > 0.01 ? 'color:var(--danger);font-weight:700' : '') + '">' + money(a.diferencia) + '</td></tr>').join('')
      + '<tr style="font-weight:700"><td colspan="2">TOTAL gasto de depreciación</td><td class="r mono">' + money(p.asiento.totalArchivo) + '</td><td class="r mono">' + money(p.asiento.totalSistema) + '</td><td class="r mono">' + money(p.asiento.totalArchivo === null ? null : Math.round((p.asiento.totalArchivo - p.asiento.totalSistema) * 100) / 100) + '</td></tr>' : '';
    const omitidas = p.omitidas.length ? '<ul style="margin:6px 0 0 18px;font-size:12.5px">' + p.omitidas.map(o => '<li>Fila ' + o.fila + ': ' + esc(o.motivo) + '</li>').join('') + '</ul>' : '<p class="sub">Ninguna.</p>';
    const dupRef = p.duplicados.referencias.length ? '<ul style="margin:6px 0 0 18px;font-size:12.5px">' + p.duplicados.referencias.map(d => '<li><b>' + esc(d.referencia) + '</b> aparece en ' + d.activos + ' activos (filas ' + d.filas.join(', ') + ')</li>').join('') + '</ul><p class="sub" style="font-size:12px">Pueden ser legítimas (varios activos de un mismo comprobante); se marcan como advertencia, no se descartan.</p>' : '<p class="sub">Ninguno.</p>';
    const revision = p.filas.filter(f => f.motivos.length);
    const revHtml = revision.length ? '<ul style="margin:6px 0 0 18px;font-size:12.5px">' + revision.map(f => '<li>Fila ' + f.fila + ' (activo ' + f.numero + '): ' + esc(f.motivos.join('; ')) + '</li>').join('') + '</ul>' : '<p class="sub">Ninguno.</p>';

    const filas = p.filas.map(f => '<tr><td class="c">' + f.fila + '</td><td>' + f.numero + (f.numeroExcel === null ? ' <span class="af-asig" title="Número asignado por el sistema">*</span>' : '') + '</td><td>' + esc(f.maestro.descripcion || '—') + '</td><td class="r mono">' + money(f.maestro.valorAdquisicion) + '</td><td class="r mono">' + money(f.valores.pendiente) + '</td>'
      + '<td>' + (f.accion === 'nuevo' ? '<span class="pill ok"><span class="pill-dot"></span>Nuevo</span>' : f.accion === 'actualizado' ? '<span class="pill warn"><span class="pill-dot"></span>Actualiza</span>' : '<span class="pill gray"><span class="pill-dot"></span>Sin cambios</span>')
      + (f.motivos.length ? ' <span class="pill red">Revisión</span>' : '') + '</td></tr>').join('');

    el.innerHTML = alertas.join('')
      + '<p class="sub" style="margin-bottom:10px"><b>' + esc(_archivo) + '</b> · hoja <b>' + esc(_parsed.hoja) + '</b> · período <b>' + (Datos.etiquetaPeriodo(_parsed.periodo)) + '</b> · fecha de corte <b>' + (_parsed.fechaCorte ? Utils.fmtDate(_parsed.fechaCorte) : '—') + '</b> · encabezados en la fila ' + _parsed.filaEncabezados + '</p>'
      + '<div class="grid-kpi" style="margin-bottom:12px">'
      +   _kpi('Registros identificados', r.identificados, 'blue') + _kpi('A importar', r.aImportar, 'ok') + _kpi('Omitidos', r.omitidos, r.omitidos ? 'red' : '')
      +   _kpi('Con advertencias', r.conAdvertencias, 'warn') + _kpi('En revisión', r.enRevision, r.enRevision ? 'warn' : '') + _kpi('Números asignados', r.numerosAsignados, '')
      + '</div>'
      + '<details open><summary style="font-weight:700;cursor:pointer;margin:8px 0">Conciliación con la fila TOTALES del archivo</summary><div class="table-wrap"><table class="t"><thead><tr><th>Concepto</th><th class="r">Totales del archivo</th><th class="r">Suma de las filas</th><th class="r">A importar</th><th class="r">Diferencia</th><th>Causa</th></tr></thead><tbody>' + concil + '</tbody></table></div></details>'
      + (p.asiento ? '<details><summary style="font-weight:700;cursor:pointer;margin:8px 0">Asiento contable del archivo vs. gasto por cuenta en el sistema</summary><div class="table-wrap"><table class="t"><thead><tr><th>Cuenta</th><th>Descripción</th><th class="r">Archivo</th><th class="r">Sistema</th><th class="r">Diferencia</th></tr></thead><tbody>' + asiento + '</tbody></table></div><p class="sub" style="font-size:12px">El asiento solo se usa para conciliar: no se importa ni se genera ningún asiento.</p></details>' : '')
      + '<details><summary style="font-weight:700;cursor:pointer;margin:8px 0">Filas omitidas (' + r.omitidos + ')</summary>' + omitidas + '</details>'
      + '<details><summary style="font-weight:700;cursor:pointer;margin:8px 0">Referencias repetidas (' + p.duplicados.referencias.length + ')</summary>' + dupRef + '</details>'
      + '<details><summary style="font-weight:700;cursor:pointer;margin:8px 0">Activos pendientes de revisión (' + revision.length + ')</summary>' + revHtml + '</details>'
      + '<details><summary style="font-weight:700;cursor:pointer;margin:8px 0">Activos del sistema que este corte no trae (' + (r.ausentes || 0) + ')</summary>' + (r.ausentes ? '<ul style="margin:6px 0 0 18px;font-size:12.5px">' + p.ausentes.map(a => '<li>Activo ' + esc(a.numero) + ': ' + esc(a.descripcion || '—') + '</li>').join('') + '</ul>' : '<p class="sub">Ninguno.</p>') + '</details>'
      + '<details><summary style="font-weight:700;cursor:pointer;margin:8px 0">Activos a importar (' + p.filas.length + ')' + (r.numerosAsignados ? ' · * = número asignado por el sistema (' + r.numerosAsignados + ')' : '') + '</summary><div class="table-wrap" style="max-height:300px;overflow:auto"><table class="t"><thead><tr><th class="c">Fila</th><th>No.</th><th>Descripción</th><th class="r">Valor adq.</th><th class="r">Pendiente</th><th>Acción</th></tr></thead><tbody>' + filas + '</tbody></table></div></details>';

    btn.disabled = _busy || !_parsed.periodo || p.filas.length === 0;
    btn.textContent = p.periodoYaImportado ? 'Reimportar (' + p.filas.length + ' activos)' : 'Importar ' + p.filas.length + ' activos';
  }

  function confirmar(){
    if(!_plan || _busy) return;
    App.protegida(_guardar);
  }

  async function _guardar(){
    if(_busy) return;
    _busy = true; document.getElementById('impBtnConfirmar').disabled = true;
    const K = Storage.KEYS;
    const previos = { [K.ACTIVOS]: Storage.getActivos(), [K.IMPORT]: Storage.getImportaciones(), [K.AUDIT]: Storage.getAuditoria(), [K.SETT]: Storage.getSettings() };
    try{
      // Versión más reciente de Supabase y se vuelve a planificar sobre ella (otro usuario pudo importar mientras tanto)
      if(window.Sync){ try{ await Sync.pull(); }catch(e){} }
      previos[K.ACTIVOS] = Storage.getActivos(); previos[K.IMPORT] = Storage.getImportaciones();
      const plan = PlanAF.planificar(_parsed, previos[K.ACTIVOS], {});
      const ahora = new Date().toISOString(), usuario = Permisos.nombre();
      const activos = PlanAF.aplicar(plan, previos[K.ACTIVOS], { usuario, ahora });
      const imp = {
        id: Utils.uid('imp'), periodo: plan.periodo, hoja: _parsed.hoja, archivo: _archivo, hash: _hash, importadoEn: ahora, importadoPor: usuario,
        fechaCorte: _parsed.fechaCorte, fechaReporte: _parsed.fechaReporte, estado: 'Completada',
        resumen: { ...plan.resumen, nuevos: plan.nuevos, actualizados: plan.actualizados, sinCambios: plan.sinCambios },
        omitidas: plan.omitidas, duplicados: plan.duplicados, conciliacion: plan.conciliacion, asiento: plan.asiento, ausentes: plan.ausentes.map(a => a.numero),
        totalesArchivo: _parsed.totalesArchivo ? _parsed.totalesArchivo.valores : null, columnas: _parsed.columnas
      };
      // nombres de las cuentas contables (del asiento del archivo) para las categorías
      const nombres = { ...(previos[K.SETT].cuentasNombres || {}) };
      if(_parsed.asientoArchivo) _parsed.asientoArchivo.filas.forEach(f => { if(f.cuenta && f.descripcion) nombres[f.cuenta] = f.descripcion; });

      Storage.saveActivos(activos);
      Storage.saveImportaciones(previos[K.IMPORT].concat([imp]));
      Storage.saveSettings({ cuentasNombres: nombres });
      Storage.addAuditoria({ usuarioNombre: usuario, accion: 'importar_corte', entidad: 'importacion', entidadId: imp.id,
        detalle: { archivo: _archivo, hoja: _parsed.hoja, periodo: plan.periodo, ...imp.resumen } });

      const r = await App.guardarSeguro(previos, [K.ACTIVOS, K.IMPORT, K.SETT, K.AUDIT]);
      if(!r.ok){
        UI.toast('No se pudo guardar en Supabase (' + r.reason + '). No se importó nada; intenta de nuevo.', 'err');
        Inventario.render();
        return;
      }
      UI.closeModal('modalImportar');
      UI.toast('Importación completada: ' + plan.nuevos + ' nuevo(s), ' + plan.actualizados + ' actualizado(s), ' + plan.sinCambios + ' sin cambios', 'ok');
      Datos.setPeriodo(plan.periodo);
      Inventario.render();
    }catch(e){
      console.error(e);
      Object.keys(previos).forEach(k => { try{ localStorage.setItem(k, JSON.stringify(previos[k])); }catch(_){} });
      UI.toast('Error al importar: ' + e.message, 'err');
      Inventario.render();
    }finally{
      _busy = false; const b = document.getElementById('impBtnConfirmar'); if(b) b.disabled = false;
    }
  }

  // ---------- historial ----------
  function abrirHistorial(){
    const imps = Storage.getImportaciones().slice().reverse();
    const body = document.getElementById('histBody');
    body.innerHTML = imps.length ? imps.map(i => '<tr><td>' + esc(Datos.etiquetaPeriodo(i.periodo)) + '</td><td>' + esc(i.archivo) + '<div class="sub" style="font-size:11px">hoja ' + esc(i.hoja) + '</div></td>'
      + '<td>' + new Date(i.importadoEn).toLocaleString('es-DO') + '<div class="sub" style="font-size:11px">' + esc(i.importadoPor) + '</div></td>'
      + '<td class="r">' + (i.resumen.aImportar || 0) + '</td><td class="r">' + (i.resumen.nuevos || 0) + '</td><td class="r">' + (i.resumen.actualizados || 0) + '</td><td class="r">' + (i.resumen.omitidos || 0) + '</td><td class="r">' + (i.resumen.diferenciasConciliacion || 0) + '</td>'
      + '<td class="c"><button class="btn btn-ghost btn-sm" onclick="Importador.verConciliacion(\'' + Utils.jsAttr(i.id) + '\')">Conciliación</button></td></tr>').join('')
      : '<tr><td colspan="9" class="t-empty" style="text-align:center;padding:30px">Aún no hay importaciones.</td></tr>';
    UI.openModal('modalHistorial');
  }

  function verConciliacion(id){
    const i = Storage.getImportaciones().find(x => x.id === id); if(!i) return;
    const c = (i.conciliacion || []).map(c => '<tr><td>' + esc(c.concepto) + '</td><td class="r mono">' + money(c.totalArchivo) + '</td><td class="r mono">' + money(c.sumaFilas) + '</td><td class="r mono" style="' + (c.diferencia !== null && Math.abs(c.diferencia) > 0.01 ? 'color:var(--danger);font-weight:700' : '') + '">' + money(c.diferencia) + '</td><td style="font-size:11.5px">' + esc(c.nota || '') + '</td></tr>').join('');
    document.getElementById('concTitulo').textContent = 'Conciliación · ' + Datos.etiquetaPeriodo(i.periodo) + ' · ' + i.archivo;
    document.getElementById('concBody').innerHTML = '<div class="table-wrap"><table class="t"><thead><tr><th>Concepto</th><th class="r">Totales del archivo</th><th class="r">Suma real de los activos</th><th class="r">Diferencia</th><th>Causa</th></tr></thead><tbody>' + c + '</tbody></table></div>'
      + (i.omitidas && i.omitidas.length ? '<p class="sub" style="margin-top:10px">Omitidos: ' + i.omitidas.map(o => 'fila ' + o.fila + ' (' + esc(o.motivo) + ')').join('; ') + '</p>' : '');
    UI.openModal('modalConciliacion');
  }

  return { abrir, elegirArchivo, cambiarHoja, confirmar, abrirHistorial, verConciliacion };
})();
window.Importador = Importador;
