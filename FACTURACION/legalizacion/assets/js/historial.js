/* ============================================================
   Historial — tabla de todas las legalizaciones (vigentes, vencidas
   y anuladas) con filtros por año/mes/consorcio/grupo/punto.
   El filtro de punto usa <input list>+<datalist>, clon del patrón
   de CXC/index.html (_populateEcCliente/ecOnClientChange).
   ============================================================ */
const Historial = (() => {

  let _filters = { anio:'', mes:'', consorcioId:'', grupoId:'', puntoId:'' };

  function _populateFiltros(){
    const consorcios = Storage.getConsorcios().slice().sort((a,b) => a.nombre.localeCompare(b.nombre));
    const selCons = document.getElementById('histConsorcio');
    if(selCons){
      const prev = _filters.consorcioId;
      selCons.innerHTML = `<option value="">Todos los consorcios</option>` +
        consorcios.map(c => `<option value="${Utils.escapeHtml(c.id)}">${Utils.escapeHtml(c.nombre)}</option>`).join('');
      selCons.value = prev;
    }
    _populateGrupoSelect();

    const dl = document.getElementById('histPuntoList');
    if(dl){
      dl.innerHTML = Storage.getPuntos().map(p => `<option value="${Utils.escapeHtml(p.nombrePuntoVenta || ('Punto #'+p.externalId))} (#${p.externalId})">`).join('');
    }
  }

  function _populateGrupoSelect(){
    const selGrupo = document.getElementById('histGrupo');
    if(!selGrupo) return;
    const grupos = Storage.getGrupos()
      .filter(g => !_filters.consorcioId || g.consorcioId === _filters.consorcioId)
      .sort((a,b) => a.nombre.localeCompare(b.nombre));
    const prev = _filters.grupoId;
    selGrupo.innerHTML = `<option value="">Todos los grupos</option>` +
      grupos.map(g => `<option value="${Utils.escapeHtml(g.id)}">${Utils.escapeHtml(g.nombre)}</option>`).join('');
    if(grupos.some(g => g.id === prev)) selGrupo.value = prev; else _filters.grupoId = '';
  }

  function setFilter(key, val){
    _filters[key] = val;
    if(key === 'consorcioId'){ _filters.grupoId = ''; _populateGrupoSelect(); }
    render();
  }

  // Validación de coincidencia exacta del punto tecleado (patrón CXC)
  function onPuntoInput(texto){
    const puntos = Storage.getPuntos();
    const match = puntos.find(p => `${p.nombrePuntoVenta || ('Punto #'+p.externalId)} (#${p.externalId})` === texto);
    _filters.puntoId = match ? match.id : (texto ? '__invalid__' : '');
    render();
  }

  function clearFilters(){
    _filters = { anio:'', mes:'', consorcioId:'', grupoId:'', puntoId:'' };
    document.getElementById('histAnio').value = '';
    document.getElementById('histMes').value = '';
    document.getElementById('histConsorcio').value = '';
    document.getElementById('histPuntoInput').value = '';
    _populateGrupoSelect();
    render();
  }

  function _filtered(){
    let list = Storage.getLegalizaciones().slice();
    if(_filters.anio) list = list.filter(l => (l.fechaLegalizacion||'').slice(0,4) === _filters.anio);
    if(_filters.mes) list = list.filter(l => (l.fechaLegalizacion||'').slice(5,7) === _filters.mes);
    if(_filters.grupoId) list = list.filter(l => l.grupoId === _filters.grupoId);
    else if(_filters.consorcioId){
      const gruposDelConsorcio = new Set(Storage.getGrupos().filter(g => g.consorcioId === _filters.consorcioId).map(g => g.id));
      list = list.filter(l => gruposDelConsorcio.has(l.grupoId));
    }
    if(_filters.puntoId === '__invalid__') list = [];
    else if(_filters.puntoId) list = list.filter(l => Array.isArray(l.puntoIds) && l.puntoIds.indexOf(_filters.puntoId) !== -1);
    return list.sort((a,b) => (b.fechaLegalizacion||'').localeCompare(a.fechaLegalizacion||''));
  }

  function render(){
    _populateFiltros();
    const grupos = Storage.getGrupos();
    const consorcios = Storage.getConsorcios();
    const list = _filtered();

    const tbody = document.getElementById('histBody');
    if(!tbody) return;
    if(list.length === 0){
      tbody.innerHTML = `<tr><td colspan="8" class="t-empty">No hay legalizaciones con estos filtros.</td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(l => {
      const g = grupos.find(gr => gr.id === l.grupoId);
      const c = g ? consorcios.find(co => co.id === g.consorcioId) : null;
      const estado = Estado.calcularEstadoLegalizacion(l);
      return `<tr>
        <td>${Utils.fmtDate(l.fechaLegalizacion)}</td>
        <td>${Utils.escapeHtml(g ? g.nombre : '—')}</td>
        <td>${Utils.escapeHtml(c ? c.nombre : '—')}</td>
        <td class="r">${l.cantidadPuntos||0}</td>
        <td>${Utils.fmtDate(l.fechaVencimiento)}</td>
        <td><span class="pill ${Estado.PILL_CLASS[estado]}"><span class="pill-dot"></span>${estado}</span></td>
        <td>${Utils.escapeHtml(l.creadoPor||'—')}</td>
        <td class="c" style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" onclick="Historial.verDetalle('${Utils.jsAttr(l.id)}')">Ver</button>
          ${estado === 'Vigente' ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="Legalizacion.anular('${Utils.jsAttr(l.id)}')">Anular</button>` : ''}
        </td>
      </tr>`;
    }).join('');
  }

  function verDetalle(id){
    const l = Storage.getLegalizacion(id);
    if(!l) return;
    const g = Storage.getGrupo(l.grupoId);
    const c = g ? Storage.getConsorcio(g.consorcioId) : null;
    const puntos = (l.puntoIds||[]).map(pid => Storage.getPunto(pid)).filter(Boolean);
    document.getElementById('histDetTitle').textContent = `Legalización · ${g ? g.nombre : '—'}`;
    document.getElementById('histDetBody').innerHTML = `
      <div class="field-row">
        <div><label class="f-label">Consorcio</label><p>${Utils.escapeHtml(c ? c.nombre : '—')}</p></div>
        <div><label class="f-label">Grupo</label><p>${Utils.escapeHtml(g ? g.nombre : '—')}</p></div>
      </div>
      <div class="field-row">
        <div><label class="f-label">Desde</label><p>${Utils.fmtDate(l.fechaLegalizacion)}</p></div>
        <div><label class="f-label">Hasta</label><p>${Utils.fmtDate(l.fechaVencimiento)}</p></div>
      </div>
      ${l.observaciones ? `<div class="field"><label class="f-label">Observaciones</label><p>${Utils.escapeHtml(l.observaciones)}</p></div>` : ''}
      <h4 style="margin:16px 0 8px;font-size:12.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--ink-faint)">Puntos incluidos (${puntos.length})</h4>
      <div class="table-wrap" style="max-height:280px;overflow:auto"><table class="t">
        <thead><tr><th>ID</th><th>Punto de Venta</th><th>Municipio</th></tr></thead>
        <tbody>${puntos.map(p => `<tr><td>${p.externalId}</td><td>${Utils.escapeHtml(p.nombrePuntoVenta||'—')}</td><td>${Utils.escapeHtml(p.municipio||'—')}</td></tr>`).join('')}</tbody>
      </table></div>`;
    UI.openModal('modalHistorialDetalle');
  }

  return { render, setFilter, onPuntoInput, clearFilters, verDetalle };
})();
window.Historial = Historial;
