/* ============================================================
   Estado — deriva el estado de un punto SIEMPRE desde sus
   legalizaciones (nunca se guarda un flag aparte). Regla de negocio
   confirmada: "regularizada" = "legalizada", un solo concepto.
   ============================================================ */
const Estado = (() => {

  // Legalización más reciente y NO anulada que incluye este punto.
  function ultimaLegalizacionDePunto(puntoId, legalizaciones){
    const list = legalizaciones || Storage.getLegalizaciones();
    const propias = list.filter(l => l.estado !== 'Anulada' && Array.isArray(l.puntoIds) && l.puntoIds.indexOf(puntoId) !== -1);
    if(propias.length === 0) return null;
    propias.sort((a,b) => (b.fechaVencimiento||'').localeCompare(a.fechaVencimiento||''));
    return propias[0];
  }

  // 'Legalizado' | 'Por Vencer' | 'Vencido' | 'Pendiente'
  function calcularEstadoPunto(puntoId, opts){
    opts = opts || {};
    const legalizaciones = opts.legalizaciones || Storage.getLegalizaciones();
    const hoy = opts.hoy || new Date();
    const umbralDias = opts.umbralDias != null ? opts.umbralDias : (Storage.getSettings().umbralPorVencerDias || 15);

    const ultima = ultimaLegalizacionDePunto(puntoId, legalizaciones);
    if(!ultima) return 'Pendiente';

    const venc = Utils.parseISODate(ultima.fechaVencimiento);
    if(!venc) return 'Pendiente';
    const dias = Math.floor((venc - hoy) / 86400000);
    if(dias < 0) return 'Vencido';
    if(dias <= umbralDias) return 'Por Vencer';
    return 'Legalizado';
  }

  // 'Vigente' | 'Vencida' | 'Anulada' — de una legalización en sí (no de un punto)
  function calcularEstadoLegalizacion(legalizacion, hoy){
    hoy = hoy || new Date();
    if(legalizacion.estado === 'Anulada') return 'Anulada';
    const venc = Utils.parseISODate(legalizacion.fechaVencimiento);
    if(!venc) return 'Vigente';
    return venc < hoy ? 'Vencida' : 'Vigente';
  }

  const PILL_CLASS = { 'Legalizado':'ok', 'Por Vencer':'warn', 'Vencido':'red', 'Pendiente':'gray',
                        'Vigente':'ok', 'Vencida':'warn', 'Anulada':'gray' };

  // Índice puntoId -> array de legalizaciones que lo incluyen (para no recorrer
  // todas las legalizaciones por cada punto al pintar tablas grandes).
  function construirIndicePuntoLegalizaciones(legalizaciones){
    const idx = new Map();
    (legalizaciones || Storage.getLegalizaciones()).forEach(l => {
      if(l.estado === 'Anulada' || !Array.isArray(l.puntoIds)) return;
      l.puntoIds.forEach(pid => {
        if(!idx.has(pid)) idx.set(pid, []);
        idx.get(pid).push(l);
      });
    });
    return idx;
  }

  // Calcula el estado de un punto usando el índice ya construido (rápido, para tablas grandes)
  function calcularEstadoPuntoIndexado(puntoId, indice, opts){
    opts = opts || {};
    const hoy = opts.hoy || new Date();
    const umbralDias = opts.umbralDias != null ? opts.umbralDias : (Storage.getSettings().umbralPorVencerDias || 15);
    const props = indice.get(puntoId);
    if(!props || props.length === 0) return 'Pendiente';
    let ultima = props[0];
    for(const l of props){ if((l.fechaVencimiento||'') > (ultima.fechaVencimiento||'')) ultima = l; }
    const venc = Utils.parseISODate(ultima.fechaVencimiento);
    if(!venc) return 'Pendiente';
    const dias = Math.floor((venc - hoy) / 86400000);
    if(dias < 0) return 'Vencido';
    if(dias <= umbralDias) return 'Por Vencer';
    return 'Legalizado';
  }

  return {
    calcularEstadoPunto, calcularEstadoLegalizacion, ultimaLegalizacionDePunto,
    construirIndicePuntoLegalizaciones, calcularEstadoPuntoIndexado, PILL_CLASS
  };
})();
window.Estado = Estado;
