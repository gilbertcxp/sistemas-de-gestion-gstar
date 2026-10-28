/* ============================================================
   PlanAF — decide QUÉ se importa y QUÉ cambia, sin tocar nada todavía.

   planificar(parsed, existentes, ctx) devuelve el plan completo (nuevos,
   actualizados, sin cambios, advertencias, duplicados y conciliación con
   los totales del archivo). aplicar(plan, existentes) devuelve la nueva
   lista de activos. La importación es IDEMPOTENTE: ejecutarla otra vez con
   el mismo archivo no duplica ni cambia nada.

   Identidad de un activo:
     - con "No. de activo" en el Excel  → se busca por ese número (numeroExcel);
     - sin número en el Excel           → se busca por una huella estable
       (descripción + fecha de adquisición + valor + ordinal); si no existe, el
       sistema le ASIGNA el siguiente número libre (157, 158…) y lo marca
       numeroOrigen = 'asignado'. Si más adelante el Excel trae el número real
       para ese mismo activo, se adopta (no se duplica).

   Valores por período: cada importación guarda los importes REGISTRADOS del
   archivo en activo.valores[periodo]; nunca se recalculan ni se sobrescriben
   los de otros períodos.
   Datos editados a mano (activo.camposEditados) no se pisan al reimportar.
   ============================================================ */
(function (root) {
  'use strict';

  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const CALC = () => root.CalculoAF || (typeof require !== 'undefined' ? require('./calculo.js') : null);
  const pad4 = n => String(n).padStart(4, '0');
  const ultimoPeriodo = a => Object.keys(a.valores || {}).sort().pop() || '';

  // Campos del maestro que vienen del archivo (se pueden volver a importar)
  const CAMPOS_MAESTRO = ['proveedor', 'descripcion', 'referencia', 'ubicacion', 'fechaAdquisicion', 'inicioDepreciacion', 'finDepreciacion',
    'valorAdquisicion', 'cuentaActivo', 'cuentaDepAcum', 'cuentaGasto', 'importeRetiro'];
  // Importes registrados de cada período
  const CAMPOS_VALORES = ['depMensual', 'mesesDepreciados', 'amAcumulada', 'pendiente', 'gastoPeriodo'];

  const huella = f => [norm(f.descripcion), f.fechaAdquisicion || '', f.valorAdquisicion === null ? '' : r2(f.valorAdquisicion).toFixed(2)].join('|');

  function planificar(parsed, existentes, ctx) {
    const C = CALC();
    const tol = C.TOLERANCIA;
    const periodo = parsed.periodo;
    const plan = { periodo, hoja: parsed.hoja, errores: parsed.errores.slice(), filas: [], nuevos: 0, actualizados: 0, sinCambios: 0,
      omitidas: parsed.omitidas.slice(), filasVacias: parsed.filasVacias, duplicados: { numeros: [], referencias: [], similares: [] },
      periodoYaImportado: false, conciliacion: [], asiento: null };
    if (plan.errores.length) return plan;

    const activos = existentes || [];
    const porNumeroExcel = new Map(), porHuella = new Map();
    let maxNumero = 0;
    activos.forEach(a => {
      if (a.numeroExcel !== null && a.numeroExcel !== undefined) porNumeroExcel.set(a.numeroExcel, a);
      else (porHuella.get(a.huella) || porHuella.set(a.huella, []).get(a.huella)).push(a);
      if (typeof a.numero === 'number') maxNumero = Math.max(maxNumero, a.numero);
    });
    plan.periodoYaImportado = activos.some(a => a.valores && a.valores[periodo]);

    // --- duplicados dentro del archivo ---
    const cnt = (arr, key) => arr.reduce((m, x) => { const k = key(x); if (k) (m[k] = m[k] || []).push(x); return m; }, {});
    const porNum = cnt(parsed.filas.filter(f => f.numeroExcel !== null), f => String(f.numeroExcel));
    plan.duplicados.numeros = Object.keys(porNum).filter(k => porNum[k].length > 1).map(k => ({ numero: k, filas: porNum[k].map(f => f.fila) }));
    const porRef = cnt(parsed.filas.filter(f => f.referencia), f => norm(f.referencia));
    plan.duplicados.referencias = Object.keys(porRef).filter(k => porRef[k].length > 1).map(k => ({ referencia: porRef[k][0].referencia, filas: porRef[k].map(f => f.fila), activos: porRef[k].length }));
    const refRepetida = new Set(); plan.duplicados.referencias.forEach(d => d.filas.forEach(fl => refRepetida.add(fl)));
    const porHue = cnt(parsed.filas, f => huella(f));
    plan.duplicados.similares = Object.keys(porHue).filter(k => porHue[k].length > 1).map(k => ({ descripcion: porHue[k][0].descripcion, filas: porHue[k].map(f => f.fila) }));

    // --- fila por fila ---
    const ocupadas = new Set(activos.map(a => a.numero));
    const ordinal = {};
    parsed.filas.forEach(f => {
      const motivos = [], avisos = [], infos = [];
      // revisión: datos que impiden dar un estado con seguridad
      if (!(f.valorAdquisicion > 0)) motivos.push(f.valorAdquisicion === null ? 'Sin valor de adquisición' : 'Valor de adquisición ' + (f.valorAdquisicion < 0 ? 'negativo' : 'en cero') + ' (ajuste/reclasificación)');
      if (!f.fechaAdquisicion) motivos.push('Sin fecha de adquisición');
      if (!f.inicioDepreciacion) motivos.push('Sin fecha de inicio de depreciación');
      if (f.fechaAdquisicion && f.inicioDepreciacion && f.valorAdquisicion !== null) {
        const d = C.derivar(f.valorAdquisicion, f.inicioDepreciacion, parsed.fechaCorte);
        const dif = [];
        if (f.mesesDepreciados === null || Math.abs(d.mesesDepreciados - f.mesesDepreciados) > 1e-6) dif.push('meses');
        if (f.amAcumulada === null || Math.abs(d.amAcumulada - f.amAcumulada) > tol) dif.push('amortización acumulada');
        if (f.pendiente === null || Math.abs(d.pendiente - f.pendiente) > tol) dif.push('pendiente');
        if (f.gastoPeriodo === null || Math.abs(d.gastoPeriodo - f.gastoPeriodo) > tol) dif.push('gasto del período');
        if (dif.length) motivos.push('Importes del archivo no cuadran con el cálculo (' + dif.join(', ') + ')');
      }
      if (f.pendiente === null || f.amAcumulada === null) motivos.push('Faltan importes de depreciación en el archivo');
      // avisos
      if (f.numeroExcel === null) avisos.push('Sin número de activo en el Excel (número asignado por el sistema)');
      if (refRepetida.has(f.fila)) avisos.push('Referencia/serial repetida en otros activos');
      // información
      if (!f.proveedor) infos.push('Sin proveedor'); if (!f.ubicacion) infos.push('Sin ubicación'); if (!f.referencia) infos.push('Sin referencia/serial');

      // identidad
      const h = huella(f);
      let ex = null, accion;
      if (f.numeroExcel !== null) {
        ex = porNumeroExcel.get(f.numeroExcel) || null;
        if (!ex) {                                 // ¿ya existía como activo sin número que ahora trae número real?
          const cand = (porHuella.get(h) || []).find(a => a.numeroOrigen === 'asignado');
          if (cand) ex = cand;
        }
      } else {
        const k = h; ordinal[k] = (ordinal[k] || 0) + 1;
        const lista = porHuella.get(h) || [];
        ex = lista[ordinal[k] - 1] || null;
      }
      let numero;
      if (ex) { numero = ex.numero; accion = null; }
      else {
        if (f.numeroExcel !== null) numero = f.numeroExcel;
        else { do { maxNumero++; } while (ocupadas.has(maxNumero)); numero = maxNumero; }
        ocupadas.add(numero); maxNumero = Math.max(maxNumero, numero);
      }

      const maestro = {}; CAMPOS_MAESTRO.forEach(k => { maestro[k] = f[k] === undefined ? null : f[k]; });
      const reciente = !ex || periodo >= ultimoPeriodo(ex);          // un corte más antiguo no pisa los datos de uno más nuevo
      const valores = {}; CAMPOS_VALORES.forEach(k => { valores[k] = f[k] === undefined ? null : f[k]; });
      valores.fila = f.fila; valores.hoja = parsed.hoja; valores.fechaCorte = parsed.fechaCorte;

      const reg = { fila: f.fila, numero, numeroExcel: f.numeroExcel, existente: ex ? ex.id : null, maestro, valores, motivos, avisos, infos, huella: h, accion: null, cambios: [], reciente };
      if (!ex) { reg.accion = 'nuevo'; plan.nuevos++; }
      else {
        // ¿qué cambiaría? (los campos editados a mano no se tocan)
        const editados = new Set(ex.camposEditados || []);
        if (reciente) CAMPOS_MAESTRO.forEach(k => { if (!editados.has(k) && JSON.stringify(ex[k] === undefined ? null : ex[k]) !== JSON.stringify(maestro[k])) reg.cambios.push(k); });
        const vp = (ex.valores || {})[periodo];
        if (!vp) reg.cambios.push('valores ' + periodo);
        else CAMPOS_VALORES.forEach(k => { if (JSON.stringify(vp[k]) !== JSON.stringify(valores[k])) reg.cambios.push(k + ' (' + periodo + ')'); });
        if (f.numeroExcel !== null && ex.numeroExcel !== f.numeroExcel) reg.cambios.push('número del Excel');
        reg.accion = reg.cambios.length ? 'actualizado' : 'sin cambios';
        if (reg.cambios.length) plan.actualizados++; else plan.sinCambios++;
      }
      plan.filas.push(reg);
    });

    // --- activos ya registrados que este corte no trae (no se borran ni se inactivan: solo se avisa) ---
    const vistos = new Set(plan.filas.map(r => r.existente).filter(Boolean));
    plan.ausentes = activos.filter(a => a.origen === 'importado' && a.estadoRegistro !== 'inactivo' && !vistos.has(a.id)
        && !(a.primerPeriodo && a.primerPeriodo > periodo) && !(a.fechaAdquisicion && parsed.fechaCorte && a.fechaAdquisicion > parsed.fechaCorte))
      .map(a => ({ id: a.id, numero: a.numero, descripcion: a.descripcion }));

    // --- resumen ---
    plan.resumen = {
      ausentes: plan.ausentes.length,
      identificados: parsed.filas.length + parsed.omitidas.length,
      aImportar: plan.filas.length,
      omitidos: plan.omitidas.length,
      conAdvertencias: plan.filas.filter(r => r.motivos.length || r.avisos.length).length,
      enRevision: plan.filas.filter(r => r.motivos.length).length,
      numerosAsignados: plan.filas.filter(r => r.numeroExcel === null && !r.existente).length,
      sinInfo: plan.filas.filter(r => r.infos.length).length
    };

    // --- conciliación con los TOTALES del archivo (sin forzar nada) ---
    const suma = k => r2(parsed.filas.reduce((s, f) => s + (typeof f[k] === 'number' ? f[k] : 0), 0));
    const primera = parsed.filas.length ? parsed.filas[0].fila : null, ultima = parsed.filas.length ? parsed.filas[parsed.filas.length - 1].fila : null;
    const ETQ = { valorAdquisicion: 'Valor de adquisición', depMensual: 'Depreciación mensual', importeRetiro: 'Retiro', amAcumulada: 'Depreciación acumulada', pendiente: 'Pendiente de depreciar', gastoPeriodo: 'Gasto de depreciación del período' };
    Object.keys(ETQ).forEach(k => {
      const t = parsed.totalesArchivo && parsed.totalesArchivo.valores[k];
      const real = suma(k);
      const fila = { concepto: ETQ[k], campo: k, totalArchivo: t === undefined ? null : r2(t), sumaFilas: real, importado: real,
        diferencia: t === undefined ? null : r2(t - real), formula: parsed.totalesArchivo && parsed.totalesArchivo.formulas[k] || null, nota: '' };
      const m = fila.formula && fila.formula.match(/SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)/);
      if (m && fila.diferencia !== null && Math.abs(fila.diferencia) > tol) {
        const a = +m[2], b = +m[4];
        fila.nota = 'La fórmula del archivo (' + fila.formula + ') suma las filas ' + a + '–' + b + ' pero los activos están en las filas ' + primera + '–' + ultima +
          (a > primera ? '; deja fuera ' + (a - primera) + ' fila(s) del inicio' : '') + (b < ultima ? '; deja fuera ' + (ultima - b) + ' fila(s) del final' : '') + '.';
      }
      plan.conciliacion.push(fila);
    });

    // --- asiento contable del archivo vs. gasto por cuenta en el sistema ---
    if (parsed.asientoArchivo && parsed.asientoArchivo.filas.length) {
      const porCuenta = {};
      parsed.filas.forEach(f => { if (typeof f.gastoPeriodo === 'number' && f.cuentaGasto) porCuenta[f.cuentaGasto] = (porCuenta[f.cuentaGasto] || 0) + f.gastoPeriodo; });
      const filas = parsed.asientoArchivo.filas.filter(x => x.debito !== null).map(x => ({ cuenta: x.cuenta, descripcion: x.descripcion, archivo: r2(x.debito), sistema: r2(porCuenta[x.cuenta] || 0), diferencia: r2(x.debito - (porCuenta[x.cuenta] || 0)) }));
      Object.keys(porCuenta).forEach(c => { if (!filas.some(x => x.cuenta === c)) filas.push({ cuenta: c, descripcion: '(cuenta no incluida en el asiento del archivo)', archivo: 0, sistema: r2(porCuenta[c]), diferencia: r2(-porCuenta[c]) }); });
      plan.asiento = { filas, totalArchivo: parsed.asientoArchivo.totalDebito === null ? null : r2(parsed.asientoArchivo.totalDebito), totalSistema: suma('gastoPeriodo'), comentario: (parsed.asientoArchivo.filas[0] || {}).comentario || null };
    }
    plan.resumen.diferenciasConciliacion = plan.conciliacion.filter(c => c.diferencia !== null && Math.abs(c.diferencia) > tol).length;
    return plan;
  }

  // Construye la lista nueva de activos (sin modificar la original)
  function aplicar(plan, existentes, ctx) {
    const ahora = (ctx && ctx.ahora) || new Date().toISOString();
    const usuario = (ctx && ctx.usuario) || '—';
    const lista = (existentes || []).map(a => ({ ...a, valores: { ...(a.valores || {}) } }));
    const porId = new Map(lista.map(a => [a.id, a]));
    plan.filas.forEach(r => {
      let a = r.existente ? porId.get(r.existente) : null;
      const revision = { pendiente: r.motivos.length > 0, motivos: r.motivos.slice() };
      if (!a) {
        let id = 'AF-' + pad4(r.numero); while (porId.has(id)) id += 'b';
        a = { id, numero: r.numero, numeroExcel: r.numeroExcel, numeroOrigen: r.numeroExcel === null ? 'asignado' : 'excel', huella: r.huella, estadoRegistro: 'activo',
          vidaUtilMeses: CALC().VIDA_UTIL_MESES, fechaRetiro: null, motivoRetiro: null, notas: '', camposEditados: [], ajustes: [], origen: 'importado',
          primerPeriodo: plan.periodo, creadoEn: ahora, creadoPor: usuario, valores: {} };
        lista.push(a); porId.set(id, a);
      }
      const reciente = !r.existente || plan.periodo >= ultimoPeriodo(a);   // antes de agregar los valores de este corte
      if (r.existente && reciente) {
        a.huella = r.huella;
        if (r.numeroExcel !== null && a.numeroExcel !== r.numeroExcel) { a.numeroExcel = r.numeroExcel; a.numeroOrigen = 'excel'; a.numero = r.numeroExcel; }
      }
      a.valores[plan.periodo] = { ...r.valores, origen: 'importado', importadoEn: ahora };
      if (!reciente) { a.actualizadoEn = ahora; return; }                  // un corte antiguo solo agrega sus importes
      const editados = new Set(a.camposEditados || []);
      Object.keys(r.maestro).forEach(k => { if (!editados.has(k)) a[k] = r.maestro[k]; });
      a.avisos = r.avisos.slice();
      // La revisión solo se reactiva si el motivo cambió: una revisión ya resuelta por un administrador se respeta
      const prev = a.revision;
      if (!prev || !prev.revisado || JSON.stringify(prev.motivos) !== JSON.stringify(revision.motivos)) a.revision = revision.pendiente ? revision : { pendiente: false, motivos: [] };
      a.actualizadoEn = ahora;
    });
    lista.sort((x, y) => (x.numero || 0) - (y.numero || 0));
    return lista;
  }

  const api = { planificar, aplicar, CAMPOS_MAESTRO, CAMPOS_VALORES, huella };
  root.PlanAF = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
