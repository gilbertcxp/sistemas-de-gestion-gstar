/* ============================================================
   Auditoria — bitácora de acciones administrativas (usuario, fecha,
   acción, entidad, antes/después). Consulta de solo lectura.
   ============================================================ */
const Auditoria = (() => {

  function _user(){
    try{
      const u = window.Auth && Auth.getUser && Auth.getUser();
      return { id: u ? u.id : null, nombre: (u && (u.name || u.email)) || 'Usuario' };
    }catch(e){ return { id:null, nombre:'Usuario' }; }
  }

  function registrar(accion, entidad, entidadId, valorAnterior, valorNuevo){
    const u = _user();
    return Storage.addAuditoria({
      usuarioId: u.id,
      usuarioNombre: u.nombre,
      accion, entidad, entidadId: entidadId != null ? String(entidadId) : null,
      valorAnterior: valorAnterior != null ? valorAnterior : null,
      valorNuevo: valorNuevo != null ? valorNuevo : null
    });
  }

  const ACCION_LABEL = {
    importar_catalogo: 'Importó catálogo MASTER',
    crear_legalizacion: 'Creó legalización',
    anular_legalizacion: 'Anuló legalización',
    editar_punto: 'Editó punto',
    crear_grupo: 'Creó grupo'
  };

  let _filters = { entidad:'', desde:'', hasta:'' };
  function setFilter(key, val){ _filters[key] = val; render(); }

  function render(){
    const tbody = document.getElementById('audBody');
    if(!tbody) return;
    let list = Storage.getAuditoria().slice().sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
    if(_filters.entidad) list = list.filter(a => a.entidad === _filters.entidad);
    if(_filters.desde) list = list.filter(a => (a.createdAt||'') >= _filters.desde);
    if(_filters.hasta) list = list.filter(a => (a.createdAt||'') <= _filters.hasta + 'T23:59:59');

    if(list.length === 0){
      tbody.innerHTML = `<tr><td colspan="5" class="t-empty">Sin registros de auditoría todavía.</td></tr>`;
      return;
    }
    tbody.innerHTML = list.slice(0, 300).map(a => `
      <tr>
        <td>${new Date(a.createdAt).toLocaleString('es-DO')}</td>
        <td>${Utils.escapeHtml(a.usuarioNombre||'—')}</td>
        <td>${Utils.escapeHtml(ACCION_LABEL[a.accion] || a.accion)}</td>
        <td>${Utils.escapeHtml(a.entidad)}${a.entidadId ? ' · ' + Utils.escapeHtml(a.entidadId) : ''}</td>
        <td class="c"><button class="btn btn-ghost btn-sm" onclick="Auditoria.verDetalle('${Utils.jsAttr(a.id)}')">Ver</button></td>
      </tr>`).join('');
  }

  function verDetalle(id){
    const row = Storage.getAuditoria().find(a => a.id === id);
    if(!row) return;
    document.getElementById('audDetTitle').textContent = ACCION_LABEL[row.accion] || row.accion;
    document.getElementById('audDetBody').innerHTML = `
      <div class="field-row">
        <div><label class="f-label">Usuario</label><p>${Utils.escapeHtml(row.usuarioNombre||'—')}</p></div>
        <div><label class="f-label">Fecha</label><p>${new Date(row.createdAt).toLocaleString('es-DO')}</p></div>
      </div>
      <div class="field-row">
        <div><label class="f-label">Entidad</label><p>${Utils.escapeHtml(row.entidad)}</p></div>
        <div><label class="f-label">ID afectado</label><p>${Utils.escapeHtml(row.entidadId||'—')}</p></div>
      </div>
      <div class="field"><label class="f-label">Valor anterior</label>
        <pre style="background:var(--canvas);padding:10px;border-radius:8px;font-size:11.5px;overflow:auto;max-height:200px">${Utils.escapeHtml(row.valorAnterior ? JSON.stringify(row.valorAnterior, null, 2) : '—')}</pre>
      </div>
      <div class="field"><label class="f-label">Valor nuevo</label>
        <pre style="background:var(--canvas);padding:10px;border-radius:8px;font-size:11.5px;overflow:auto;max-height:200px">${Utils.escapeHtml(row.valorNuevo ? JSON.stringify(row.valorNuevo, null, 2) : '—')}</pre>
      </div>`;
    UI.openModal('modalAuditoriaDetalle');
  }

  return { registrar, render, setFilter, verDetalle, ACCION_LABEL };
})();
window.Auditoria = Auditoria;
