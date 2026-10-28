/* ============================================================
   Reportes — exportaciones a Excel y resumen por cuenta contable.

   Todos los reportes muestran: fecha de generación, período consultado,
   corte y filtros aplicados. Las exportaciones usan TODOS los registros
   (no solo la página visible). Ningún reporte genera asientos contables.
   ============================================================ */
const Reportes = (() => {

  const esc = Utils.escapeHtml;
  const money = v => (v === null || v === undefined) ? '—' : Utils.fmtMoney(v);
  const f = v => v ? Utils.fmtDate(v) : '';
  const redondo = n => Math.round((Number(n) || 0) * 100) / 100;

  function _meta(titulo, filtrosTxt){
    const per = Datos.periodo();
    return [
      ['GSTAR SERVICES S.A. — ' + titulo],
      ['Generado: ' + new Date().toLocaleString('es-DO') + ' · por ' + Permisos.nombre()],
      ['Período: ' + Datos.etiquetaPeriodo(per) + ' · fecha de corte: ' + (Datos.fechaCorte(per) ? Utils.fmtDate(Datos.fechaCorte(per)) : '—')],
      ['Filtros: ' + (filtrosTxt || 'Ninguno')],
      []
    ];
  }

  function _libro(nombreHoja, titulo, filtrosTxt, cabecera, filas, opts){
    opts = opts || {};
    const aoa = _meta(titulo, filtrosTxt);
    aoa.push(cabecera);
    filas.forEach(x => aoa.push(x));
    if(opts.totales) aoa.push(opts.totales);
    if(!filas.length) aoa.push([opts.vacio || 'No hay registros para este reporte.']);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = cabecera.map((c, i) => ({ wch: (opts.anchos && opts.anchos[i]) || Math.max(12, Math.min(44, String(c).length + 4)) }));
    const montos = opts.montos || [];
    const ini = _meta().length + 1;
    for(let r = ini; r < aoa.length; r++){ montos.forEach(c => { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if(cell && typeof cell.v === 'number'){ cell.v = Math.round(cell.v * 100) / 100; cell.z = '#,##0.00'; } }); }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, nombreHoja);
    return wb;
  }
  // Formato de importes (2 decimales, sin ruido de coma flotante) para hojas armadas a mano
  function _montos(ws, cols){
    const rng = XLSX.utils.decode_range(ws['!ref']);
    for(let r = rng.s.r; r <= rng.e.r; r++) cols.forEach(c => { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if(cell && typeof cell.v === 'number'){ cell.v = Math.round(cell.v * 100) / 100; cell.z = '#,##0.00'; } });
  }
  function _guardar(wb, nombre){
    XLSX.writeFile(wb, nombre + '_' + Utils.todayISO() + '.xlsx');
    Storage.addAuditoria({ usuarioNombre: Permisos.nombre(), accion: 'exportar', entidad: 'reporte', entidadId: nombre, detalle: { periodo: Datos.periodo() } });
    UI.toast('Excel generado: ' + nombre, 'ok');
  }

  const SUM = (rows, g) => redondo(rows.reduce((s, r) => s + (Number(g(r)) || 0), 0));

  // ---------- inventario (completo o filtrado) ----------
  const CAB_INV = ['No. activo', 'Descripción', 'Proveedor', 'Referencia / serial', 'Ubicación', 'Categoría', 'F. adquisición', 'Inicio depreciación', 'Fin depreciación (calculado)', 'Fecha de retiro',
    'Valor adquisición', 'Dep. mensual', 'Meses depreciados', 'Dep. acumulada', 'Valor pendiente', 'Dep. del período', 'Cuenta activo', 'Cuenta dep. acumulada', 'Cuenta gasto', 'Estado', 'Origen de importes'];
  const filaInv = r => [r.a.numero, r.a.descripcion || '', r.a.proveedor || '', r.a.referencia || '', r.a.ubicacion || '', r.categoria, f(r.a.fechaAdquisicion), f(r.a.inicioDepreciacion), f(r.a.finDepreciacion), f(r.a.fechaRetiro),
    r.a.valorAdquisicion, r.v ? r.v.depMensual : '', r.v && r.v.mesesDepreciados !== null ? redondo(r.v.mesesDepreciados * 10) / 10 : '', r.v ? r.v.amAcumulada : '', r.v ? r.v.pendiente : '', r.v ? r.v.gastoPeriodo : '',
    r.a.cuentaActivo || '', r.a.cuentaDepAcum || '', r.a.cuentaGasto || '', r.estado, r.v ? (r.v.tipo === 'registrado' ? 'Registrado en el corte' : 'Calculado') : 'Sin importes'];
  const totInv = rows => ['TOTAL (' + rows.length + ' activos)', '', '', '', '', '', '', '', '', '', SUM(rows, r => r.a.valorAdquisicion), SUM(rows, r => r.v && r.v.depMensual), '', SUM(rows, r => r.v && r.v.amAcumulada), SUM(rows, r => r.v && r.v.pendiente), SUM(rows, r => r.v && r.v.gastoPeriodo), '', '', '', '', ''];

  function inventario(soloFiltrado){
    const rows = soloFiltrado ? Inventario.getFiltrado() : Inventario.filas().filter(r => r.estado !== 'Inactivo').sort((a, b) => a.a.numero - b.a.numero);
    if(!Inventario.filas().length){ UI.toast('No hay activos para exportar', 'err'); return; }
    const wb = _libro('Inventario', soloFiltrado ? 'Inventario de activos fijos (resultados filtrados)' : 'Inventario completo de activos fijos',
      soloFiltrado ? Inventario.describeFiltros() : 'Ninguno (todos los activos vigentes)', CAB_INV, rows.map(filaInv), { totales: totInv(rows), montos: [10, 11, 13, 14, 15], anchos: [10, 46, 28, 20, 18, 28, 13, 13, 16, 13, 16, 14, 10, 16, 16, 16, 12, 14, 12, 20, 18] });
    _guardar(wb, soloFiltrado ? 'ActivosFijos_filtrado' : 'ActivosFijos_inventario');
  }

  // ---------- reportes ----------
  const vigentes = () => Inventario.filas().filter(r => r.estado !== 'Inactivo' && r.estado !== 'Retirado');

  function depreciacionPeriodo(){
    const rows = vigentes().sort((a, b) => a.a.numero - b.a.numero);
    const cab = ['No. activo', 'Descripción', 'Categoría', 'Valor adquisición', 'Dep. mensual', 'Meses depreciados', 'Dep. acumulada', 'Valor pendiente', 'Gasto del período', 'Cuenta gasto', 'Estado'];
    const filas = rows.map(r => [r.a.numero, r.a.descripcion || '', r.categoria, r.a.valorAdquisicion, r.v ? r.v.depMensual : '', r.v && r.v.mesesDepreciados !== null ? redondo(r.v.mesesDepreciados * 10) / 10 : '', r.v ? r.v.amAcumulada : '', r.v ? r.v.pendiente : '', r.v ? r.v.gastoPeriodo : '', r.a.cuentaGasto || '', r.estado]);
    const wb = _libro('Depreciación', 'Reporte de depreciación por período', 'Activos vigentes (excluye retirados e inactivos)', cab, filas,
      { totales: ['TOTAL', '', '', SUM(rows, r => r.a.valorAdquisicion), SUM(rows, r => r.v && r.v.depMensual), '', SUM(rows, r => r.v && r.v.amAcumulada), SUM(rows, r => r.v && r.v.pendiente), SUM(rows, r => r.v && r.v.gastoPeriodo), '', ''], montos: [3, 4, 6, 7, 8], anchos: [10, 48, 28, 16, 14, 10, 16, 16, 16, 12, 22] });
    // Hoja 2: gasto del período por cuenta (resumen informativo; NO es un asiento contable)
    const g = _agrupar(rows, r => r.a.cuentaGasto || '(sin cuenta)');
    const aoa = _meta('Gasto de depreciación del período por cuenta', 'Resumen informativo — no es un asiento contable'); aoa.push(['Cuenta gasto', 'Descripción', 'Activos', 'Gasto del período']);
    g.forEach(x => aoa.push([x.clave, (Storage.getSettings().cuentasNombres || {})[x.clave] || '', x.n, x.gasto])); aoa.push(['TOTAL', '', SUM(rows, () => 1), SUM(rows, r => r.v && r.v.gastoPeriodo)]);
    const ws2 = XLSX.utils.aoa_to_sheet(aoa); ws2['!cols'] = [{ wch: 14 }, { wch: 36 }, { wch: 10 }, { wch: 18 }]; _montos(ws2, [3]); XLSX.utils.book_append_sheet(wb, ws2, 'Gasto por cuenta');
    _guardar(wb, 'ActivosFijos_depreciacion_periodo');
  }

  function totalmenteDepreciados(){
    const rows = Inventario.filas().filter(r => r.estado === 'Totalmente depreciado').sort((a, b) => a.a.numero - b.a.numero);
    const cab = ['No. activo', 'Descripción', 'Proveedor', 'Categoría', 'F. adquisición', 'Fin depreciación (calculado)', 'Valor adquisición', 'Dep. acumulada', 'Valor pendiente'];
    const wb = _libro('Totalmente depreciados', 'Activos totalmente depreciados', 'Estado = Totalmente depreciado (pendiente ≤ RD$0.01)', cab,
      rows.map(r => [r.a.numero, r.a.descripcion || '', r.a.proveedor || '', r.categoria, f(r.a.fechaAdquisicion), f(r.a.finDepreciacion), r.a.valorAdquisicion, r.v.amAcumulada, r.v.pendiente]),
      { totales: ['TOTAL (' + rows.length + ')', '', '', '', '', '', SUM(rows, r => r.a.valorAdquisicion), SUM(rows, r => r.v.amAcumulada), SUM(rows, r => r.v.pendiente)], montos: [6, 7, 8], anchos: [10, 48, 28, 28, 13, 16, 16, 16, 16] });
    _guardar(wb, 'ActivosFijos_totalmente_depreciados');
  }

  function retirados(){
    const rows = Inventario.filas().filter(r => r.estado === 'Retirado').sort((a, b) => a.a.numero - b.a.numero);
    const cab = ['No. activo', 'Descripción', 'F. adquisición', 'Fecha de retiro', 'Importe de retiro', 'Motivo', 'Valor adquisición', 'Dep. acumulada', 'Valor pendiente'];
    const wb = _libro('Retirados', 'Activos retirados', 'Activos con fecha de retiro registrada', cab,
      rows.map(r => [r.a.numero, r.a.descripcion || '', f(r.a.fechaAdquisicion), f(r.a.fechaRetiro), r.a.importeRetiro === null ? '' : r.a.importeRetiro, r.a.motivoRetiro || '', r.a.valorAdquisicion, r.v ? r.v.amAcumulada : '', r.v ? r.v.pendiente : '']),
      { montos: [4, 6, 7, 8], vacio: 'No hay activos retirados. (La columna "FECHA RETIRO" del Excel es la fecha de fin de depreciación calculada, no un retiro real.)', anchos: [10, 48, 13, 14, 16, 36, 16, 16, 16] });
    _guardar(wb, 'ActivosFijos_retirados');
  }

  function revision(){
    const rows = Inventario.filas().filter(r => r.estado === 'Pendiente de revisión').sort((a, b) => a.a.numero - b.a.numero);
    const cab = ['No. activo', 'Descripción', 'Referencia / serial', 'F. adquisición', 'Valor adquisición', 'Valor pendiente', 'Motivos de revisión', 'Fila en el Excel'];
    const wb = _libro('Pendientes de revisión', 'Activos pendientes de revisión', 'Estado = Pendiente de revisión', cab,
      rows.map(r => [r.a.numero, r.a.descripcion || '', r.a.referencia || '', f(r.a.fechaAdquisicion), r.a.valorAdquisicion, r.v ? r.v.pendiente : '', ((r.a.revision && r.a.revision.motivos) || ['Sin importes para el período']).join('; '), r.v && r.v.fila ? r.v.fila : '']),
      { montos: [4, 5], anchos: [10, 48, 20, 13, 16, 16, 60, 12] });
    _guardar(wb, 'ActivosFijos_pendientes_revision');
  }

  // ---------- resumen por cuenta contable ----------
  function _agrupar(rows, clave){
    const m = new Map();
    rows.forEach(r => { const k = clave(r); const g = m.get(k) || { clave:k, n:0, costo:0, acum:0, pend:0, gasto:0 }; g.n++; g.costo += Number(r.a.valorAdquisicion) || 0; if(r.v){ g.acum += r.v.amAcumulada || 0; g.pend += r.v.pendiente || 0; g.gasto += r.v.gastoPeriodo || 0; } m.set(k, g); });
    return [...m.values()].sort((a, b) => String(a.clave).localeCompare(String(b.clave))).map(g => ({ ...g, costo:redondo(g.costo), acum:redondo(g.acum), pend:redondo(g.pend), gasto:redondo(g.gasto) }));
  }

  function cuentas(){
    const rows = vigentes();
    const nombres = Storage.getSettings().cuentasNombres || {};
    const tabla = (titulo, clave) => {
      const g = _agrupar(rows, clave);
      const tot = { n:rows.length, costo:SUM(rows, r => r.a.valorAdquisicion), acum:SUM(rows, r => r.v && r.v.amAcumulada), pend:SUM(rows, r => r.v && r.v.pendiente), gasto:SUM(rows, r => r.v && r.v.gastoPeriodo) };
      return '<h4 style="margin:14px 0 6px">' + titulo + '</h4><div class="table-wrap"><table class="t"><thead><tr><th>Cuenta</th><th>Nombre</th><th class="r">Activos</th><th class="r">Valor adquisición</th><th class="r">Dep. acumulada</th><th class="r">Valor pendiente</th><th class="r">Gasto del período</th></tr></thead><tbody>'
        + g.map(x => '<tr><td>' + esc(x.clave) + '</td><td>' + esc(nombres[x.clave] || '') + '</td><td class="r">' + x.n + '</td><td class="r mono">' + money(x.costo) + '</td><td class="r mono">' + money(x.acum) + '</td><td class="r mono">' + money(x.pend) + '</td><td class="r mono">' + money(x.gasto) + '</td></tr>').join('')
        + '<tr style="font-weight:700"><td colspan="2">TOTAL</td><td class="r">' + tot.n + '</td><td class="r mono">' + money(tot.costo) + '</td><td class="r mono">' + money(tot.acum) + '</td><td class="r mono">' + money(tot.pend) + '</td><td class="r mono">' + money(tot.gasto) + '</td></tr></tbody></table></div>';
    };
    document.getElementById('cuentasBody').innerHTML = rows.length
      ? '<p class="sub">Período ' + esc(Datos.etiquetaPeriodo(Datos.periodo())) + ' · activos vigentes (excluye retirados e inactivos). Los nombres de cuenta provienen del asiento del archivo.</p>'
        + tabla('Por cuenta del activo', r => r.a.cuentaActivo || '(sin cuenta)') + tabla('Por cuenta de depreciación acumulada', r => r.a.cuentaDepAcum || '(sin cuenta)') + tabla('Por cuenta de gasto de depreciación', r => r.a.cuentaGasto || '(sin cuenta)')
      : '<p class="sub" style="padding:20px;text-align:center">No hay activos importados.</p>';
    UI.openModal('modalCuentas');
  }

  function cuentasExcel(){
    const rows = vigentes(); const nombres = Storage.getSettings().cuentasNombres || {};
    const wb = XLSX.utils.book_new();
    [['Cuenta activo', r => r.a.cuentaActivo || '(sin cuenta)'], ['Cuenta dep acumulada', r => r.a.cuentaDepAcum || '(sin cuenta)'], ['Cuenta gasto', r => r.a.cuentaGasto || '(sin cuenta)']].forEach(([nom, fn]) => {
      const g = _agrupar(rows, fn);
      const aoa = _meta('Importes por ' + nom.toLowerCase(), 'Activos vigentes (excluye retirados e inactivos)'); aoa.push(['Cuenta', 'Nombre', 'Activos', 'Valor adquisición', 'Dep. acumulada', 'Valor pendiente', 'Gasto del período']);
      g.forEach(x => aoa.push([x.clave, nombres[x.clave] || '', x.n, x.costo, x.acum, x.pend, x.gasto]));
      aoa.push(['TOTAL', '', rows.length, SUM(rows, r => r.a.valorAdquisicion), SUM(rows, r => r.v && r.v.amAcumulada), SUM(rows, r => r.v && r.v.pendiente), SUM(rows, r => r.v && r.v.gastoPeriodo)]);
      const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 14 }, { wch: 36 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }]; _montos(ws, [3, 4, 5, 6]); XLSX.utils.book_append_sheet(wb, ws, nom.slice(0, 31));
    });
    _guardar(wb, 'ActivosFijos_por_cuenta');
  }

  function abrir(){ UI.openModal('modalReportes'); }

  return { abrir, inventario, depreciacionPeriodo, totalmenteDepreciados, retirados, revision, cuentas, cuentasExcel };
})();
window.Reportes = Reportes;
