/* ============================================================
   ParserAF — lee una hoja de "02.MOBILIARIO Y EQUIPO.xls" (p. ej. "10-2026").

   Estructura real de la hoja (verificada con 10-2026):
     Fila 3   "Al"    → fecha de corte de los cálculos (B3)
     Fila 4   "FECHA" → fecha del reporte (B4)
     Fila 5   encabezados;  filas 6..N  activos;  fila "TOTALES" (en la columna H);
     más abajo "ASIENTO CONTABLE" (cuenta / débito / crédito) — NO son activos.

   Los encabezados NO describen siempre lo que contienen; el mapa de abajo
   documenta la correspondencia real:
     NO. ACTIVO            número del activo (36 filas vienen vacías)
     PROVEEDOR             RNC o nombre del proveedor (solo algunas filas)
     ACTIVOS               descripción… o el nombre del proveedor en las filas antiguas
     REFERENCIA/SERIAL     referencia / serial / factura (texto)
     UBICACIÓN             departamento
     FECHA ADQUISICION, INICIO DEPRECIACION
     FECHA RETIRO          ¡es una FÓRMULA: inicio + 5 años! = fin de depreciación calculado,
                           NO un retiro. Se importa como "finDepreciacion".
     VALOR ADQUISICION
     TOTAL DEPRECIACION MENSUAL, MESES (meses ya depreciados, tope 60)
     RETIRO                importe de retiro (vacío en todas las filas de 10-2026)
     AM. ACUMULADA, AMO. PENDIENTE
     CUENTA ACTIVO / DEPRECIACION ACUMULADA / GASTO DEPRECIACION   → son NÚMEROS DE CUENTA
     A DEPRECIAR           gasto de depreciación del período (0 si ya terminó)

   Reglas: se leen los valores YA registrados en el archivo (no se recalculan);
   los vacíos quedan null (no 0); referencias y números como texto; las filas
   de totales/asiento nunca se importan como activos; nada se descarta en
   silencio (cada fila omitida queda con su motivo).

   Funciona en navegador y en Node (pruebas): recibe XLSX como parámetro.
   ============================================================ */
(function (root) {
  'use strict';

  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
  const pad = n => String(n).padStart(2, '0');

  // Serie de Excel → ISO 'YYYY-MM-DD' (aritmética UTC: no depende de la zona horaria)
  function serialAISO(n) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function aFecha(cell) {
    if (!cell || cell.v === undefined || cell.v === null || cell.v === '') return null;
    if (cell.v instanceof Date) return isNaN(cell.v) ? null : cell.v.getFullYear() + '-' + pad(cell.v.getMonth() + 1) + '-' + pad(cell.v.getDate());
    if (typeof cell.v === 'number') return serialAISO(cell.v);
    const m = String(cell.v).match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
    const d = String(cell.v).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if (d) return d[3] + '-' + pad(d[2]) + '-' + pad(d[1]);
    return null;
  }
  const aNumero = cell => (cell && typeof cell.v === 'number' && isFinite(cell.v)) ? cell.v : null;
  const aTexto = cell => {
    if (!cell || cell.v === undefined || cell.v === null) return null;
    const s = typeof cell.v === 'number' ? String(cell.v) : String(cell.v).trim();
    return s === '' ? null : s;
  };

  // Encabezado (normalizado) → campo
  const CAMPOS = [
    [/^NO ACTIVO$/, 'numero'], [/^PROVEEDOR$/, 'proveedor'], [/^ACTIVOS?$/, 'descripcion'], [/^REFERENCIA/, 'referencia'],
    [/^UBICACION$/, 'ubicacion'], [/^FECHA ADQUISICION$/, 'fechaAdquisicion'], [/^INICIO DEPRECIACION$/, 'inicioDepreciacion'],
    [/^FECHA RETIRO$/, 'finDepreciacion'], [/^VALOR ADQUISICION$/, 'valorAdquisicion'], [/^TOTAL DEPRECIACION MENSUAL$/, 'depMensual'],
    [/^MESES$/, 'mesesDepreciados'], [/^RETIRO$/, 'importeRetiro'], [/^AM ACUMULADA$/, 'amAcumulada'], [/^AMO PENDIENTE$/, 'pendiente'],
    [/^CUENTA ACTIVO$/, 'cuentaActivo'], [/^DEPRECIACION ACUMULADA$/, 'cuentaDepAcum'], [/^GASTO DEPRECIACION$/, 'cuentaGasto'], [/^A DEPRECIAR$/, 'gastoPeriodo']
  ];
  const OBLIGATORIOS = ['numero', 'descripcion', 'fechaAdquisicion', 'inicioDepreciacion', 'valorAdquisicion', 'depMensual', 'mesesDepreciados', 'amAcumulada', 'pendiente', 'cuentaActivo', 'cuentaDepAcum', 'cuentaGasto', 'gastoPeriodo'];

  // "10-2026" → { periodo:'2026-10', etiqueta:'10-2026' }
  function periodoDeHoja(nombre) {
    const m = String(nombre).match(/(\d{1,2})\s*-\s*(\d{4})/);
    return m ? { periodo: m[2] + '-' + pad(m[1]), etiqueta: pad(m[1]) + '-' + m[2] } : null;
  }

  const nombreColumna = i => { let s = '', n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };

  function parsearHoja(XLSX, ws, nombreHoja) {
    const res = { hoja: nombreHoja, errores: [], filas: [], omitidas: [], filasVacias: 0 };
    if (!ws || !ws['!ref']) { res.errores.push('La hoja "' + nombreHoja + '" está vacía.'); return res; }
    const rg = XLSX.utils.decode_range(ws['!ref']);
    const cell = (r, c) => ws[XLSX.utils.encode_cell({ r: r - 1, c })];
    const per = periodoDeHoja(nombreHoja);
    if (per) { res.periodo = per.periodo; res.etiquetaPeriodo = per.etiqueta; }

    // 1) fila de encabezados (se detecta, no se asume)
    let hdr = -1;
    for (let r = 1; r <= Math.min(rg.e.r + 1, 40) && hdr < 0; r++) {
      const textos = []; for (let c = 0; c <= rg.e.c; c++) textos.push(norm((cell(r, c) || {}).v));
      if (textos.indexOf('NO ACTIVO') !== -1 && textos.indexOf('VALOR ADQUISICION') !== -1) hdr = r;
    }
    if (hdr < 0) { res.errores.push('No se encontró la fila de encabezados (NO. ACTIVO, VALOR ADQUISICION…) en la hoja "' + nombreHoja + '".'); return res; }
    res.filaEncabezados = hdr;

    const col = {};            // campo → índice de columna
    for (let c = 0; c <= rg.e.c; c++) {
      const h = norm((cell(hdr, c) || {}).v); if (!h) continue;
      const f = CAMPOS.find(x => x[0].test(h)); if (f && col[f[1]] === undefined) col[f[1]] = c;
    }
    const faltan = OBLIGATORIOS.filter(k => col[k] === undefined);
    if (faltan.length) { res.errores.push('Faltan columnas en la hoja: ' + faltan.join(', ') + '.'); return res; }
    res.columnas = {}; Object.keys(col).forEach(k => { res.columnas[k] = nombreColumna(col[k]); });

    // 2) fecha de corte ("Al") y fecha del reporte ("FECHA")
    for (let r = 1; r < hdr; r++) {
      const rot = norm((cell(r, 0) || {}).v);
      if (rot === 'AL') res.fechaCorte = aFecha(cell(r, 1));
      if (rot === 'FECHA') res.fechaReporte = aFecha(cell(r, 1));
    }
    if (!res.fechaCorte) res.errores.push('No se encontró la fecha de corte ("Al") sobre los encabezados.');

    // 3) activos: desde el encabezado hasta la fila de TOTALES
    let filaTotales = -1;
    const textoEn = (r, k) => aTexto(cell(r, col[k]));
    for (let r = hdr + 1; r <= rg.e.r + 1; r++) {
      if (norm((cell(r, col.finDepreciacion) || {}).v) === 'TOTALES') { filaTotales = r; break; }
      const vacia = (() => { for (let c = 0; c <= rg.e.c; c++) { const x = cell(r, c); if (x && x.v !== undefined && String(x.v).trim() !== '') return false; } return true; })();
      if (vacia) { res.filasVacias++; continue; }

      const f = { fila: r };
      f.numeroExcel = (() => { const n = aNumero(cell(r, col.numero)); return n !== null && Number.isInteger(n) ? n : null; })();
      f.proveedor = textoEn(r, 'proveedor');
      f.descripcion = textoEn(r, 'descripcion');
      f.referencia = textoEn(r, 'referencia');
      f.ubicacion = textoEn(r, 'ubicacion');
      f.fechaAdquisicion = aFecha(cell(r, col.fechaAdquisicion));
      f.inicioDepreciacion = aFecha(cell(r, col.inicioDepreciacion));
      f.finDepreciacion = aFecha(cell(r, col.finDepreciacion));
      f.valorAdquisicion = aNumero(cell(r, col.valorAdquisicion));
      f.depMensual = aNumero(cell(r, col.depMensual));
      f.mesesDepreciados = aNumero(cell(r, col.mesesDepreciados));
      f.importeRetiro = col.importeRetiro !== undefined ? aNumero(cell(r, col.importeRetiro)) : null;
      f.amAcumulada = aNumero(cell(r, col.amAcumulada));
      f.pendiente = aNumero(cell(r, col.pendiente));
      f.cuentaActivo = textoEn(r, 'cuentaActivo');
      f.cuentaDepAcum = textoEn(r, 'cuentaDepAcum');
      f.cuentaGasto = textoEn(r, 'cuentaGasto');
      f.gastoPeriodo = aNumero(cell(r, col.gastoPeriodo));

      // Fila "fantasma": solo fórmulas y cuentas, sin ningún dato propio del activo
      const hayDatos = f.numeroExcel !== null || f.proveedor || f.descripcion || f.referencia || f.ubicacion || f.fechaAdquisicion || (f.valorAdquisicion !== null && f.valorAdquisicion !== 0);
      if (!hayDatos) { res.omitidas.push({ fila: r, motivo: 'Fila sin datos del activo (solo fórmulas y cuentas contables, sin número, descripción, fecha ni valor)' }); continue; }
      res.filas.push(f);
    }
    res.filaTotales = filaTotales;

    // 4) totales del ARCHIVO (solo para conciliar; nunca se importan como activos)
    if (filaTotales > 0) {
      const t = { fila: filaTotales, valores: {}, formulas: {} };
      ['valorAdquisicion', 'depMensual', 'importeRetiro', 'amAcumulada', 'pendiente', 'gastoPeriodo'].forEach(k => {
        if (col[k] === undefined) return; const x = cell(filaTotales, col[k]);
        if (x && typeof x.v === 'number') { t.valores[k] = x.v; if (x.f) t.formulas[k] = x.f; }
      });
      res.totalesArchivo = t;
    } else res.errores.push('No se encontró la fila "TOTALES" (columna "FECHA RETIRO").');

    // 5) asiento contable del archivo (cuenta / débito / crédito): solo para conciliar
    let filaAsiento = -1;
    for (let r = Math.max(filaTotales, hdr) + 1; r <= rg.e.r + 1; r++) {
      for (let c = 0; c <= Math.min(3, rg.e.c); c++) if (norm((cell(r, c) || {}).v) === 'ASIENTO CONTABLE') { filaAsiento = r; break; }
      if (filaAsiento > 0) break;
    }
    if (filaAsiento > 0) {
      const as = { filas: [], totalDebito: null, totalCredito: null };
      let enBlanco = 0;
      for (let r = filaAsiento + 2; r <= rg.e.r + 1; r++) {
        const cuenta = aTexto(cell(r, 1)), desc = aTexto(cell(r, 2));
        if (norm(desc) === 'TOTALES') { as.totalDebito = aNumero(cell(r, 3)); as.totalCredito = aNumero(cell(r, 4)); break; }
        if (!cuenta && !desc) { if (as.filas.length && ++enBlanco > 3) break; continue; }   // hay una fila en blanco antes de TOTALES
        enBlanco = 0;
        as.filas.push({ cuenta, descripcion: desc, debito: aNumero(cell(r, 3)), credito: aNumero(cell(r, 4)), comentario: aTexto(cell(r, 5)) });
      }
      res.asientoArchivo = as;
    }
    return res;
  }

  const api = { parsearHoja, periodoDeHoja, norm, serialAISO };
  root.ParserAF = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
