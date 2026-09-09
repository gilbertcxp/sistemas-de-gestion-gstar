/* ============================================================
   Consorcio — drill-down nivel 1: grupos de un consorcio
   ============================================================ */
const Consorcio = (() => {

  let _consorcioActualId = null;

  function abrir(consorcioId){
    _consorcioActualId = consorcioId;
    App.switchView('consorcio');
  }

  function render(){
    const c = Storage.getConsorcio(_consorcioActualId);
    if(!c){ App.switchView('dashboard'); return; }

    document.getElementById('consBreadcrumbNombre').textContent = c.nombre;

    const grupos = Storage.getGrupos().filter(g => g.consorcioId === c.id);
    const puntos = Storage.getPuntos().filter(p => p.activo !== false);
    const socios = Storage.getSocios();
    const legalizaciones = Storage.getLegalizaciones();
    const umbralDias = Storage.getSettings().umbralPorVencerDias || 15;
    const hoy = new Date();
    const indice = Estado.construirIndicePuntoLegalizaciones(legalizaciones);

    // KPIs del consorcio
    const grupoIds = new Set(grupos.map(g => g.id));
    const puntosDelConsorcio = puntos.filter(p => grupoIds.has(p.grupoId));
    const counts = { Legalizado:0, 'Por Vencer':0, Vencido:0, Pendiente:0 };
    puntosDelConsorcio.forEach(p => counts[Estado.calcularEstadoPuntoIndexado(p.id, indice, {hoy, umbralDias})]++);
    const set = (id,v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
    set('consKpiTotal', puntosDelConsorcio.length);
    set('consKpiLegalizados', counts.Legalizado);
    set('consKpiPorVencer', counts['Por Vencer']);
    set('consKpiVencidos', counts.Vencido);

    const tbody = document.getElementById('consGrupoBody');
    if(!tbody) return;
    if(grupos.length === 0){
      tbody.innerHTML = `<tr><td colspan="8" class="t-empty">Este consorcio no tiene grupos todavía.</td></tr>`;
      return;
    }

    const rows = grupos.map(g => {
      const socio = socios.find(s => s.id === g.socioId);
      const puntosDelGrupo = puntos.filter(p => p.grupoId === g.id);
      const gc = { Legalizado:0, 'Por Vencer':0, Vencido:0, Pendiente:0 };
      puntosDelGrupo.forEach(p => gc[Estado.calcularEstadoPuntoIndexado(p.id, indice, {hoy, umbralDias})]++);
      const ultimaLeg = legalizaciones
        .filter(l => l.grupoId === g.id && l.estado !== 'Anulada')
        .sort((a,b) => (b.fechaVencimiento||'').localeCompare(a.fechaVencimiento||''))[0];
      const pct = puntosDelGrupo.length > 0 ? Math.round((gc.Legalizado/puntosDelGrupo.length)*1000)/10 : 0;
      return { grupo:g, socio, total:puntosDelGrupo.length, counts:gc, ultimaLeg, pct };
    }).sort((a,b) => b.total - a.total);

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td class="row-clickable" onclick="Grupo.abrir('${Utils.jsAttr(r.grupo.id)}')"><b>${Utils.escapeHtml(r.grupo.nombre)}</b></td>
        <td>${Utils.escapeHtml(r.socio ? r.socio.nombre : '—')}</td>
        <td class="r">${r.total}</td>
        <td class="r">${r.counts.Legalizado}</td>
        <td class="r">${r.counts['Por Vencer']}</td>
        <td class="r">${r.counts.Vencido}</td>
        <td>${r.ultimaLeg ? Utils.fmtDate(r.ultimaLeg.fechaVencimiento) : '—'}</td>
        <td class="c"><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();Legalizacion.abrirModalNueva('${Utils.jsAttr(r.grupo.id)}')">+ Legalizar</button></td>
      </tr>`).join('');
  }

  function volver(){ App.switchView('dashboard'); }

  return { abrir, render, volver, getActualId: () => _consorcioActualId };
})();
window.Consorcio = Consorcio;
