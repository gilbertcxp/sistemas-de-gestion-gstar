/* ============================================================
   ParserORK — lectura de los reportes "RESULTADO PROPIETARIO" de ORKAPI (Lotenet)

   Formato REAL observado (resultados_propietario (17).xls): aunque la extensión es .xls, el archivo es HTML
   con UNA tabla. Cabecera:
     REPORTE RESULTADO PROPIETARIO · Agrupado por Consorcios · VENTAS MAYOR IGUAL QUE 0 ·
     Grupos de Juegos <PRODUCTO> · Loteria LA PRIMERA · DESDE dd-Mmm-aaaa · HASTA dd-Mmm-aaaa · PRODUCTOS TODAS
   Tabla: ITEM | CONSORCIOS ("(06) NOMBRE DEL CONSORCIO") | VENTA JUGADAS | PREMIOS PAGADOS | BALANCE FINAL ; pie TOTAL GENERAL.

   El importador:
     - detecta el tipo REAL del archivo por su contenido (nunca por la extensión ni el nombre);
     - lee HTML, Excel binario/xlsx (vía SheetJS, desde AoA) y CSV con el mismo mecanismo de tabla;
     - separa código y nombre del consorcio y NO usa ITEM como identificador (solo es el orden de aparición);
     - permite un mapeo manual de columnas cuando los encabezados no se reconocen;
     - no importa la fila TOTAL GENERAL como consorcio: la devuelve aparte para conciliar;
     - conserva la fila de origen (línea y celdas) para trazabilidad.
   ============================================================ */
(function (root) {
  'use strict';
  const D = root.Dinero || (typeof require !== 'undefined' ? require('./dinero.js') : null);

  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const limpiarTexto = h => String(h).replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

  const MESES = { JAN: 1, FEB: 2, MAR: 3, APR: 4, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DEC: 12, DIC: 12,
    ENE: 1, ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 };
  function parseFecha(s) {                                          // "09-Nov-2026" | "09/11/2026" | "2026-11-09" → "2026-11-09"
    s = String(s == null ? '' : s).trim();
    let m = /^(\d{1,2})[-\/ ]([A-Za-zÁÉÍÓÚáéíóú]{3,10})\.?[-\/ ](\d{4})$/.exec(s);
    if (m) { const mes = MESES[norm(m[2])]; if (mes) return m[3] + '-' + String(mes).padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
    m = /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/.exec(s); if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return m[0];
    return '';
  }

  // ---------- tipo REAL del archivo ----------
  function detectarTipo(bytes) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u.length >= 4 && u[0] === 0xD0 && u[1] === 0xCF && u[2] === 0x11 && u[3] === 0xE0) return 'xls-binario';
    if (u.length >= 4 && u[0] === 0x50 && u[1] === 0x4B && (u[2] === 0x03 || u[2] === 0x05)) return 'xlsx';
    let ini = ''; for (let i = 0; i < Math.min(u.length, 4096); i++) ini += String.fromCharCode(u[i]);
    const t = ini.replace(/^﻿|^\xEF\xBB\xBF/, '').trimStart().toLowerCase();
    if (t.startsWith('<!doctype html') || t.startsWith('<html') || t.indexOf('<table') !== -1 || t.indexOf('<body') !== -1 || t.startsWith('<?xml') && t.indexOf('<table') !== -1) return 'html';
    if (/[,;\t|]/.test(ini) && /\n/.test(ini)) return 'csv';
    return 'desconocido';
  }

  // ---------- cabecera del reporte (texto libre) ----------
  function leerEncabezadoTexto(lineas, textoPlano) {
    const enc = { titulo: '', agrupado: '', filtroVentas: '', grupoJuegos: '', loteria: '', desde: '', hasta: '', productos: '' };
    (lineas || []).forEach(l => {
      const t = String(l).trim(), n = norm(t);
      if (!t) return;
      if (/^REPORTE\b/.test(n) && !enc.titulo) enc.titulo = t;
      else if (/^AGRUPADO POR\b/.test(n)) enc.agrupado = t.replace(/^agrupado por\s*/i, '');
      else if (/^VENTAS\b.*\bQUE\b/.test(n)) enc.filtroVentas = t;
      else if (/^GRUPOS? DE JUEGOS?\b/.test(n)) enc.grupoJuegos = t.replace(/^grupos?\s+de\s+juegos?\s*/i, '').trim();
      else if (/^LOTERIA\b/.test(n)) enc.loteria = t.replace(/^loter[ií]a\s*/i, '').trim();
    });
    const tp = textoPlano || (lineas || []).join(' ');
    const f = /DESDE\s+HASTA\s+(\d{1,2}[-\/ ][A-Za-z]{3,10}\.?[-\/ ]\d{4}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4}|\d{4}-\d{2}-\d{2})\s+(\d{1,2}[-\/ ][A-Za-z]{3,10}\.?[-\/ ]\d{4}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4}|\d{4}-\d{2}-\d{2})/i.exec(tp)
      || /DESDE\s*:?\s*(\d{1,2}[-\/ ][A-Za-z]{3,10}\.?[-\/ ]\d{4}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4}|\d{4}-\d{2}-\d{2}).{0,40}?HASTA\s*:?\s*(\d{1,2}[-\/ ][A-Za-z]{3,10}\.?[-\/ ]\d{4}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4}|\d{4}-\d{2}-\d{2})/i.exec(tp);
    if (f) { enc.desde = parseFecha(f[1]); enc.hasta = parseFecha(f[2]); }
    const p = /PRODUCTOS\s+(.+?)(?:\s+(?:ITEM|CONSORCIOS?)\b|\s*$)/i.exec(tp); if (p) enc.productos = p[1].trim();
    return enc;
  }

  // ---------- HTML ----------
  function leerHTML(texto) {
    const r = { tabla: null, encabezado: null, errores: [] };
    const html = String(texto);
    const mt = /<table[\s\S]*?<\/table>/i.exec(html);
    if (!mt) { r.errores.push('El archivo es HTML pero no contiene ninguna tabla.'); return r; }
    const previo = html.slice(0, mt.index);
    const h4 = [...previo.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map(m => limpiarTexto(m[1]));
    r.encabezado = leerEncabezadoTexto(h4, limpiarTexto(previo));
    const tab = mt[0];
    const cabeceras = [...(/<thead[\s\S]*?<\/thead>/i.exec(tab) || [''])[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(m => limpiarTexto(m[1]));
    const tbody = (/<tbody[\s\S]*?<\/tbody>/i.exec(tab) || [tab])[0];
    const filas = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x => limpiarTexto(x[1]))).filter(f => f.length);
    const tf = /<tfoot[\s\S]*?<\/tfoot>/i.exec(tab);
    const pie = tf ? [...tf[0].matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/gi)].map(m => ({ colspan: +((/colspan\s*=\s*"?(\d+)/i.exec(m[1]) || [0, 1])[1]), texto: limpiarTexto(m[2]) })) : [];
    // el pie usa colspan: se expande para alinear con las columnas de la tabla
    const pieExp = []; pie.forEach(c => { pieExp.push(c.texto); for (let i = 1; i < c.colspan; i++) pieExp.push(''); });
    r.tabla = { cabeceras, filas, pie: pieExp };
    return r;
  }

  // ---------- AoA (Excel binario/xlsx/CSV) ----------
  function leerAoA(aoa, filaEncabezado) {
    const r = { tabla: null, encabezado: null, errores: [] };
    const A = (aoa || []).map(f => (f || []).map(c => (c == null ? '' : typeof c === 'number' ? c : String(c).trim())));
    let h = (filaEncabezado === undefined || filaEncabezado === null || filaEncabezado === '') ? -1 : Math.max(0, parseInt(filaEncabezado, 10) - 1);   // fila 1-based indicada a mano
    for (let i = 0; h < 0 && i < Math.min(A.length, 60); i++) {
      const n = A[i].map(norm);
      if (n.some(c => /^CONSORCIO/.test(c)) && n.some(c => /VENTA/.test(c)) && n.some(c => /PREMIO/.test(c))) { h = i; break; }
    }
    if (h < 0) { r.errores.push('No se encontró la fila de encabezados (CONSORCIOS / VENTA JUGADAS / PREMIOS PAGADOS).'); return r; }
    const lineas = []; for (let i = 0; i < h; i++) A[i].forEach(c => { if (c !== '') lineas.push(String(c)); });
    r.encabezado = leerEncabezadoTexto(lineas, lineas.join(' '));
    const cuerpo = A.slice(h + 1).filter(f => f.some(c => c !== ''));
    const esTotal = f => f.some(c => /^TOTAL\b/.test(norm(c)));
    const iT = cuerpo.findIndex(esTotal);
    r.tabla = { cabeceras: A[h].map(String), filas: (iT >= 0 ? cuerpo.slice(0, iT) : cuerpo).map(f => f.map(String)), pie: iT >= 0 ? cuerpo[iT].map(String) : [] };
    return r;
  }
  function leerCSV(texto, filaEncabezado) {
    const t = String(texto).replace(/^﻿/, '');
    const cab = t.split(/\r?\n/).slice(0, 60).join('\n');
    const cand = [',', ';', '\t', '|'].map(d => [d, (cab.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
    const aoa = t.split(/\r?\n/).map(l => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === cand && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; });
    return leerAoA(aoa, filaEncabezado);
  }

  // ---------- mapeo de columnas ----------
  function detectarMapeo(cabeceras) {
    const m = {};
    (cabeceras || []).forEach((h, i) => {
      const n = norm(h);
      if (m.item === undefined && /^(ITEM|NO\.?|N°|#)$/.test(n)) m.item = i;
      else if (m.consorcio === undefined && /^CONSORCIOS?\b/.test(n)) m.consorcio = i;
      else if (m.ventas === undefined && /^VENTAS?\b.*(JUGADAS?)?/.test(n) && /VENTA/.test(n)) m.ventas = i;
      else if (m.premios === undefined && /PREMIOS?/.test(n)) m.premios = i;
      else if (m.balance === undefined && /BALANCE|RESULTADO|NETO/.test(n)) m.balance = i;
    });
    return m;
  }
  const OBLIGATORIAS = ['consorcio', 'ventas', 'premios'];

  // ---------- filas ----------
  const RE_COD = /^\(\s*(\d+)\s*\)\s*(.+)$/;
  const claveCodigo = c => (c === '' || c == null) ? '' : String(parseInt(c, 10));   // "06" y "6" son el mismo código
  function extraerFilas(tabla, mapeo) {
    const out = { filas: [], total: null, errores: [], advertencias: [] };
    const falt = OBLIGATORIAS.filter(k => mapeo[k] === undefined || mapeo[k] === null || mapeo[k] === '');
    if (falt.length) { out.errores.push('Faltan columnas obligatorias: ' + falt.join(', ') + '. Configura el mapeo de columnas.'); return out; }
    const num = (f, k) => (mapeo[k] === undefined || mapeo[k] === '' ? null : D.aCentavos(f[+mapeo[k]]));
    tabla.filas.forEach((f, i) => {
      const linea = i + 1, texto = String(f[+mapeo.consorcio] == null ? '' : f[+mapeo.consorcio]).trim();
      if (/^TOTAL\b/.test(norm(texto)) || (mapeo.item !== undefined && /^TOTAL\b/.test(norm(f[+mapeo.item])))) return;   // nunca como consorcio
      const m = RE_COD.exec(texto);
      const ventasC = num(f, 'ventas'), premiosC = num(f, 'premios'), balanceC = num(f, 'balance');
      if (ventasC === null || premiosC === null) { out.errores.push('Fila ' + linea + ' (' + texto + '): ventas o premios no son importes válidos.'); return; }
      if (!m) out.advertencias.push('Fila ' + linea + ': "' + texto + '" no trae código entre paréntesis; deberá vincularse manualmente.');
      out.filas.push({ linea, item: mapeo.item !== undefined ? String(f[+mapeo.item]) : String(linea), codigoRaw: m ? m[1] : '', codigo: m ? claveCodigo(m[1]) : '',
        nombre: m ? m[2].trim() : texto, textoConsorcio: texto, ventasC, premiosC, balanceC, celdas: f.slice() });
    });
    // fila TOTAL GENERAL (pie)
    const pie = tabla.pie || [];
    if (pie.length) {
      const c = k => (mapeo[k] === undefined || mapeo[k] === '' ? null : D.aCentavos(pie[+mapeo[k]]));
      const t = { ventasC: c('ventas'), premiosC: c('premios'), balanceC: c('balance') };
      if (t.ventasC !== null || t.premiosC !== null) out.total = t;
    }
    return out;
  }

  // ---------- reporte completo desde el contenido ----------
  // entrada: { texto } para HTML/CSV, o { aoa } ya leído con SheetJS. tipo: salida de detectarTipo
  function leerReporte(entrada, tipo, mapeoManual, filaEncabezado) {
    let r;
    if (tipo === 'html') r = leerHTML(entrada.texto);
    else if (tipo === 'csv') r = leerCSV(entrada.texto, filaEncabezado);
    else if (tipo === 'xls-binario' || tipo === 'xlsx') r = leerAoA(entrada.aoa, filaEncabezado);
    else return { tipo, errores: ['No se reconoce el contenido del archivo: no es HTML, Excel ni CSV.'], advertencias: [], filas: [], total: null, encabezado: null, tabla: null, mapeo: {} };
    const res = { tipo, errores: r.errores.slice(), advertencias: [], filas: [], total: null, encabezado: r.encabezado, tabla: r.tabla, mapeo: {} };
    if (!r.tabla) return res;
    res.mapeo = { ...detectarMapeo(r.tabla.cabeceras), ...(mapeoManual || {}) };
    const e = extraerFilas(r.tabla, res.mapeo);
    res.filas = e.filas; res.total = e.total; res.errores.push(...e.errores); res.advertencias.push(...e.advertencias);
    return res;
  }

  // ---------- producto por el CONTENIDO (no por el nombre del archivo) ----------
  // productos: { LOTO5:{patrones:['LOTOS (LOTO5 Y LOTO 5+)']}, ... }. Comparación exacta normalizada (QUINIELON ≠ QUINIELON FLASH).
  function detectarProducto(grupoJuegos, productos) {
    const g = norm(grupoJuegos);
    if (!g) return { id: null, motivo: 'El reporte no indica el grupo de juegos.' };
    if (g === 'NO TRADICIONALES') return { id: 'GLOBAL', motivo: 'Es el reporte global NO TRADICIONALES (suma de los cuatro productos), no un producto individual.' };
    const hits = Object.keys(productos).filter(id => (productos[id].patrones || []).some(p => norm(p) === g));
    if (hits.length === 1) return { id: hits[0] };
    if (hits.length > 1) return { id: null, ambiguo: hits, motivo: 'El grupo de juegos coincide con más de un producto.' };
    return { id: null, motivo: 'El grupo de juegos "' + grupoJuegos + '" no está configurado en ningún producto.' };
  }

  const api = { norm, parseFecha, detectarTipo, leerHTML, leerAoA, leerCSV, detectarMapeo, extraerFilas, leerReporte, detectarProducto, claveCodigo, limpiarTexto, OBLIGATORIAS };
  root.ParserORK = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
