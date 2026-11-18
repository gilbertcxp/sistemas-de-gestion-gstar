/* ============================================================
   SemanaORK — dominio de la integración semanal (sin pantalla; se prueba en Node)

   Una semana = un corte (lunes a domingo, semana ISO) con los cuatro reportes de ORKAPI.
   Estados:  borrador → archivos_pendientes → en_validacion → procesado → en_revision → aprobado → cerrado
             (reabierto con autorización: vuelve a ser editable y exige nueva aprobación)
   Una semana aprobada o cerrada NO se recalcula: sus resultados y sus tasas quedan congelados.
   ============================================================ */
(function (root) {
  'use strict';
  const D = root.Dinero || (typeof require !== 'undefined' ? require('./dinero.js') : null);
  const C = root.CalculoORK || (typeof require !== 'undefined' ? require('./calculo.js') : null);
  const V = root.ValidacionORK || (typeof require !== 'undefined' ? require('./validacion.js') : null);

  const PRODUCTOS_DEF = {
    LOTO5:           { id: 'LOTO5', nombre: 'LOTO 5', hoja: 'LOTO 5', tasaVentasBp: 800, tasaPremiosBp: 200, patrones: ['LOTOS (LOTO5 Y LOTO 5+)'] },
    PRIMERITA:       { id: 'PRIMERITA', nombre: 'PRIMERITA', hoja: 'PRIMERITA', tasaVentasBp: 500, tasaPremiosBp: 200, patrones: ['PRIMERITAS'] },
    QUINIELON:       { id: 'QUINIELON', nombre: 'QUINIELÓN', hoja: 'QUINIELON', tasaVentasBp: 800, tasaPremiosBp: 200, patrones: ['EL QUINIELON'] },
    QUINIELON_FLASH: { id: 'QUINIELON_FLASH', nombre: 'QUINIELÓN FLASH', hoja: 'QUINIELON FLASH', tasaVentasBp: 500, tasaPremiosBp: 200, patrones: ['QUINIELON FLASH'] }
  };
  const IDS = C.HOJAS_ORDEN;                                     // LOTO5, PRIMERITA, QUINIELON, QUINIELON_FLASH

  const ESTADOS = {
    borrador: 'Borrador', archivos_pendientes: 'Archivos pendientes', en_validacion: 'En validación', procesado: 'Procesado',
    en_revision: 'En revisión', aprobado: 'Aprobado', cerrado: 'Cerrado', reabierto: 'Reabierto con autorización'
  };
  const EDITABLES = ['borrador', 'archivos_pendientes', 'en_validacion', 'procesado', 'en_revision', 'reabierto'];
  const puedeEditar = s => EDITABLES.indexOf(s.estado) !== -1;
  const estaBloqueada = s => !puedeEditar(s);

  // ---------- calendario (semana ISO: lunes a domingo) ----------
  const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
  const iso = dt => dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
  const sumarDias = (dt, n) => new Date(dt.getTime() + n * 86400000);
  function lunesSemana1(anio) { const e4 = utc(anio, 1, 4), dow = (e4.getUTCDay() + 6) % 7; return sumarDias(e4, -dow); }
  function semanasDelAnio(anio) { const l1 = lunesSemana1(anio), l2 = lunesSemana1(anio + 1); return Math.round((l2 - l1) / (7 * 86400000)); }
  function semanaISO(anio, n) { const l = sumarDias(lunesSemana1(anio), (n - 1) * 7); return { desde: iso(l), hasta: iso(sumarDias(l, 6)) }; }
  function semanaDeFecha(f) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f); const dt = utc(+m[1], +m[2], +m[3]);
    const dow = (dt.getUTCDay() + 6) % 7, jueves = sumarDias(dt, 3 - dow), anio = jueves.getUTCFullYear();
    return { anio, semana: Math.round((jueves - lunesSemana1(anio)) / (7 * 86400000)) + 1 };
  }
  const idSemana = (anio, n) => anio + '-S' + String(n).padStart(2, '0');

  // ---------- crear ----------
  function nuevaSemana(anio, n, desde, hasta, usuario, ahora) {
    const r = semanaISO(anio, n), ts = ahora || new Date().toISOString();
    const archivos = {}; IDS.forEach(p => { archivos[p] = { cargado: false, estado: 'pendiente' }; });
    return { id: idSemana(anio, n), anio, semana: n, desde: desde || r.desde, hasta: hasta || r.hasta, estado: 'borrador', version: 0, archivos,
      vinculos: {}, ajustes: [], ajustesAdicionales: [], aplicaciones: [], productos: null, consolidado: null, resumen: null,
      creadoPor: usuario || '', creadoEn: ts, actualizadoEn: ts, historial: [{ en: ts, por: usuario || '', accion: 'crear', detalle: 'Semana ' + n + ' de ' + anio + ' (' + (desde || r.desde) + ' al ' + (hasta || r.hasta) + ')' }] };
  }
  function evento(sem, usuario, accion, detalle) { sem.historial.push({ en: new Date().toISOString(), por: usuario || '', accion, detalle: detalle || '' }); sem.actualizadoEn = new Date().toISOString(); }

  // ---------- estado según los archivos ----------
  function estadoPorArchivos(sem) {
    if (sem.estado !== 'borrador' && sem.estado !== 'archivos_pendientes' && sem.estado !== 'en_validacion') return sem.estado;
    const cargados = IDS.filter(p => sem.archivos[p] && sem.archivos[p].cargado).length;
    if (!cargados) return 'borrador';
    return cargados < IDS.length ? 'archivos_pendientes' : 'en_validacion';
  }

  // ---------- ajustes ----------
  function ajustesPorProducto(sem) {                          // semana anterior, por producto → { consorcioId: centavos }
    const r = {}; IDS.forEach(p => { r[p] = {}; });
    (sem.ajustes || []).filter(a => a.estado !== 'anulado').forEach(a => { if (r[a.producto]) r[a.producto][a.consorcioId] = (r[a.producto][a.consorcioId] || 0) + a.montoC; });
    return r;
  }
  function ajustesAdicionalesMapa(sem) {
    const r = {}; (sem.ajustesAdicionales || []).filter(a => a.estado !== 'anulado').forEach(a => { r[a.consorcioId] = (r[a.consorcioId] || 0) + a.montoC; });
    return r;
  }

  // ---------- recalcular resultados a partir de lo cargado ----------
  // catalogo: consorcios ACTIVOS (orden por id); productosCfg: { LOTO5:{tasaVentasBp, tasaPremiosBp}, ... }
  function recalcular(sem, catalogo, productosCfg) {
    if (estaBloqueada(sem)) throw new Error('La semana está ' + ESTADOS[sem.estado].toLowerCase() + ': no se recalcula.');
    const cat = catalogo.filter(c => c.estado !== 'inactivo').slice().sort((a, b) => a.id - b.id);
    const aj = ajustesPorProducto(sem), productos = {}, problemas = [];
    IDS.forEach(p => {
      const a = sem.archivos[p];
      if (!a || !a.cargado) return;
      const res = V.resolverConsorcios(a.filas, cat, sem.vinculos);
      if (res.desconocidos.length) problemas.push(p + ': ' + res.desconocidos.length + ' consorcio(s) sin vincular');
      const tasas = { ventasBp: productosCfg[p].tasaVentasBp, premiosBp: productosCfg[p].tasaPremiosBp };
      productos[p] = C.calcularProducto(res.agrupadas.map(g => ({ consorcioId: g.consorcioId, ventasC: g.ventasC, premiosC: g.premiosC, origen: g.origen })), tasas, cat, aj[p]);
      productos[p].archivoHash = a.hash; productos[p].totalArchivo = a.total || null;
    });
    if (problemas.length) throw new Error('No se puede procesar: ' + problemas.join('; ') + '.');
    sem.productos = productos;
    const cons = C.consolidar(productos, cat.map(c => ({ id: c.id, codigo: c.codigo, nombre: c.nombre, tipo: c.tipo || '' })), ajustesAdicionalesMapa(sem));
    sem.consolidado = cons;
    sem.resumen = resumenSemana(sem);
    return sem;
  }

  // Para recalcular una semana YA procesada (p. ej. al agregar un ajuste) se usan las tasas que se aplicaron en su
  // procesamiento, no las vigentes hoy: cambiar un porcentaje nunca altera lo ya calculado.
  function cfgConSnapshot(sem, cfg) {
    const r = {}; IDS.forEach(p => {
      const t = sem.productos && sem.productos[p] && sem.productos[p].tasas;
      r[p] = t ? { ...cfg[p], tasaVentasBp: t.ventasBp, tasaPremiosBp: t.premiosBp } : cfg[p];
    });
    return r;
  }

  // Aplicaciones de saldo a favor (centavos positivos usados) → consolidado ajustado
  function consolidadoAjustado(sem) {
    if (!sem.consolidado) return null;
    return C.conSaldoAFavor(sem.consolidado, (sem.aplicaciones || []).filter(a => a.estado !== 'revertido'));
  }

  function resumenSemana(sem) {
    if (!sem.productos || !sem.consolidado) return null;
    const por = {}; let ventasC = 0, premiosC = 0, comVentasC = 0, comPremiosC = 0;
    IDS.forEach(p => { const t = sem.productos[p] && sem.productos[p].totales; if (!t) return; por[p] = { ventasC: t.ventasC, premiosC: t.premiosC, comVentasC: t.comVentasC, comPremiosC: t.comPremiosC, subtotalC: t.subtotalC, ajusteC: t.ajusteC, totalC: t.totalC };
      ventasC += t.ventasC; premiosC += t.premiosC; comVentasC += t.comVentasC; comPremiosC += t.comPremiosC; });
    const aju = consolidadoAjustado(sem).totales.general;
    return { ventasC, premiosC, comVentasC, comPremiosC, porProducto: por, consolidadoC: sem.consolidado.totales.general.totalC, saldoC: aju.saldoC, ajustadoC: aju.totalAjustadoC,
      consorciosConMovimiento: sem.consolidado.totales.consorciosConMovimiento };
  }

  // Fila de resumen para el índice (liviana, para el Control semanal)
  function indice(sem) {
    const r = sem.resumen || null;
    return { id: sem.id, anio: sem.anio, semana: sem.semana, desde: sem.desde, hasta: sem.hasta, estado: sem.estado, version: sem.version,
      archivos: IDS.filter(p => sem.archivos[p] && sem.archivos[p].cargado).length, procesada: !!sem.productos,
      consolidadoC: r ? r.consolidadoC : null, saldoC: r ? r.saldoC : null, ajustadoC: r ? r.ajustadoC : null, porProducto: r ? r.porProducto : null,
      ventasC: r ? r.ventasC : null, premiosC: r ? r.premiosC : null, comVentasC: r ? r.comVentasC : null, comPremiosC: r ? r.comPremiosC : null,
      actualizadoEn: sem.actualizadoEn };
  }

  // ---------- comparación entre dos versiones/semanas ----------
  function diferencias(a, b) {                                // a = anterior, b = nueva
    const out = { productos: [], consorcios: [] };
    IDS.forEach(p => {
      const ta = a && a.productos && a.productos[p] ? a.productos[p].totales : null, tb = b && b.productos && b.productos[p] ? b.productos[p].totales : null;
      out.productos.push({ producto: p, antesC: ta ? ta.totalC : null, despuesC: tb ? tb.totalC : null, difC: (tb ? tb.totalC : 0) - (ta ? ta.totalC : 0) });
    });
    const mapa = new Map();
    const add = (cons, lado) => { if (!cons) return; cons.filas.forEach(f => { const e = mapa.get(f.consorcioId) || { consorcioId: f.consorcioId, nombre: f.nombre, antesC: 0, despuesC: 0 }; e[lado] = f.totalC; mapa.set(f.consorcioId, e); }); };
    add(a && a.consolidado, 'antesC'); add(b && b.consolidado, 'despuesC');
    out.consorcios = [...mapa.values()].map(e => ({ ...e, difC: e.despuesC - e.antesC })).filter(e => e.difC !== 0).sort((x, y) => Math.abs(y.difC) - Math.abs(x.difC));
    return out;
  }

  // ---------- conciliación automática previa a la aprobación ----------
  // ctx: { productosCfg, ledger (movimientos), catalogo }
  function conciliar(sem, ctx) {
    const ch = [], add = (nombre, ok, detalle) => ch.push({ nombre, ok, detalle: detalle || '' });
    const cargados = IDS.filter(p => sem.archivos[p] && sem.archivos[p].cargado);
    add('Se cargaron los cuatro archivos', cargados.length === IDS.length, cargados.length + ' de ' + IDS.length);
    add('Cada archivo está validado sin errores', cargados.every(p => sem.archivos[p].validacion && !sem.archivos[p].validacion.errores.length), '');
    add('El período de los archivos es el de la semana', cargados.every(p => { const e = sem.archivos[p].encabezado; return !e || !e.desde || (e.desde === sem.desde && e.hasta === sem.hasta); }), sem.desde + ' al ' + sem.hasta);
    add('Todos los consorcios están vinculados al catálogo', cargados.every(p => !(sem.archivos[p].validacion && sem.archivos[p].validacion.vinculacionPendiente)), '');
    if (!sem.productos) { add('La semana está procesada', false, 'Aún no se han calculado resultados'); return { ok: false, chequeos: ch }; }
    IDS.forEach(p => {
      const pr = sem.productos[p]; if (!pr) return;
      add(PRODUCTOS_DEF[p].nombre + ': tasas aplicadas = tasas configuradas', pr.tasas.ventasBp === ctx.productosCfg[p].tasaVentasBp && pr.tasas.premiosBp === ctx.productosCfg[p].tasaPremiosBp, D.bpATexto(pr.tasas.ventasBp) + ' / ' + D.bpATexto(pr.tasas.premiosBp));
      const a = sem.archivos[p];
      if (a && a.total) add(PRODUCTOS_DEF[p].nombre + ': ventas y premios = TOTAL GENERAL del reporte', pr.totales.ventasC === a.total.ventasC && pr.totales.premiosC === a.total.premiosC, D.fmt(pr.totales.ventasC) + ' / ' + D.fmt(pr.totales.premiosC));
      add(PRODUCTOS_DEF[p].nombre + ': verificación independiente del cálculo', pr.verificacion && pr.verificacion.ok, '');
    });
    const sumaProd = IDS.reduce((s, p) => s + (sem.productos[p] ? sem.productos[p].totales.totalC : 0), 0), adic = sem.consolidado.totales.general.ajusteC;
    add('Los totales individuales coinciden con el consolidado', sumaProd + adic === sem.consolidado.totales.general.totalC, D.fmt(sumaProd) + ' + ajustes ' + D.fmt(adic) + ' = ' + D.fmt(sem.consolidado.totales.general.totalC));
    const sinOrigen = IDS.reduce((n, p) => n + (sem.productos[p] ? sem.productos[p].filas.filter(f => (f.ventasC || f.premiosC) && !(f.origen && f.origen.length)).length : 0), 0);
    add('No hay importes sin origen identificable', sinOrigen === 0, sinOrigen ? sinOrigen + ' fila(s) sin origen' : '');
    const ap = (sem.aplicaciones || []).filter(a => a.estado !== 'revertido');
    const sumaAp = ap.reduce((s, a) => s + a.montoC, 0);
    const lib = (ctx.ledger || []).filter(m => m.tipo === 'credito_utilizado' && m.semanaAplicacion === sem.id && m.estado !== 'anulado' && !m.revertidoPor);
    const sumaLib = lib.reduce((s, m) => s + m.montoC, 0);
    add('Los saldos a favor aplicados coinciden con el libro auxiliar', sumaAp === sumaLib && ap.every(a => lib.some(m => m.id === a.movimientoId)), D.fmt(sumaAp) + ' vs libro ' + D.fmt(sumaLib));
    const sinTipo = sem.consolidado.totales.general ? sem.consolidado.totales.sinClasificar : 0;
    add('Todos los consorcios tienen tipo validado (UD / no UD)', sinTipo === 0, sinTipo ? sinTipo + ' consorcio(s) sin clasificar (se consideran no UD en los subtotales)' : '');
    return { ok: ch.filter(c => c.nombre.indexOf('Todos los consorcios tienen tipo') !== 0).every(c => c.ok), chequeos: ch };
  }

  const api = { PRODUCTOS_DEF, IDS, ESTADOS, EDITABLES, puedeEditar, estaBloqueada, semanaISO, semanasDelAnio, semanaDeFecha, idSemana, nuevaSemana, evento,
    estadoPorArchivos, ajustesPorProducto, ajustesAdicionalesMapa, recalcular, cfgConSnapshot, consolidadoAjustado, resumenSemana, indice, diferencias, conciliar };
  root.SemanaORK = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
