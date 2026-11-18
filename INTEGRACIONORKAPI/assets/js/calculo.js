/* ============================================================
   Calculo — motor de comisiones y consolidados (reproduce el Excel de integración)

   Por consorcio y producto (hojas LOTO 5 / PRIMERITA / QUINIELON / QUINIELON FLASH):
     COMISIÓN VENTAS   = VENTAS × % ventas        (Excel: =D×0.08 / 0.05)
     COMISIÓN PREMIOS  = PREMIOS × % premios      (Excel: =F×0.02)
     SUBTOTAL          = VENTAS − COM. VENTAS − PREMIOS − COM. PREMIOS   (Excel: =D−E−F−G)
     TOTAL A FACTURAR  = SUBTOTAL + AJUSTE DE SEMANA ANTERIOR            (Excel: =H+I)

   Consolidado (hoja TOTAL):         producto = TOTAL A FACTURAR de cada hoja; total = suma de los 4 + ajustes aplicables.
   Consolidado con saldo a favor:    TOTAL AJUSTADO = total de los 4 productos + SALDO A FAVOR APLICADO (importe negativo).

   Todo en centavos enteros (ver dinero.js). Cada cálculo se verifica de forma INDEPENDIENTE con BigInt
   (verificarLinea): si las dos rutas discrepan, la semana no se guarda.
   ============================================================ */
(function (root) {
  'use strict';
  const D = root.Dinero || (typeof require !== 'undefined' ? require('./dinero.js') : null);

  const n = x => Number(x) || 0;                                  // OJO: nunca usar `| 0` con dinero (trunca a 32 bits)
  const PRODUCTOS_ORDEN = ['LOTO5', 'PRIMERITA', 'QUINIELON_FLASH', 'QUINIELON'];   // orden de columnas de la hoja TOTAL del Excel
  const HOJAS_ORDEN = ['LOTO5', 'PRIMERITA', 'QUINIELON', 'QUINIELON_FLASH'];       // orden de las hojas del libro

  function calcularLinea(i) {
    const ventasC = n(i.ventasC), premiosC = n(i.premiosC), ajusteC = n(i.ajusteC);
    const comVentasC = D.pct(ventasC, i.tasaVentasBp), comPremiosC = D.pct(premiosC, i.tasaPremiosBp);
    const subtotalC = ventasC - comVentasC - premiosC - comPremiosC;
    return { ventasC, comVentasC, premiosC, comPremiosC, subtotalC, ajusteC, totalC: subtotalC + ajusteC };
  }

  // Segunda ruta de cálculo (BigInt, sin Number): debe dar exactamente lo mismo
  function verificarLinea(l, tasaVentasBp, tasaPremiosBp) {
    const B = BigInt, rd = (n, d) => { const neg = n < 0n, a = neg ? -n : n, q = (2n * a + d) / (2n * d); return neg ? -q : q; };
    const cv = rd(B(l.ventasC) * B(tasaVentasBp), 10000n), cp = rd(B(l.premiosC) * B(tasaPremiosBp), 10000n);
    const sub = B(l.ventasC) - cv - B(l.premiosC) - cp, tot = sub + B(l.ajusteC);
    const dif = [];
    if (cv !== B(l.comVentasC)) dif.push('comisión de ventas');
    if (cp !== B(l.comPremiosC)) dif.push('comisión de premios');
    if (sub !== B(l.subtotalC)) dif.push('subtotal');
    if (tot !== B(l.totalC)) dif.push('total');
    return dif;
  }

  const CAMPOS = ['ventasC', 'comVentasC', 'premiosC', 'comPremiosC', 'subtotalC', 'ajusteC', 'totalC'];
  function sumar(filas, campos) {
    const t = {}; (campos || CAMPOS).forEach(c => { t[c] = 0; });
    filas.forEach(f => (campos || CAMPOS).forEach(c => { t[c] += n(f[c]); }));
    return t;
  }

  // filasOrigen: [{consorcioId, ventasC, premiosC, ...}] (ya agrupadas por consorcio); catalogo: consorcios activos.
  // Devuelve UNA fila por consorcio del catálogo (con ceros si no tuvo movimiento).
  function calcularProducto(filasOrigen, tasas, catalogo, ajustesPorConsorcio) {
    const porId = new Map(filasOrigen.map(f => [f.consorcioId, f]));
    const aj = ajustesPorConsorcio || {};
    const filas = catalogo.map(c => {
      const o = porId.get(c.id) || { ventasC: 0, premiosC: 0 };
      const l = calcularLinea({ ventasC: o.ventasC, premiosC: o.premiosC, tasaVentasBp: tasas.ventasBp, tasaPremiosBp: tasas.premiosBp, ajusteC: aj[c.id] || 0 });
      return { consorcioId: c.id, codigo: c.codigo || '', nombre: c.nombre, ...l, conMovimiento: !!(o.ventasC || o.premiosC), origen: o.origen || null };
    });
    const dif = [];
    filas.forEach(f => { const d = verificarLinea(f, tasas.ventasBp, tasas.premiosBp); if (d.length) dif.push({ consorcioId: f.consorcioId, nombre: f.nombre, campos: d }); });
    return { tasas: { ventasBp: tasas.ventasBp, premiosBp: tasas.premiosBp }, filas, totales: sumar(filas), verificacion: { ok: dif.length === 0, diferencias: dif } };
  }

  // productos: { LOTO5:{filas}, ... } → filas por consorcio con una columna por producto
  function consolidar(productos, catalogo, ajustesAdicionales) {
    const adic = ajustesAdicionales || {};
    const filas = catalogo.map(c => {
      const f = { consorcioId: c.id, codigo: c.codigo || '', nombre: c.nombre, tipo: c.tipo || '' };
      let suma = 0;
      PRODUCTOS_ORDEN.forEach(p => {
        const pf = productos[p] && productos[p].filas.find(x => x.consorcioId === c.id);
        f[p] = pf ? pf.totalC : 0; suma += f[p];
        f[p + '_ventasC'] = pf ? pf.ventasC : 0; f[p + '_premiosC'] = pf ? pf.premiosC : 0;
      });
      f.ajusteC = adic[c.id] || 0;
      f.totalC = suma + f.ajusteC;
      f.conMovimiento = PRODUCTOS_ORDEN.some(p => f[p + '_ventasC'] || f[p + '_premiosC']);
      return f;
    });
    return { filas, totales: totalesConsolidado(filas) };
  }

  function totalesConsolidado(filas) {
    const campos = PRODUCTOS_ORDEN.concat(['ajusteC', 'totalC']);
    const t = { general: sumar(filas, campos), ud: sumar(filas.filter(f => f.tipo === 'UD'), campos), noUd: sumar(filas.filter(f => f.tipo !== 'UD'), campos),
      sinClasificar: filas.filter(f => !f.tipo).length, consorciosConMovimiento: filas.filter(f => f.conMovimiento).length, consorcios: filas.length };
    return t;
  }

  // Consolidado con saldo a favor: aplicaciones = [{consorcioId, montoC}] (montoC positivo = crédito usado)
  function conSaldoAFavor(cons, aplicaciones) {
    const usado = {}; (aplicaciones || []).forEach(a => { usado[a.consorcioId] = (usado[a.consorcioId] || 0) + n(a.montoC); });
    const filas = cons.filas.map(f => {
      const antes = PRODUCTOS_ORDEN.reduce((s, p) => s + f[p], 0) + f.ajusteC;
      const saldoC = -(usado[f.consorcioId] || 0);                  // convención del Excel: el saldo a favor aplicado es NEGATIVO
      return { ...f, antesC: antes, saldoC, totalAjustadoC: antes + saldoC };
    });
    const t = {
      general: sumar(filas, PRODUCTOS_ORDEN.concat(['ajusteC', 'antesC', 'saldoC', 'totalAjustadoC'])),
      ud: sumar(filas.filter(f => f.tipo === 'UD'), PRODUCTOS_ORDEN.concat(['saldoC', 'antesC', 'totalAjustadoC'])),
      noUd: sumar(filas.filter(f => f.tipo !== 'UD'), PRODUCTOS_ORDEN.concat(['saldoC', 'antesC', 'totalAjustadoC']))
    };
    return { filas, totales: t };
  }

  const api = { PRODUCTOS_ORDEN, HOJAS_ORDEN, calcularLinea, verificarLinea, calcularProducto, consolidar, conSaldoAFavor, sumar, totalesConsolidado };
  root.CalculoORK = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
