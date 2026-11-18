/* ============================================================
   ExportadorORK — Excel de la integración semanal con las SEIS hojas del modelo:
   LOTO 5 · PRIMERITA · QUINIELON · QUINIELON FLASH · TOTAL · TOTAL CON SALDO A FAVOR

   Se genera solo con los datos guardados de la semana (no necesita el Excel original abierto).
   Importes: celdas numéricas con 2 decimales y negativos en rojo; las filas de totales llevan SUM()
   con su valor ya calculado (sin errores de fórmula). Nunca mezcla datos de otra semana.
   ============================================================ */
(function (root) {
  'use strict';
  const D = root.Dinero || (typeof require !== 'undefined' ? require('./dinero.js') : null);
  const S = root.SemanaORK || (typeof require !== 'undefined' ? require('./semana.js') : null);
  const C = root.CalculoORK || (typeof require !== 'undefined' ? require('./calculo.js') : null);

  const FMT = '#,##0.00;[Red]-#,##0.00';
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const dmy = f => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f); return +m[3] + ' de ' + MESES[+m[2] - 1]; };
  const textoCorte = sem => 'Corte Del ' + dmy(sem.desde) + ' al ' + dmy(sem.hasta);
  const col = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const num = c => D.aNumero(c);

  function aplicarFormato(XLSX, ws, desdeFila, hastaFila, cols) {
    for (let r = desdeFila; r <= hastaFila; r++) cols.forEach(c => { const a = col(c) + r; if (ws[a] && ws[a].t === 'n') ws[a].z = FMT; });
  }
  function celdaNum(v, f) { const c = { t: 'n', v: num(v) }; if (f) c.f = f; return c; }

  // ---------- hoja de un producto (misma estructura que el modelo) ----------
  function hojaProducto(XLSX, sem, p) {
    const def = S.PRODUCTOS_DEF[p], pr = sem.productos && sem.productos[p];
    if (!pr) throw new Error('El producto ' + def.nombre + ' no tiene resultados procesados.');
    const loto = p === 'LOTO5', h0 = loto ? 9 : 8, d0 = h0 + 1;
    const aoa = [];
    for (let i = 0; i < d0 - 1; i++) aoa.push([]);
    aoa[2] = ['Integración ORKAPI · semana ' + sem.semana + ' de ' + sem.anio + ' · ' + sem.desde + ' al ' + sem.hasta + ' · ' + S.ESTADOS[sem.estado] + (sem.version ? ' · versión ' + sem.version : '')];
    aoa[4] = ['', 'GSTAR LA PRIMERA'];
    aoa[5] = ['', 'REPORTE PARA PREFACTURA'];
    aoa[6] = ['', 'Loteria ' + def.nombre];
    aoa[7] = ['', '', '', '', textoCorte(sem)];
    const tv = D.bpATexto(pr.tasas.ventasBp), tp = D.bpATexto(pr.tasas.premiosBp);
    aoa[h0 - 1] = ['NO', 'ITEM', 'Consorcios', 'Ventas  Jugadas ', 'Comision ' + tv + ' Ventas', 'Premios Pagados ', 'Comision ' + tp + ' Premios', 'Sub-Total', 'Semana Ant.', 'Total A Facturar '];
    pr.filas.forEach(f => aoa.push(['', f.consorcioId, f.nombre, num(f.ventasC), num(f.comVentasC), num(f.premiosC), num(f.comPremiosC), num(f.subtotalC), num(f.ajusteC), num(f.totalC)]));
    const ultima = d0 + pr.filas.length - 1, tot = ultima + 1, t = pr.totales;
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ['D', 'E', 'F', 'G', 'H', 'I', 'J'].forEach((L, i) => { ws[L + tot] = celdaNum([t.ventasC, t.comVentasC, t.premiosC, t.comPremiosC, t.subtotalC, t.ajusteC, t.totalC][i], 'SUM(' + L + d0 + ':' + L + ultima + ')'); });
    ws['A' + tot] = { t: 's', v: 'TOTAL GENERAL' };
    ws['!ref'] = 'A1:J' + tot;
    aplicarFormato(XLSX, ws, d0, tot, [3, 4, 5, 6, 7, 8, 9]);
    ws['!cols'] = [{ wch: 14 }, { wch: 7 }, { wch: 34 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 18 }];
    ws['!freeze'] = { xSplit: 0, ySplit: h0 };
    return ws;
  }

  // ---------- consolidados ----------
  function cabeceraTotal(sem, titulo) {
    const aoa = []; for (let i = 0; i < 4; i++) aoa.push([]);
    aoa[2] = ['Integración ORKAPI · semana ' + sem.semana + ' de ' + sem.anio + ' · ' + sem.desde + ' al ' + sem.hasta + ' · ' + S.ESTADOS[sem.estado] + (sem.version ? ' · versión ' + sem.version : '')];
    aoa.push(['', titulo]);                                   // fila 5
    aoa.push(['', textoCorte(sem)]);                          // fila 6
    return aoa;
  }
  function hojaTotal(XLSX, sem) {
    const cons = sem.consolidado; if (!cons) throw new Error('La semana no tiene consolidado.');
    const aoa = cabeceraTotal(sem, 'REPORTE DE CUENTAS POR COBRAR PRODUCTOS NO TRADICIONALES');
    aoa.push(['', 'ID', 'Consorcios', 'LOTO 5', 'PRIMERITA', 'QUINIELON FLASH ', 'QUINIELON ', 'SALDO A FAVOR / AJUSTE', '', '', 'TOTAL ']);   // fila 7
    cons.filas.forEach(f => aoa.push(['', f.consorcioId, f.nombre, num(f.LOTO5), num(f.PRIMERITA), num(f.QUINIELON_FLASH), num(f.QUINIELON), num(f.ajusteC), '', '', num(f.totalC)]));
    const d0 = 8, ult = d0 + cons.filas.length - 1, tot = ult + 2;
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const g = cons.totales.general;
    const sumas = { D: g.LOTO5, E: g.PRIMERITA, F: g.QUINIELON_FLASH, G: g.QUINIELON, H: g.ajusteC, K: g.totalC };
    ws['C' + tot] = { t: 's', v: 'TOTAL GENERAL' }; Object.keys(sumas).forEach(L => { ws[L + tot] = celdaNum(sumas[L], 'SUM(' + L + d0 + ':' + L + ult + ')'); });
    const fila = (r, etq, t) => { ws['C' + r] = { t: 's', v: etq }; ws['D' + r] = celdaNum(t.LOTO5); ws['E' + r] = celdaNum(t.PRIMERITA); ws['F' + r] = celdaNum(t.QUINIELON_FLASH); ws['G' + r] = celdaNum(t.QUINIELON); ws['H' + r] = celdaNum(t.ajusteC); ws['K' + r] = celdaNum(t.totalC); };
    fila(tot + 2, 'TOTAL UD', cons.totales.ud); fila(tot + 3, 'TOTAL NO UD', cons.totales.noUd);
    ws['C' + (tot + 4)] = { t: 's', v: 'Consorcios con movimientos' }; ws['D' + (tot + 4)] = { t: 'n', v: cons.totales.consorciosConMovimiento };
    ws['C' + (tot + 5)] = { t: 's', v: 'Consorcios sin tipo validado (cuentan como no UD)' }; ws['D' + (tot + 5)] = { t: 'n', v: cons.totales.sinClasificar };
    ws['!ref'] = 'A1:K' + (tot + 5);
    aplicarFormato(XLSX, ws, d0, tot + 3, [3, 4, 5, 6, 7, 10]);
    ws['!cols'] = [{ wch: 4 }, { wch: 7 }, { wch: 34 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 22 }, { wch: 3 }, { wch: 3 }, { wch: 18 }];
    return ws;
  }
  function hojaTotalSaldo(XLSX, sem) {
    const aj = S.consolidadoAjustado(sem); if (!aj) throw new Error('La semana no tiene consolidado.');
    const aoa = cabeceraTotal(sem, 'REPORTE DE CUENTAS POR COBRAR PRODUCTOS NO TRADICIONALES · CON SALDO A FAVOR');
    aoa.push(['', 'ID', 'Consorcios', 'LOTO 5', 'PRIMERITA', 'QUINIELON FLASH ', 'QUINIELON ', 'SALDO A FAVOR ', '', '', 'TOTAL AJUSTADO', 'TIPO']);
    aj.filas.forEach(f => aoa.push(['', f.consorcioId, f.nombre, num(f.LOTO5), num(f.PRIMERITA), num(f.QUINIELON_FLASH), num(f.QUINIELON), num(f.saldoC), '', '', num(f.totalAjustadoC), f.tipo || '']));
    const d0 = 8, ult = d0 + aj.filas.length - 1, tot = ult + 2;
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const g = aj.totales.general;
    const sumas = { D: g.LOTO5, E: g.PRIMERITA, F: g.QUINIELON_FLASH, G: g.QUINIELON, H: g.saldoC, K: g.totalAjustadoC };
    ws['C' + tot] = { t: 's', v: 'TOTALES' }; Object.keys(sumas).forEach(L => { ws[L + tot] = celdaNum(sumas[L], 'SUM(' + L + d0 + ':' + L + ult + ')'); });
    const fila = (r, etq, t) => { ws['C' + r] = { t: 's', v: etq }; ws['D' + r] = celdaNum(t.LOTO5); ws['E' + r] = celdaNum(t.PRIMERITA); ws['F' + r] = celdaNum(t.QUINIELON_FLASH); ws['G' + r] = celdaNum(t.QUINIELON); ws['H' + r] = celdaNum(t.saldoC); ws['K' + r] = celdaNum(t.totalAjustadoC); };
    fila(tot + 2, 'TOTAL UD', aj.totales.ud); fila(tot + 3, 'TOTAL NO UD', aj.totales.noUd);
    ws['C' + (tot + 5)] = { t: 's', v: 'Consolidado antes de ajustes' }; ws['K' + (tot + 5)] = celdaNum(g.antesC);
    ws['C' + (tot + 6)] = { t: 's', v: 'Saldo a favor aplicado' }; ws['K' + (tot + 6)] = celdaNum(g.saldoC);
    ws['C' + (tot + 7)] = { t: 's', v: 'Total ajustado' }; ws['K' + (tot + 7)] = celdaNum(g.totalAjustadoC);
    ws['!ref'] = 'A1:L' + (tot + 7);
    aplicarFormato(XLSX, ws, d0, tot + 7, [3, 4, 5, 6, 7, 10]);
    ws['!cols'] = [{ wch: 4 }, { wch: 7 }, { wch: 34 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 3 }, { wch: 3 }, { wch: 18 }, { wch: 8 }];
    return ws;
  }

  const NOMBRE_HOJA = { LOTO5: 'LOTO 5', PRIMERITA: 'PRIMERITA', QUINIELON: 'QUINIELON', QUINIELON_FLASH: 'QUINIELON FLASH' };
  function libroCompleto(XLSX, sem) {
    if (!sem.productos || !sem.consolidado) throw new Error('La semana aún no está procesada.');
    const wb = XLSX.utils.book_new();
    S.IDS.forEach(p => XLSX.utils.book_append_sheet(wb, hojaProducto(XLSX, sem, p), NOMBRE_HOJA[p]));
    XLSX.utils.book_append_sheet(wb, hojaTotal(XLSX, sem), 'TOTAL');
    XLSX.utils.book_append_sheet(wb, hojaTotalSaldo(XLSX, sem), 'TOTAL CON SALDO A FAVOR');
    return wb;
  }
  function libroHoja(XLSX, sem, que) {                          // que: id de producto | 'TOTAL' | 'SALDO'
    const wb = XLSX.utils.book_new();
    if (S.IDS.indexOf(que) !== -1) XLSX.utils.book_append_sheet(wb, hojaProducto(XLSX, sem, que), NOMBRE_HOJA[que]);
    else if (que === 'TOTAL') XLSX.utils.book_append_sheet(wb, hojaTotal(XLSX, sem), 'TOTAL');
    else XLSX.utils.book_append_sheet(wb, hojaTotalSaldo(XLSX, sem), 'TOTAL CON SALDO A FAVOR');
    return wb;
  }
  const nombreArchivo = (sem, sufijo) => 'Integracion_ORKAPI_' + sem.id + (sufijo ? '_' + sufijo : '') + '.xlsx';

  const api = { libroCompleto, libroHoja, hojaProducto, hojaTotal, hojaTotalSaldo, nombreArchivo, textoCorte, FMT };
  root.ExportadorORK = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
