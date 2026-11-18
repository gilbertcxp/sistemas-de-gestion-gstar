/* ============================================================
   ReferenciaORK — lectura del Excel de integración original ("01. INTEGRACION SJ-ORKAP - …xlsx")
   y conciliación del resultado del sistema contra ese Excel.

   Se usa para: (1) crear el catálogo (ID, nombre, tipo), (2) traer los saldos a favor aplicados (col. H de
   "TOTAL CON SALDO A FAVOR"), (3) demostrar que el sistema reproduce el Excel (reporte de diferencias).
   Nunca modifica el Excel ni corrige diferencias por su cuenta.
   ============================================================ */
(function (root) {
  'use strict';
  const D = root.Dinero || (typeof require !== 'undefined' ? require('./dinero.js') : null);
  const P = root.ParserORK || (typeof require !== 'undefined' ? require('./parser.js') : null);
  const S = root.SemanaORK || (typeof require !== 'undefined' ? require('./semana.js') : null);

  const norm = P.norm;
  const celda = (ws, a) => (ws && ws[a] !== undefined ? ws[a].v : undefined);
  const cent = v => (typeof v === 'number' ? Math.round(v * 100 + (v < 0 ? -1e-9 : 1e-9)) : (v === undefined || v === '' || v === null ? 0 : (D.aCentavos(v) || 0)));
  const letra = n => String.fromCharCode(65 + n);
  function hoja(wb, pred) { const n = wb.SheetNames.find(x => pred(norm(x))); return n ? { nombre: n, ws: wb.Sheets[n] } : null; }
  function filaDe(ws, col, texto, desde, hasta) { for (let r = desde; r <= hasta; r++) if (norm(celda(ws, col + r)) === norm(texto)) return r; return -1; }
  const serialAISO = n => { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };

  // ---------- lectura ----------
  function leer(wb) {
    const ref = { corte: null, catalogo: [], productos: {}, total: null, totalSaldo: null, saldos: [], avisos: [] };
    const mac = hoja(wb, n => n === 'MACROS');
    if (mac) { const a = celda(mac.ws, 'A2'), b = celda(mac.ws, 'B2'); if (typeof a === 'number' && typeof b === 'number') ref.corte = { desde: serialAISO(Math.min(a, b)), hasta: serialAISO(Math.max(a, b)) }; }

    const mapaHojas = { LOTO5: n => n === 'LOTO 5', PRIMERITA: n => n === 'PRIMERITA', QUINIELON: n => n === 'QUINIELON', QUINIELON_FLASH: n => n === 'QUINIELON FLASH' };
    Object.keys(mapaHojas).forEach(p => {
      const h = hoja(wb, mapaHojas[p]); if (!h) { ref.avisos.push('No se encontró la hoja de ' + p); return; }
      const rng = (h.ws['!ref'] || 'A1:A1').match(/(\d+)$/); const fin = rng ? +rng[1] : 200;
      const h0 = filaDe(h.ws, 'B', 'ITEM', 1, 30); if (h0 < 0) { ref.avisos.push('Hoja ' + h.nombre + ': no se encontró la fila de encabezados'); return; }
      const filas = {}, orden = []; let r = h0 + 1;
      for (; r <= fin; r++) {
        const nombre = celda(h.ws, 'C' + r), a = norm(celda(h.ws, 'A' + r));
        if (a === 'TOTAL GENERAL') break;
        if (nombre === undefined || nombre === '') continue;
        const f = { item: celda(h.ws, 'B' + r), D: cent(celda(h.ws, 'D' + r)), E: cent(celda(h.ws, 'E' + r)), F: cent(celda(h.ws, 'F' + r)), G: cent(celda(h.ws, 'G' + r)), H: cent(celda(h.ws, 'H' + r)), I: cent(celda(h.ws, 'I' + r)), J: cent(celda(h.ws, 'J' + r)) };
        filas[norm(nombre)] = { nombre: String(nombre), ...f }; orden.push(norm(nombre));
      }
      const t = {}; ['D', 'E', 'F', 'G', 'H', 'I', 'J'].forEach(c => { t[c] = cent(celda(h.ws, c + r)); });
      ref.productos[p] = { hoja: h.nombre, filas, orden, total: t };
    });

    const leerTotal = (h) => {
      const h0 = filaDe(h.ws, 'B', 'ID', 1, 30); if (h0 < 0) return null;
      const cols = {}; for (let c = 0; c < 14; c++) { const t = norm(celda(h.ws, letra(c) + h0)); if (t) cols[t] = letra(c); }
      const col = t => { const k = Object.keys(cols).find(x => x.indexOf(t) === 0); return k ? cols[k] : null; };
      const M = { LOTO5: col('LOTO 5'), PRIMERITA: col('PRIMERITA'), QUINIELON_FLASH: col('QUINIELON FLASH'), QUINIELON: cols['QUINIELON'] || null, saldo: col('SALDO A FAVOR'), total: col('TOTAL'), tipo: col('TIPO') };
      const filas = {}, orden = []; let r = h0 + 1; const fin = +((h.ws['!ref'] || '').match(/(\d+)$/) || [0, 200])[1];
      for (; r <= fin; r++) {
        const id = celda(h.ws, 'B' + r), nombre = celda(h.ws, 'C' + r);
        if (norm(nombre) === 'TOTAL GENERAL' || norm(celda(h.ws, 'B' + r)) === 'TOTALES') break;
        if (typeof id !== 'number' || !nombre) continue;
        const f = { id, nombre: String(nombre), tipo: M.tipo ? String(celda(h.ws, M.tipo + r) || '') : '' };
        ['LOTO5', 'PRIMERITA', 'QUINIELON_FLASH', 'QUINIELON', 'saldo', 'total'].forEach(k => { f[k] = M[k] ? cent(celda(h.ws, M[k] + r)) : 0; });
        filas[norm(nombre)] = f; orden.push(norm(nombre));
      }
      const t = {}; ['LOTO5', 'PRIMERITA', 'QUINIELON_FLASH', 'QUINIELON', 'saldo', 'total'].forEach(k => { t[k] = M[k] ? cent(celda(h.ws, M[k] + r)) : 0; });
      return { hoja: h.nombre, filas, orden, total: t };
    };
    const hT = hoja(wb, n => n === 'TOTAL'), hS = hoja(wb, n => n.indexOf('TOTAL CON SALDO') === 0);
    if (hT) ref.total = leerTotal(hT); else ref.avisos.push('No se encontró la hoja TOTAL');
    if (hS) ref.totalSaldo = leerTotal(hS); else ref.avisos.push('No se encontró la hoja TOTAL CON SALDO A FAVOR');
    const base = ref.totalSaldo || ref.total;
    if (base) {
      ref.catalogo = base.orden.map(k => ({ id: base.filas[k].id, nombre: base.filas[k].nombre, tipo: base.filas[k].tipo }));
      ref.saldos = base.orden.filter(k => base.filas[k].saldo !== 0).map(k => ({ id: base.filas[k].id, nombre: base.filas[k].nombre, valorC: base.filas[k].saldo }));
    }
    return ref;
  }

  // ---------- conciliación ----------
  // sem: semana procesada (productos, consolidado, aplicaciones). Devuelve { diferencias, comparados, ok }
  function comparar(sem, ref) {
    const dif = []; let comparados = 0;
    const motivo = (campo, a, b, faltaExcel, faltaSis) => {
      if (faltaExcel) return 'El consorcio no existe en el Excel (la vinculación es por nombre).';
      if (faltaSis) return 'El consorcio no existe en el sistema: falta en el catálogo o no vino en el reporte.';
      if (Math.abs(a - b) <= 1) return 'Diferencia de redondeo (≤ RD$0.01).';
      if (campo === 'Semana anterior') return 'Ajuste de semana anterior distinto: revisa los ajustes cargados.';
      if (campo === 'Saldo a favor') return 'Saldo a favor aplicado distinto: revisa el libro auxiliar y las aplicaciones de la semana.';
      if (/Ventas|Premios/.test(campo)) return 'El importe de origen difiere: revisa el reporte de ORKAPI cargado.';
      return 'Cálculo distinto: revisa las tasas aplicadas.';
    };
    const push = (producto, consorcio, campo, excel, sistema, faltaExcel, faltaSis) => {
      comparados++;
      if (excel !== sistema) dif.push({ producto, consorcio, campo, origenC: excel, calculadoC: sistema, difC: sistema - excel, motivo: motivo(campo, excel, sistema, faltaExcel, faltaSis) });
    };
    const CAMPOS = [['D', 'ventasC', 'Ventas jugadas'], ['E', 'comVentasC', 'Comisión ventas'], ['F', 'premiosC', 'Premios pagados'], ['G', 'comPremiosC', 'Comisión premios'], ['H', 'subtotalC', 'Subtotal'], ['I', 'ajusteC', 'Semana anterior'], ['J', 'totalC', 'Total a facturar']];
    S.IDS.forEach(p => {
      const rp = ref.productos[p], sp = sem.productos && sem.productos[p]; if (!rp || !sp) return;
      const nombre = S.PRODUCTOS_DEF[p].nombre;
      const vistos = new Set();
      sp.filas.forEach(f => {
        const k = norm(f.nombre), e = rp.filas[k]; vistos.add(k);
        CAMPOS.forEach(([c, campo, etq]) => push(nombre, f.nombre, etq, e ? e[c] : 0, f[campo], !e, false));
      });
      rp.orden.filter(k => !vistos.has(k)).forEach(k => CAMPOS.forEach(([c, , etq]) => push(nombre, rp.filas[k].nombre, etq, rp.filas[k][c], 0, false, true)));
      CAMPOS.forEach(([c, campo, etq]) => push(nombre, 'TOTAL GENERAL', etq, rp.total[c], sp.totales[campo], false, false));
    });
    // consolidado general (hoja TOTAL) y con saldo a favor
    const ajust = S.consolidadoAjustado(sem);
    const PCOLS = [['LOTO5', 'LOTO 5'], ['PRIMERITA', 'PRIMERITA'], ['QUINIELON_FLASH', 'QUINIELÓN FLASH'], ['QUINIELON', 'QUINIELÓN']];
    if (ref.total && sem.consolidado) {
      sem.consolidado.filas.forEach(f => { const e = ref.total.filas[norm(f.nombre)];
        PCOLS.forEach(([k, etq]) => push('TOTAL', f.nombre, etq, e ? e[k] : 0, f[k], !e, false)); push('TOTAL', f.nombre, 'Total', e ? e.total : 0, f.totalC, !e, false); });
      PCOLS.forEach(([k, etq]) => push('TOTAL', 'TOTAL GENERAL', etq, ref.total.total[k], sem.consolidado.totales.general[k], false, false)); push('TOTAL', 'TOTAL GENERAL', 'Total', ref.total.total.total, sem.consolidado.totales.general.totalC, false, false);
    }
    if (ref.totalSaldo && ajust) {
      ajust.filas.forEach(f => { const e = ref.totalSaldo.filas[norm(f.nombre)];
        PCOLS.forEach(([k, etq]) => push('TOTAL CON SALDO A FAVOR', f.nombre, etq, e ? e[k] : 0, f[k], !e, false));
        push('TOTAL CON SALDO A FAVOR', f.nombre, 'Saldo a favor', e ? e.saldo : 0, f.saldoC, !e, false); push('TOTAL CON SALDO A FAVOR', f.nombre, 'Total ajustado', e ? e.total : 0, f.totalAjustadoC, !e, false); });
      push('TOTAL CON SALDO A FAVOR', 'TOTAL GENERAL', 'Saldo a favor', ref.totalSaldo.total.saldo, ajust.totales.general.saldoC, false, false);
      push('TOTAL CON SALDO A FAVOR', 'TOTAL GENERAL', 'Total ajustado', ref.totalSaldo.total.total, ajust.totales.general.totalAjustadoC, false, false);
    }
    return { diferencias: dif, comparados, ok: dif.length === 0 };
  }

  const api = { leer, comparar, serialAISO };
  root.ReferenciaORK = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
