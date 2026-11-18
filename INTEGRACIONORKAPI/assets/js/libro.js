/* ============================================================
   LibroORK — libro auxiliar de saldos a favor (créditos) por consorcio.

   Es un libro de movimientos que SOLO crece (nunca se borra ni se edita un movimiento confirmado):
   corregir = registrar una REVERSIÓN auditada (movimiento de signo contrario ligado al original).

   Tipos de movimiento (montoC siempre positivo; el efecto sobre el saldo lo da el signo):
     saldo_inicial        (+)  saldo con el que arranca un consorcio (importado o manual)
     credito_generado     (+)  crédito originado en una semana (semanaOrigen) — nunca automático
     credito_utilizado    (−)  crédito aplicado a una semana (semanaAplicacion)
     ajuste_administrativo (±) corrección manual con justificación
     reversion            (∓)  contra-asiento de otro movimiento (revierteId)

   Estados: pendiente (reservado, a la espera de aprobar la semana) · confirmado · anulado (un pendiente cancelado).
   Saldo disponible = Σ efecto de movimientos pendientes y confirmados.
   ============================================================ */
(function (root) {
  'use strict';
  const D = root.Dinero || (typeof require !== 'undefined' ? require('./dinero.js') : null);

  const TIPOS = {
    saldo_inicial: { nombre: 'Saldo inicial', signo: 1 },
    credito_generado: { nombre: 'Crédito generado', signo: 1 },
    credito_utilizado: { nombre: 'Crédito utilizado', signo: -1 },
    ajuste_administrativo: { nombre: 'Ajuste administrativo', signo: 0 },     // el signo va en el movimiento
    reversion: { nombre: 'Reversión', signo: 0 }
  };
  const signoDe = m => (m.tipo === 'ajuste_administrativo' || m.tipo === 'reversion') ? (m.signo === -1 ? -1 : 1) : TIPOS[m.tipo].signo;
  const efecto = m => signoDe(m) * m.montoC;
  const vigente = m => m.estado === 'confirmado' || m.estado === 'pendiente';

  function saldo(ledger, consorcioId) {
    return ledger.filter(m => m.consorcioId === consorcioId && vigente(m)).reduce((s, m) => s + efecto(m), 0);
  }

  // Resumen por consorcio para la pantalla de control de saldos
  function resumen(ledger) {
    const mapa = new Map();
    const get = id => { if (!mapa.has(id)) mapa.set(id, { consorcioId: id, saldoInicialC: 0, generadosC: 0, utilizadosC: 0, ajustesC: 0, reversionesC: 0, pendienteC: 0, disponibleC: 0, movimientos: 0 }); return mapa.get(id); };
    ledger.filter(vigente).forEach(m => {
      const r = get(m.consorcioId); r.movimientos++;
      const e = efecto(m);
      if (m.tipo === 'saldo_inicial') r.saldoInicialC += e; else if (m.tipo === 'credito_generado') r.generadosC += e;
      else if (m.tipo === 'credito_utilizado') r.utilizadosC += -e; else if (m.tipo === 'ajuste_administrativo') r.ajustesC += e; else r.reversionesC += e;
      if (m.estado === 'pendiente') r.pendienteC += -e;
      r.disponibleC += e;
    });
    return [...mapa.values()];
  }

  // Valida un movimiento NUEVO antes de agregarlo. Devuelve lista de errores (vacía = válido).
  function validar(mov, ledger) {
    const err = [];
    if (!TIPOS[mov.tipo]) err.push('Tipo de movimiento no válido.');
    if (!mov.consorcioId) err.push('Falta el consorcio.');
    if (!Number.isInteger(mov.montoC) || mov.montoC <= 0) err.push('El monto debe ser mayor que cero.');
    if (!mov.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(mov.fecha)) err.push('La fecha del movimiento no es válida.');
    if (err.length) return err;
    const activos = ledger.filter(m => m.consorcioId === mov.consorcioId && m.estado !== 'anulado');
    if (mov.tipo === 'credito_utilizado') {
      if (!mov.semanaAplicacion) err.push('Indica la semana de aplicación.');
      const disp = saldo(ledger, mov.consorcioId);
      if (mov.montoC > disp) err.push('El crédito a usar (' + D.fmt(mov.montoC) + ') supera el disponible (' + D.fmt(disp) + ').');
      if (activos.some(m => m.tipo === 'credito_utilizado' && m.semanaAplicacion === mov.semanaAplicacion && !m.revertidoPor)) err.push('Este consorcio ya tiene un crédito aplicado en esa semana: revierte el anterior antes de aplicar otro (un mismo movimiento no se aplica dos veces).');
    }
    if (mov.tipo === 'credito_generado') {
      if (!mov.semanaOrigen) err.push('Indica la semana de origen del crédito.');
      if (activos.some(m => m.tipo === 'credito_generado' && m.semanaOrigen === mov.semanaOrigen && !m.revertidoPor)) err.push('Ya existe un crédito generado para este consorcio en la semana de origen indicada (no se duplican créditos).');
    }
    if (mov.tipo === 'ajuste_administrativo') {
      if (!(mov.observaciones || '').trim()) err.push('Un ajuste administrativo requiere justificación.');
      if (mov.signo !== 1 && mov.signo !== -1) err.push('Indica si el ajuste suma o resta.');
      if (mov.signo === -1 && mov.montoC > saldo(ledger, mov.consorcioId)) err.push('El ajuste a la baja supera el saldo disponible.');
    }
    if (mov.tipo === 'saldo_inicial' && !(mov.referencia || mov.observaciones || '').trim()) err.push('Un saldo inicial requiere referencia u observación de su origen.');
    if (activos.some(m => m.id === mov.id)) err.push('Este movimiento ya existe (no se aplica dos veces).');
    return err;
  }

  // Contra-asiento que revierte `orig`; el original queda marcado (revertidoPor) pero se conserva
  function reversion(orig, motivo, usuario, fecha, nuevoId) {
    return { id: nuevoId, consorcioId: orig.consorcioId, tipo: 'reversion', signo: -signoDe(orig), montoC: orig.montoC, fecha, semanaOrigen: orig.semanaOrigen || '',
      semanaAplicacion: orig.semanaAplicacion || '', referencia: 'Reversión de ' + orig.id, observaciones: motivo, estado: 'confirmado', revierteId: orig.id,
      creadoPor: usuario, creadoEn: new Date().toISOString(), aprobadoPor: usuario, aprobadoEn: new Date().toISOString() };
  }
  function puedeRevertir(m, ledger) {
    if (!m || m.tipo === 'reversion') return 'Una reversión no se revierte.';
    if (m.revertidoPor) return 'El movimiento ya fue revertido.';
    if (m.estado === 'anulado') return 'El movimiento está anulado.';
    // revertir un crédito generado/inicial que ya se usó dejaría saldo negativo
    const e = efecto(m);
    if (e > 0 && saldo(ledger, m.consorcioId) - e < 0) return 'No se puede revertir: el crédito ya se utilizó y el saldo quedaría negativo. Revierte primero su aplicación.';
    return '';
  }

  const api = { TIPOS, signoDe, efecto, vigente, saldo, resumen, validar, reversion, puedeRevertir };
  root.LibroORK = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
