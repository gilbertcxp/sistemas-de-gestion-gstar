/* ============================================================
   Grupo — drill-down nivel 2: puntos de un grupo, con orden por
   columna (patrón thead()/sortBy() de DISPONIBILIDAD/disponibilidad-bancaria.html)
   ============================================================ */
const Grupo = (() => {

  let _grupoActualId = null;
  const _sort = { key:null, dir:1 };

  const COLS = [
    { key:'externalId', label:'ID' },
    { key:'nombrePuntoVenta', label:'Punto de Venta' },
    { key:'municipio', label:'Municipio' },
    { key:'provincia', label:'Provincia' },
    { key:'noTerminales', label:'Terminales' },
    { key:'_estado', label:'Estado' },
    { key:'_vence', label:'Vence el' }
  ];

  function abrir(grupoId){
    _grupoActualId = grupoId;
    App.switchView('grupo');
  }

  function _thead(){
    return '<thead><tr>' + COLS.map(c => {
      const sorted = _sort.key === c.key;
      const cls = sorted ? ('sorted ' + (_sort.dir < 0 ? 'desc' : '')) : '';
      return `<th class="${cls}" onclick="Grupo.sortBy('${c.key}')">
        <span class="th-in">${c.label}<i class="bi bi-caret-up-fill sort-i"></i></span>
      </th>`;
    }).join('') + '<th></th></tr></thead>';
  }

  function _applySort(rows){
    if(!_sort.key) return rows;
    const k = _sort.key;
    return rows.slice().sort((a,b) => {
      let va = a[k], vb = b[k];
      if(typeof va === 'string' || typeof vb === 'string'){
        return String(va||'').localeCompare(String(vb||'')) * _sort.dir;
      }
      va = va == null ? -Infinity : va; vb = vb == null ? -Infinity : vb;
      return (va - vb) * _sort.dir;
    });
  }

  function sortBy(key){
    if(_sort.key === key){ _sort.dir *= -1; } else { _sort.key = key; _sort.dir = 1; }
    render();
  }

  function render(){
    const g = Storage.getGrupo(_grupoActualId);
    if(!g){ App.switchView('dashboard'); return; }

    const consorcio = Storage.getConsorcio(g.consorcioId);
    const socio = Storage.getSocio(g.socioId);
    document.getElementById('grupoBreadcrumbConsorcio').textContent = consorcio ? consorcio.nombre : '—';
    document.getElementById('grupoBreadcrumbConsorcio').setAttribute('onclick', consorcio ? `Consorcio.abrir('${Utils.jsAttr(consorcio.id)}')` : '');
    document.getElementById('grupoBreadcrumbNombre').textContent = g.nombre;
    document.getElementById('grupoSocio').textContent = socio ? socio.nombre : '—';

    const legalizaciones = Storage.getLegalizaciones();
    const umbralDias = Storage.getSettings().umbralPorVencerDias || 15;
    const hoy = new Date();
    const indice = Estado.construirIndicePuntoLegalizaciones(legalizaciones);

    let puntos = Storage.getPuntosByGrupo(g.id).filter(p => p.activo !== false).map(p => {
      const estado = Estado.calcularEstadoPuntoIndexado(p.id, indice, { hoy, umbralDias });
      const ultima = Estado.ultimaLegalizacionDePunto(p.id, legalizaciones);
      return { ...p, _estado: estado, _vence: ultima ? ultima.fechaVencimiento : '' };
    });
    puntos = _applySort(puntos);

    const thead = document.getElementById('grupoTheadWrap');
    if(thead) thead.innerHTML = _thead();

    const tbody = document.getElementById('grupoPuntosBody');
    if(!tbody) return;
    if(puntos.length === 0){
      tbody.innerHTML = `<tr><td colspan="8" class="t-empty">Este grupo no tiene puntos todavía.</td></tr>`;
      return;
    }
    tbody.innerHTML = puntos.map(p => `
      <tr>
        <td>${p.externalId}</td>
        <td>${Utils.escapeHtml(p.nombrePuntoVenta||'—')}</td>
        <td>${Utils.escapeHtml(p.municipio||'—')}</td>
        <td>${Utils.escapeHtml(p.provincia||'—')}</td>
        <td class="r">${p.noTerminales||0}</td>
        <td><span class="pill ${Estado.PILL_CLASS[p._estado]}"><span class="pill-dot"></span>${p._estado}</span></td>
        <td>${p._vence ? Utils.fmtDate(p._vence) : '—'}</td>
        <td class="c"><button class="btn btn-ghost btn-icon btn-sm" title="Ver detalle" onclick="Grupo.verPunto('${Utils.jsAttr(p.id)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="3"/><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/></svg>
        </button></td>
      </tr>`).join('');
  }

  function verPunto(puntoId){
    const p = Storage.getPunto(puntoId);
    if(!p) return;
    const legalizaciones = Storage.getLegalizaciones().filter(l => Array.isArray(l.puntoIds) && l.puntoIds.indexOf(puntoId) !== -1)
      .sort((a,b) => (b.fechaLegalizacion||'').localeCompare(a.fechaLegalizacion||''));
    document.getElementById('puntoDetTitle').textContent = p.nombrePuntoVenta || ('Punto #' + p.externalId);
    document.getElementById('puntoDetBody').innerHTML = `
      <div class="field-row">
        <div><label class="f-label">ID (MASTER)</label><p>${p.externalId}</p></div>
        <div><label class="f-label">No. LOT</label><p>${Utils.escapeHtml(p.noLot||'—')}</p></div>
      </div>
      <div class="field-row">
        <div><label class="f-label">Calle</label><p>${Utils.escapeHtml(p.calle||'—')} ${Utils.escapeHtml(p.numero||'')}</p></div>
        <div><label class="f-label">Sector</label><p>${Utils.escapeHtml(p.sector||'—')}</p></div>
      </div>
      <div class="field-row">
        <div><label class="f-label">Municipio</label><p>${Utils.escapeHtml(p.municipio||'—')}</p></div>
        <div><label class="f-label">Provincia</label><p>${Utils.escapeHtml(p.provincia||'—')}</p></div>
      </div>
      <div class="field-row">
        <div><label class="f-label">Teléfono</label><p>${Utils.escapeHtml(p.telefono||'—')}</p></div>
        <div><label class="f-label">Correo</label><p>${Utils.escapeHtml(p.correo||'—')}</p></div>
      </div>
      <div class="field"><label class="f-label">Comentarios</label><p>${Utils.escapeHtml(p.comentarios||'—')}</p></div>
      <h4 style="margin:16px 0 8px;font-size:12.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--ink-faint)">Historial de legalizaciones</h4>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Desde</th><th>Hasta</th><th>Estado</th></tr></thead>
        <tbody>${legalizaciones.length === 0 ? '<tr><td colspan="3" class="t-empty">Sin legalizaciones registradas.</td></tr>' :
          legalizaciones.map(l => `<tr><td>${Utils.fmtDate(l.fechaLegalizacion)}</td><td>${Utils.fmtDate(l.fechaVencimiento)}</td><td><span class="pill ${Estado.PILL_CLASS[Estado.calcularEstadoLegalizacion(l)]}">${Estado.calcularEstadoLegalizacion(l)}</span></td></tr>`).join('')}
        </tbody>
      </table></div>`;
    UI.openModal('modalPuntoDetalle');
  }

  function volver(){
    const g = Storage.getGrupo(_grupoActualId);
    if(g && g.consorcioId) Consorcio.abrir(g.consorcioId);
    else App.switchView('dashboard');
  }

  return { abrir, render, sortBy, verPunto, volver, getActualId: () => _grupoActualId };
})();
window.Grupo = Grupo;
