/* ============================================================
   Legalizacion — alta de un evento de legalización (selección de
   grupo + checklist de sus puntos con "seleccionar todos" + contador,
   clon del patrón de CXP/assets/js/solicitud-pago.js) y anulación.
   ============================================================ */
const Legalizacion = (() => {

  let _grupoFijo = null; // si se abrió desde Grupo/Consorcio, el select queda fijo

  function _user(){
    try{
      const u = window.Auth && Auth.getUser && Auth.getUser();
      return (u && (u.name || u.email)) || 'Usuario';
    }catch(e){ return 'Usuario'; }
  }

  function abrirModalNueva(grupoId){
    _grupoFijo = grupoId || null;

    const sel = document.getElementById('legGrupoSelect');
    const grupos = Storage.getGrupos().filter(g => g.activo !== false).sort((a,b) => a.nombre.localeCompare(b.nombre));
    sel.innerHTML = `<option value="">— Seleccionar grupo —</option>` +
      grupos.map(g => `<option value="${Utils.escapeHtml(g.id)}">${Utils.escapeHtml(g.nombre)}</option>`).join('');
    if(_grupoFijo){ sel.value = _grupoFijo; sel.disabled = true; } else { sel.disabled = false; }

    document.getElementById('legFechaLegalizacion').value = Utils.todayISO();
    document.getElementById('legFechaVencimiento').value = '';
    document.getElementById('legObservaciones').value = '';
    document.getElementById('legDocumentoUrl').value = '';

    onGrupoChange(_grupoFijo || '');
    UI.openModal('modalNuevaLegalizacion');
  }

  function onGrupoChange(grupoId){
    _renderChecklistPuntos(grupoId);
  }

  function _renderChecklistPuntos(grupoId){
    const body = document.getElementById('legPuntosBody');
    if(!body) return;
    if(!grupoId){
      body.innerHTML = `<tr><td colspan="4" class="t-empty">Selecciona un grupo para ver sus puntos.</td></tr>`;
      updateResumen();
      return;
    }
    const puntos = Storage.getPuntosByGrupo(grupoId).filter(p => p.activo !== false)
      .sort((a,b) => (a.nombrePuntoVenta||'').localeCompare(b.nombrePuntoVenta||''));
    if(puntos.length === 0){
      body.innerHTML = `<tr><td colspan="4" class="t-empty">Este grupo no tiene puntos en el catálogo.</td></tr>`;
      updateResumen();
      return;
    }
    body.innerHTML = puntos.map(p => `
      <tr>
        <td class="c"><input type="checkbox" class="chk leg-chk" data-punto-id="${Utils.jsAttr(p.id)}" checked onchange="Legalizacion.updateResumen()"></td>
        <td>${p.externalId}</td>
        <td>${Utils.escapeHtml(p.nombrePuntoVenta||'—')}</td>
        <td>${Utils.escapeHtml(p.municipio||'—')}</td>
      </tr>`).join('');
    updateResumen();
  }

  function filtrarPuntos(term){
    term = Utils.normalize(term || '');
    document.querySelectorAll('#legPuntosBody tr').forEach(tr => {
      const txt = Utils.normalize(tr.textContent);
      tr.style.display = !term || txt.indexOf(term) !== -1 ? '' : 'none';
    });
  }

  function toggleAll(checked){
    document.querySelectorAll('.leg-chk').forEach(c => {
      if(c.closest('tr').style.display !== 'none') c.checked = checked;
    });
    updateResumen();
  }

  function updateResumen(){
    const boxes = [...document.querySelectorAll('.leg-chk')];
    let count = 0;
    boxes.forEach(c => { if(c.checked) count++; });
    const chkAll = document.getElementById('legChkAll');
    const countEl = document.getElementById('legSelCount');
    if(countEl) countEl.textContent = count;
    if(chkAll){
      chkAll.indeterminate = count > 0 && count < boxes.length;
      if(!chkAll.indeterminate) chkAll.checked = boxes.length > 0 && count === boxes.length;
    }
  }

  function guardar(){
    const grupoId = document.getElementById('legGrupoSelect').value;
    const fechaLegalizacion = document.getElementById('legFechaLegalizacion').value;
    const fechaVencimiento = document.getElementById('legFechaVencimiento').value;
    const observaciones = document.getElementById('legObservaciones').value.trim();
    const documentoUrl = document.getElementById('legDocumentoUrl').value.trim();
    const puntoIds = [...document.querySelectorAll('.leg-chk:checked')].map(c => c.dataset.puntoId);

    if(!grupoId){ UI.toast('Selecciona un grupo', 'err'); return; }
    if(!fechaLegalizacion || !fechaVencimiento){ UI.toast('Completa las fechas Desde y Hasta', 'err'); return; }
    if(fechaVencimiento < fechaLegalizacion){ UI.toast('La fecha de vencimiento no puede ser anterior a la de legalización', 'err'); return; }
    if(puntoIds.length === 0){ UI.toast('Selecciona al menos un punto', 'err'); return; }

    const row = Storage.addLegalizacion({
      grupoId, fechaLegalizacion, fechaVencimiento, puntoIds,
      observaciones, documentoUrl: documentoUrl || null,
      creadoPor: _user()
    });
    Auditoria.registrar('crear_legalizacion', 'legalizacion', row.id, null, row);

    UI.closeModal('modalNuevaLegalizacion');
    UI.toast(`Legalización registrada — ${puntoIds.length} punto(s)`, 'ok');
    App.refreshActiveView();
  }

  function anular(legalizacionId){
    const leg = Storage.getLegalizacion(legalizacionId);
    if(!leg) return;
    UI.requirePin(() => {
      UI.confirm('Anular legalización',
        `¿Anular esta legalización (${leg.cantidadPuntos} punto(s))? Sus puntos volverán a estado Pendiente. Esta acción no se puede deshacer.`,
        () => {
          const anterior = { ...leg };
          const actualizado = Storage.anularLegalizacion(legalizacionId, _user());
          Auditoria.registrar('anular_legalizacion', 'legalizacion', legalizacionId, anterior, actualizado);
          UI.toast('Legalización anulada', 'ok');
          App.refreshActiveView();
        });
    });
  }

  return { abrirModalNueva, onGrupoChange, filtrarPuntos, toggleAll, updateResumen, guardar, anular };
})();
window.Legalizacion = Legalizacion;
