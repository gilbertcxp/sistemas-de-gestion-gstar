/* ============================================================
   Dashboard — KPIs generales + resumen por consorcio
   ============================================================ */
const Dashboard = (() => {

  function _computeTotals(){
    const puntos = Storage.getPuntos().filter(p => p.activo !== false);
    const legalizaciones = Storage.getLegalizaciones();
    const umbralDias = Storage.getSettings().umbralPorVencerDias || 15;
    const hoy = new Date();
    const indice = Estado.construirIndicePuntoLegalizaciones(legalizaciones);

    const counts = { Legalizado:0, 'Por Vencer':0, Vencido:0, Pendiente:0 };
    puntos.forEach(p => {
      const st = Estado.calcularEstadoPuntoIndexado(p.id, indice, { hoy, umbralDias });
      counts[st]++;
    });
    const total = puntos.length;
    const pctLegalizado = total > 0 ? Math.round((counts.Legalizado / total) * 1000) / 10 : 0;

    const proximasVencer = legalizaciones.filter(l => {
      if(l.estado === 'Anulada') return false;
      const venc = Utils.parseISODate(l.fechaVencimiento);
      if(!venc) return false;
      const dias = Math.floor((venc - hoy) / 86400000);
      return dias >= 0 && dias <= umbralDias;
    });

    return { total, counts, pctLegalizado, indice, umbralDias, hoy,
             consorcios: Storage.getConsorcios().length, grupos: Storage.getGrupos().length,
             legalizacionesVigentes: legalizaciones.filter(l => Estado.calcularEstadoLegalizacion(l, hoy) === 'Vigente').length,
             proximasVencer };
  }

  function render(){
    const t = _computeTotals();
    const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
    set('kpiTotalPuntos', t.total.toLocaleString('es-DO'));
    set('kpiLegalizados', t.counts.Legalizado.toLocaleString('es-DO'));
    set('kpiPorVencer', t.counts['Por Vencer'].toLocaleString('es-DO'));
    set('kpiVencidos', t.counts.Vencido.toLocaleString('es-DO'));
    set('kpiPendientes', t.counts.Pendiente.toLocaleString('es-DO'));
    set('kpiPctLegalizado', t.pctLegalizado + '%');
    set('kpiConsorcios', t.consorcios.toLocaleString('es-DO'));
    set('kpiGrupos', t.grupos.toLocaleString('es-DO'));
    set('kpiLegalizacionesVigentes', t.legalizacionesVigentes.toLocaleString('es-DO'));

    _renderAlertas(t.proximasVencer);
    _renderResumenConsorcios(t);
  }

  function _renderAlertas(proximasVencer){
    const host = document.getElementById('dashAlertas');
    if(!host) return;
    if(proximasVencer.length === 0){ host.innerHTML = ''; return; }
    const grupos = Storage.getGrupos();
    const porGrupo = {};
    proximasVencer.forEach(l => {
      const g = grupos.find(gr => gr.id === l.grupoId);
      const nombre = g ? g.nombre : 'Grupo desconocido';
      porGrupo[nombre] = (porGrupo[nombre]||0) + (l.cantidadPuntos||0);
    });
    host.innerHTML = `<div class="cc-alert warn" style="display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-radius:var(--r-md);background:var(--warn-soft);color:var(--warn);margin-bottom:16px">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="flex:none;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <div>
        <b>Legalizaciones próximas a vencer</b>
        <div style="margin-top:4px;font-size:12.5px">${Object.entries(porGrupo).map(([g,c]) => `${c} punto(s) del grupo <b>${Utils.escapeHtml(g)}</b>`).join(' · ')}</div>
      </div>
    </div>`;
  }

  function _renderResumenConsorcios(t){
    const tbody = document.getElementById('dashConsorcioBody');
    if(!tbody) return;
    const consorcios = Storage.getConsorcios();
    const grupos = Storage.getGrupos();
    const puntos = Storage.getPuntos().filter(p => p.activo !== false);

    if(consorcios.length === 0){
      tbody.innerHTML = `<tr><td colspan="7" class="t-empty">Sin datos todavía — importa el catálogo MASTER para empezar.</td></tr>`;
      return;
    }

    const rows = consorcios.map(c => {
      const gruposDelConsorcio = grupos.filter(g => g.consorcioId === c.id);
      const grupoIds = new Set(gruposDelConsorcio.map(g => g.id));
      const puntosDelConsorcio = puntos.filter(p => grupoIds.has(p.grupoId));
      const counts = { Legalizado:0, 'Por Vencer':0, Vencido:0, Pendiente:0 };
      puntosDelConsorcio.forEach(p => {
        const st = Estado.calcularEstadoPuntoIndexado(p.id, t.indice, { hoy:t.hoy, umbralDias:t.umbralDias });
        counts[st]++;
      });
      const total = puntosDelConsorcio.length;
      const pct = total > 0 ? Math.round((counts.Legalizado/total)*1000)/10 : 0;
      return { consorcio:c, grupos:gruposDelConsorcio.length, total, counts, pct };
    }).sort((a,b) => b.total - a.total);

    tbody.innerHTML = rows.map(r => `
      <tr class="row-clickable" onclick="Consorcio.abrir('${Utils.jsAttr(r.consorcio.id)}')">
        <td><b>${Utils.escapeHtml(r.consorcio.nombre)}</b></td>
        <td class="c">${r.grupos}</td>
        <td class="r">${r.total}</td>
        <td class="r">${r.counts.Legalizado}</td>
        <td class="r">${r.counts['Por Vencer']}</td>
        <td class="r">${r.counts.Vencido}</td>
        <td class="r"><b>${r.pct}%</b></td>
      </tr>`).join('');
  }

  return { render };
})();
window.Dashboard = Dashboard;
