/* ============================================================
   Calculo — depreciación de activos fijos y estado del activo.

   Reproduce las fórmulas de la hoja "10-2026" de 02.MOBILIARIO Y EQUIPO.xls:
     G  Inicio depreciación = si el día de adquisición < 15 → día 1 del mismo mes;
                              si no → día 1 del mes siguiente
     H  (rotulada "FECHA RETIRO") = Inicio + 5 años   ← NO es un retiro: es el
                              FIN de la depreciación (vida útil de 60 meses)
     J  Depreciación mensual = Valor adquisición / 60
     K  Meses = DAYS360(Inicio, fecha de corte) / 30, con tope de 60
     M  Amortización acumulada = J × K
     N  Pendiente de depreciar = I − M
     R  Gasto del período ("A DEPRECIAR") = 0 si K = 60; si no, J

   Estos cálculos son DERIVADOS: sirven para activos creados a mano y para
   verificar los importes importados. Los importes REGISTRADOS en el corte
   importado nunca se recalculan ni se sobrescriben.

   Funciona en navegador y en Node (pruebas): no usa DOM.
   ============================================================ */
(function (root) {
  'use strict';

  const VIDA_UTIL_MESES = 60;
  const TOLERANCIA = 0.01;            // RD$0.01: tolerancia monetaria para "totalmente depreciado" y cuadres

  const p = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return { y, m, d }; };
  const finDeFebrero = ({ y, m, d }) => m === 2 && d === (((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 29 : 28);

  // DAYS360 de Excel (método estadounidense / NASD, el predeterminado)
  function days360(desdeISO, hastaISO) {
    const a = p(desdeISO), b = p(hastaISO);
    let d1 = a.d, d2 = b.d;
    if (finDeFebrero(a) && finDeFebrero(b)) d2 = 30;
    if (finDeFebrero(a)) d1 = 30;
    if (d1 === 31) d1 = 30;
    if (d2 === 31 && d1 >= 30) d2 = 30;
    return (b.y - a.y) * 360 + (b.m - a.m) * 30 + (d2 - d1);
  }

  const pad = n => String(n).padStart(2, '0');
  // Inicio de depreciación a partir de la fecha de adquisición (regla de la columna G)
  function inicioDepreciacion(adqISO) {
    const { y, m, d } = p(adqISO);
    if (d < 15) return y + '-' + pad(m) + '-01';
    return m === 12 ? (y + 1) + '-01-01' : y + '-' + pad(m + 1) + '-01';
  }
  // Fin de la depreciación = inicio + 5 años (columna H, mal rotulada "FECHA RETIRO")
  function finDepreciacion(inicioISO) {
    const { y, m, d } = p(inicioISO);
    return (y + VIDA_UTIL_MESES / 12) + '-' + pad(m) + '-' + pad(d);
  }

  // Depreciación derivada de un activo a una fecha de corte
  function derivar(valorAdquisicion, inicioISO, corteISO, vida) {
    vida = vida || VIDA_UTIL_MESES;
    const valor = Number(valorAdquisicion) || 0;
    const depMensual = valor / vida;
    const k = Math.min(vida, days360(inicioISO, corteISO) / 30);
    const amAcumulada = depMensual * k;
    return { depMensual, mesesDepreciados: k, amAcumulada, pendiente: valor - amAcumulada, gastoPeriodo: k === vida ? 0 : depMensual };
  }

  /**
   * Estado de un activo (prioridad):
   *   Retirado → Pendiente de revisión → Totalmente depreciado → En depreciación
   * - "Retirado" SOLO si hay fecha de retiro REAL registrada (nunca por terminar de depreciarse).
   * - "Pendiente de revisión" si tiene inconsistencias o no hay datos para decidir con seguridad.
   * @param a      activo (maestro)
   * @param valores importes del período consultado ({pendiente,...}) o null
   */
  function estadoActivo(a, valores) {
    if (a.fechaRetiro) return 'Retirado';
    if (a.revision && a.revision.pendiente) return 'Pendiente de revisión';
    if (!valores || typeof valores.pendiente !== 'number') return 'Pendiente de revisión';
    return Math.abs(valores.pendiente) <= TOLERANCIA ? 'Totalmente depreciado' : 'En depreciación';
  }

  const api = { VIDA_UTIL_MESES, TOLERANCIA, days360, inicioDepreciacion, finDepreciacion, derivar, estadoActivo };
  root.CalculoAF = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
