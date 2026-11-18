/* ============================================================
   ValidacionORK — validación de cada reporte, vinculación con el catálogo y validación del conjunto semanal.

   Ninguna validación corrige nada por su cuenta: informa (error / advertencia) con el motivo y la fila de origen.
   ============================================================ */
(function (root) {
  'use strict';
  const D = root.Dinero || (typeof require !== 'undefined' ? require('./dinero.js') : null);
  const P = root.ParserORK || (typeof require !== 'undefined' ? require('./parser.js') : null);

  const fmt = c => D.fmt(c);

  // ---------- vinculación por CÓDIGO externo (nunca por ITEM ni por orden) ----------
  // vinculos: { 'codigo|NOMBRE_NORMALIZADO': consorcioId } decisiones manuales del usuario (quedan guardadas en la semana)
  function resolverConsorcios(filas, catalogo, vinculos) {
    const porCodigo = new Map(); catalogo.forEach(c => { if (c.codigo !== undefined && c.codigo !== '') porCodigo.set(P.claveCodigo(c.codigo), c); });
    const vinc = vinculos || {};
    const grupos = new Map(), desconocidos = [], renombrados = [];
    filas.forEach(f => {
      let c = f.codigo ? porCodigo.get(f.codigo) : null;
      const claveV = f.codigo + '|' + P.norm(f.nombre);
      if (!c && vinc[claveV]) c = catalogo.find(x => x.id === vinc[claveV]) || null;
      if (!c) { desconocidos.push({ ...f, clave: claveV, sugerencia: sugerir(f, catalogo) }); return; }
      if (f.codigo && P.norm(c.nombre) !== P.norm(f.nombre) && !(c.alias || []).some(a => P.norm(a) === P.norm(f.nombre))) renombrados.push({ linea: f.linea, codigo: f.codigo, enReporte: f.nombre, enCatalogo: c.nombre });
      const g = grupos.get(c.id) || { consorcioId: c.id, ventasC: 0, premiosC: 0, balanceC: 0, origen: [] };
      g.ventasC += f.ventasC; g.premiosC += f.premiosC; g.balanceC += (f.balanceC === null ? f.ventasC - f.premiosC : f.balanceC);
      g.origen.push({ linea: f.linea, item: f.item, texto: f.textoConsorcio, ventasC: f.ventasC, premiosC: f.premiosC });
      grupos.set(c.id, g);
    });
    return { agrupadas: [...grupos.values()], desconocidos, renombrados, repetidos: [...grupos.values()].filter(g => g.origen.length > 1) };
  }
  function sugerir(f, catalogo) {
    const n = P.norm(f.nombre);
    const c = catalogo.find(x => P.norm(x.nombre) === n || (x.alias || []).some(a => P.norm(a) === n));
    return c ? { id: c.id, nombre: c.nombre, motivo: 'Mismo nombre en el catálogo (sin código vinculado)' } : null;
  }

  // ---------- validación de UN reporte ----------
  // ctx: { slot, semana:{desde,hasta}, catalogo, productos, loteria, productoConfirmado, vinculos }
  function validarReporte(rep, ctx) {
    const r = { errores: [], advertencias: [], info: [], producto: { id: null }, requiereConfirmacion: false, vinculacionPendiente: false,
      desconocidos: [], renombrados: [], repetidos: [], agrupadas: [], ausentes: [], totales: null };
    const err = m => r.errores.push(m), adv = m => r.advertencias.push(m);

    if (rep.tipo === 'desconocido') { err('No se pudo reconocer el contenido del archivo (no es HTML, Excel ni CSV).'); return r; }
    rep.errores.forEach(err);
    rep.advertencias.forEach(adv);
    if (!rep.tabla || r.errores.length) return r;
    if (!rep.filas.length) { err('La tabla no contiene filas de consorcios.'); return r; }

    const enc = rep.encabezado || {};
    // --- producto: por el contenido del reporte ---
    const det = P.detectarProducto(enc.grupoJuegos, ctx.productos);
    r.producto = det;
    if (det.id === 'GLOBAL') err(det.motivo);
    else if (det.id && det.id !== ctx.slot) err('Este archivo corresponde a ' + (ctx.productos[det.id] ? ctx.productos[det.id].nombre : det.id) + ' ("' + enc.grupoJuegos + '"), no a ' + ctx.productos[ctx.slot].nombre + '.');
    else if (!det.id) {
      if (ctx.productoConfirmado === ctx.slot) adv('Producto confirmado manualmente: "' + (enc.grupoJuegos || '—') + '" → ' + ctx.productos[ctx.slot].nombre + '.');
      else { r.requiereConfirmacion = true; err((det.motivo || 'No se pudo identificar el producto.') + ' Confirma que corresponde a ' + ctx.productos[ctx.slot].nombre + ' para continuar.'); }
    }

    // --- lotería y período ---
    if (enc.loteria && ctx.loteria && P.norm(enc.loteria) !== P.norm(ctx.loteria)) err('La lotería del reporte ("' + enc.loteria + '") no es la configurada ("' + ctx.loteria + '").');
    if (enc.desde && enc.hasta) {
      if (enc.desde !== ctx.semana.desde || enc.hasta !== ctx.semana.hasta) err('El período del reporte (' + enc.desde + ' al ' + enc.hasta + ') no coincide con la semana seleccionada (' + ctx.semana.desde + ' al ' + ctx.semana.hasta + ').');
    } else adv('El reporte no incluye fechas: no se puede verificar que corresponda a la semana seleccionada.');

    // --- consorcios, duplicados y desconocidos ---
    const res = resolverConsorcios(rep.filas, ctx.catalogo, ctx.vinculos);
    r.agrupadas = res.agrupadas; r.desconocidos = res.desconocidos; r.renombrados = res.renombrados; r.repetidos = res.repetidos;
    if (res.repetidos.length) adv(res.repetidos.length + ' consorcio(s) aparecen en más de una fila; se agruparon sumando sus importes (' + res.repetidos.slice(0, 5).map(g => (ctx.catalogo.find(c => c.id === g.consorcioId) || {}).nombre).join(', ') + (res.repetidos.length > 5 ? '…' : '') + ').');
    if (res.renombrados.length) adv(res.renombrados.length + ' consorcio(s) traen un nombre distinto al del catálogo con el mismo código: ' + res.renombrados.slice(0, 4).map(x => '(' + x.codigo + ') "' + x.enReporte + '" ≠ "' + x.enCatalogo + '"').join('; ') + '.');
    if (res.desconocidos.length) { r.vinculacionPendiente = true; adv(res.desconocidos.length + ' consorcio(s) del reporte no están en el catálogo: vincúlalos o créalos antes de procesar (' + res.desconocidos.slice(0, 4).map(x => '(' + (x.codigoRaw || '—') + ') ' + x.nombre).join(', ') + (res.desconocidos.length > 4 ? '…' : '') + ').'); }
    const vistos = new Set(res.agrupadas.map(g => g.consorcioId));
    r.ausentes = ctx.catalogo.filter(c => c.estado !== 'inactivo' && !vistos.has(c.id)).map(c => ({ id: c.id, nombre: c.nombre }));
    if (r.ausentes.length) r.info.push(r.ausentes.length + ' consorcio(s) activos del catálogo no vienen en el reporte (se registran con cero).');

    // --- ventas − premios = balance (por fila) ---
    const malas = rep.filas.filter(f => f.balanceC !== null && f.ventasC - f.premiosC !== f.balanceC);
    if (malas.length) err(malas.length + ' fila(s) con ventas − premios ≠ balance final: ' + malas.slice(0, 5).map(f => 'fila ' + f.linea + ' ' + f.nombre + ' (' + fmt(f.ventasC) + ' − ' + fmt(f.premiosC) + ' ≠ ' + fmt(f.balanceC) + ')').join('; ') + (malas.length > 5 ? '…' : ''));
    if (rep.mapeo.balance === undefined) adv('No se identificó la columna BALANCE FINAL: no se pudo validar ventas − premios.');

    // --- totales del reporte (TOTAL GENERAL) ---
    const sv = rep.filas.reduce((s, f) => s + f.ventasC, 0), sp = rep.filas.reduce((s, f) => s + f.premiosC, 0), sb = rep.filas.reduce((s, f) => s + (f.balanceC === null ? f.ventasC - f.premiosC : f.balanceC), 0);
    r.totales = { filas: rep.filas.length, ventasC: sv, premiosC: sp, balanceC: sb, archivo: rep.total };
    if (rep.total) {
      const dif = [];
      if (rep.total.ventasC !== null && rep.total.ventasC !== sv) dif.push('ventas: suma ' + fmt(sv) + ' vs TOTAL GENERAL ' + fmt(rep.total.ventasC));
      if (rep.total.premiosC !== null && rep.total.premiosC !== sp) dif.push('premios: suma ' + fmt(sp) + ' vs TOTAL GENERAL ' + fmt(rep.total.premiosC));
      if (rep.total.balanceC !== null && rep.total.balanceC !== sb) dif.push('balance: suma ' + fmt(sb) + ' vs TOTAL GENERAL ' + fmt(rep.total.balanceC));
      if (dif.length) err('La suma de las filas no coincide con la fila TOTAL GENERAL del reporte (' + dif.join('; ') + ').');
    } else adv('El reporte no trae la fila TOTAL GENERAL: no se pudo conciliar la suma de las filas.');

    const neg = rep.filas.filter(f => f.ventasC < 0 || f.premiosC < 0 || f.balanceC < 0).length;
    if (neg) r.info.push(neg + ' fila(s) con balance negativo (se conservan: es un resultado válido).');
    return r;
  }

  // ---------- validación del conjunto de los cuatro archivos ----------
  // archivos: { LOTO5:{hash, encabezado, validacion, ...}, ... }
  function validarConjunto(archivos, productos, ids) {
    const r = { errores: [], advertencias: [], completo: true };
    ids.forEach(id => { if (!archivos[id] || !archivos[id].cargado) { r.completo = false; r.errores.push('Falta cargar ' + productos[id].nombre + '.'); } });
    const cargados = ids.filter(id => archivos[id] && archivos[id].cargado);
    const hashes = {}; cargados.forEach(id => { const h = archivos[id].hash; if (h) (hashes[h] = hashes[h] || []).push(id); });
    Object.keys(hashes).forEach(h => { if (hashes[h].length > 1) r.errores.push('El mismo archivo se cargó en más de un producto: ' + hashes[h].map(i => productos[i].nombre).join(' y ') + '.'); });
    const per = cargados.filter(id => archivos[id].encabezado && archivos[id].encabezado.desde).map(id => archivos[id].encabezado.desde + '|' + archivos[id].encabezado.hasta);
    if (new Set(per).size > 1) r.errores.push('Los archivos no corresponden al mismo período.');
    const cons = cargados.map(id => (archivos[id].codigos || []).slice().sort().join(','));
    if (new Set(cons).size > 1) r.advertencias.push('Los archivos no traen exactamente los mismos consorcios (el orden no importa; se vincula por código).');
    cargados.forEach(id => { const v = archivos[id].validacion; if (v && v.errores && v.errores.length) r.errores.push(productos[id].nombre + ': tiene errores sin resolver.'); if (v && v.vinculacionPendiente) r.errores.push(productos[id].nombre + ': hay consorcios sin vincular al catálogo.'); });
    return r;
  }

  const api = { resolverConsorcios, validarReporte, validarConjunto, sugerir };
  root.ValidacionORK = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
