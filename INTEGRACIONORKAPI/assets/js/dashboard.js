/* ============================================================
   Dashboard ejecutivo — indicadores, gráficos y tablas de la semana seleccionada
   ============================================================ */
const Dashboard = (() => {
  const S = SemanaORK, L = LibroORK, esc = H.esc;
  const kpi = (t, v, cls, sub) => `<div class="kpi ${cls || ''}"><div class="lbl">${t}</div><div class="val" style="font-size:20px">${v}</div>${sub ? `<div class="sub" style="font-size:11px;margin-top:3px">${sub}</div>` : ''}</div>`;
  const nombre = id => { const c = Storage.getCatalogo().find(x => x.id === id); return c ? c.nombre : ('#' + id); };

  function render(){
    const el = document.getElementById('dashBody'); if(!el) return;
    const sem = App.Ctx.sem, anio = App.Ctx.anio, ledger = Storage.getCreditos();
    const idxAnio = Storage.getIndice().filter(s => s.anio === anio && s.procesada);
    const guia = `<div class="card"><div class="card-body"><b>Tu trabajo cada semana</b><div class="pasos"><span>1 · Seleccionar la semana</span><span>2 · Subir los cuatro reportes</span><span>3 · Validar</span><span>4 · Procesar</span><span>5 · Revisar el consolidado</span><span>6 · Aprobar</span><span>7 · Descargar el Excel</span></div><button class="btn btn-primary" style="margin-top:12px" onclick="App.switchView('cargar')">Cargar reportes</button></div></div>`;
    if(!sem || !sem.productos){
      el.innerHTML = (sem ? `<div class="cc-alert warn">La semana ${sem.semana} de ${sem.anio} todavía no está procesada (${esc(S.ESTADOS[sem.estado].toLowerCase())}).</div>` : '<div class="cc-alert warn">Aún no hay semanas registradas. Empieza cargando los cuatro reportes de ORKAPI.</div>') + guia
        + (idxAnio.length ? '<div class="grid-2" style="margin-top:14px"><div class="card"><div class="card-head"><h3>Evolución de los consolidados</h3></div><div class="card-body" id="dgEvo"></div></div><div></div></div>' : '');
      if(idxAnio.length) _evolucion(idxAnio);
      return;
    }
    const r = sem.resumen, aj = S.consolidadoAjustado(sem).totales.general;
    const disp = L.resumen(ledger).reduce((s, x) => s + x.disponibleC, 0);
    const top = sem.consolidado.filas.slice().sort((a, b) => b.totalC - a.totalC).slice(0, 10);
    const topSaldo = L.resumen(ledger).filter(x => x.disponibleC > 0).sort((a, b) => b.disponibleC - a.disponibleC).slice(0, 10);
    el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px"><div><b>Semana ${sem.semana} de ${sem.anio}</b> · ${H.corte(sem)} · ${H.pillEstado(sem.estado)}</div><button class="btn btn-soft" onclick="Exportar.completa()">Descargar integración completa</button></div>
      <div class="grid-kpi" style="grid-template-columns:repeat(4,1fr)">${kpi('Ventas totales', H.money(r.ventasC), 'blue')}${kpi('Premios pagados', H.money(r.premiosC))}${kpi('Comisiones sobre ventas', H.money(r.comVentasC))}${kpi('Comisiones sobre premios', H.money(r.comPremiosC))}</div>
      <div class="grid-kpi" style="grid-template-columns:repeat(4,1fr);margin-top:12px">${kpi('Consolidado general', H.money(r.consolidadoC), 'indigo')}${kpi('Saldo a favor aplicado', H.money(aj.saldoC), 'red')}${kpi('Total ajustado', H.money(aj.totalAjustadoC), 'ok')}${kpi('Créditos pendientes de aplicar', H.money(disp), '', 'disponibles en el libro auxiliar')}</div>
      <div class="grid-2" style="margin-top:14px"><div class="card"><div class="card-head"><div><h3>Total a facturar por lotería</h3><p class="sub">Semana ${sem.semana}</p></div></div><div class="card-body" id="dgProd"></div></div>
        <div class="card"><div class="card-head"><div><h3>Evolución de los consolidados</h3><p class="sub">Año ${anio}, por semana</p></div></div><div class="card-body" id="dgEvo"></div></div></div>
      <div class="grid-2" style="margin-top:14px"><div class="card"><div class="card-head"><div><h3>Créditos generados y utilizados</h3><p class="sub">Año ${anio}, por semana</p></div></div><div class="card-body" id="dgCred"></div></div>
        <div class="card"><div class="card-head"><div><h3>Consorcios con mayores valores a facturar</h3><p class="sub">Consolidado general · semana ${sem.semana}</p></div></div><div class="card-body pad-0"><div class="table-wrap"><table class="t"><thead><tr><th>Consorcio</th><th class="r">Total</th></tr></thead><tbody>${top.map(f => `<tr><td><a href="javascript:void(0)" onclick="Consorcio.abrir(${f.consorcioId})">${esc(f.nombre)}</a></td>${H.tdm(f.totalC)}</tr>`).join('')}</tbody></table></div></div></div></div>
      <div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Consorcios con mayores saldos a favor</h3><p class="sub">Crédito disponible hoy en el libro auxiliar</p></div></div><div class="card-body pad-0"><div class="table-wrap"><table class="t"><thead><tr><th>Consorcio</th><th class="r">Disponible</th><th class="r">Pendiente de aprobar</th></tr></thead><tbody>${topSaldo.length ? topSaldo.map(x => `<tr><td><a href="javascript:void(0)" onclick="Consorcio.abrir(${x.consorcioId})">${esc(nombre(x.consorcioId))}</a></td>${H.tdm(x.disponibleC)}${H.tdm(x.pendienteC)}</tr>`).join('') : '<tr><td colspan="3" class="t-empty">No hay créditos disponibles.</td></tr>'}</tbody></table></div></div></div>`;
    Graf.barras(document.getElementById('dgProd'), S.IDS.map(H.NOMBRES), [{ nombre: 'Total a facturar', valores: S.IDS.map(p => r.porProducto[p] ? r.porProducto[p].totalC : 0), color: '#1768FF' }], { alto: 230 });
    _evolucion(idxAnio);
    _creditos(idxAnio, ledger);
  }

  function _evolucion(idxAnio){
    const el = document.getElementById('dgEvo'); if(!el) return;
    Graf.lineas(el, idxAnio.map(s => 'S' + s.semana), [{ nombre: 'Consolidado general', valores: idxAnio.map(s => s.consolidadoC), color: '#3E4095' }, { nombre: 'Total ajustado', valores: idxAnio.map(s => s.ajustadoC), color: '#15875A' }], { alto: 230 });
  }
  function _creditos(idxAnio, ledger){
    const el = document.getElementById('dgCred'); if(!el) return;
    const ids = idxAnio.map(s => s.id);
    Graf.barras(el, idxAnio.map(s => 'S' + s.semana), [
      { nombre: 'Generados', valores: ids.map(id => ledger.filter(m => m.tipo === 'credito_generado' && m.semanaOrigen === id && L.vigente(m)).reduce((t, m) => t + m.montoC, 0)), color: '#15875A' },
      { nombre: 'Utilizados', valores: ids.map(id => ledger.filter(m => m.tipo === 'credito_utilizado' && m.semanaAplicacion === id && L.vigente(m)).reduce((t, m) => t + m.montoC, 0)), color: '#ED1556' }], { alto: 230 });
  }

  return { render };
})();
window.Dashboard = Dashboard;
