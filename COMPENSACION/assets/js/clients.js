/* ============================================================
   Clients — CRUD de consorcios + emparejamiento de nombres
   ============================================================ */
const Clients = (() => {

  let searchTerm = '';

  // ---------- Matching: nombre del Excel -> cliente existente ----------
  function findMatch(excelName, clients){
    clients = clients || Storage.getClients();
    const target = Utils.normalize(excelName);
    const targetCore = Utils.coreName(excelName);

    // 1) Coincidencia exacta normalizada
    let m = clients.find(c => Utils.normalize(c.nombre) === target);
    if(m) return m;

    // 2) Coincidencia exacta de "núcleo" (sin CONSORCIO/GRUPO/UD)
    m = clients.find(c => Utils.coreName(c.nombre) === targetCore && targetCore.length >= 3);
    if(m) return m;

    // 3) Contención de subcadena (núcleo) en ambos sentidos
    if(targetCore.length >= 3){
      m = clients.find(c => {
        const cCore = Utils.coreName(c.nombre);
        return cCore.length >= 3 && (cCore.includes(targetCore) || targetCore.includes(cCore));
      });
      if(m) return m;
    }
    return null;
  }

  function upsert(data){
    return Storage.upsertClient(data);
  }
  function remove(id){
    Storage.deleteClient(id);
  }
  function all(){ return Storage.getClients(); }
  function byId(id){ return Storage.getClients().find(c => c.id === id); }

  // ---------- UI: tabla de clientes ----------
  function render(){
    const tbody = document.querySelector('#tblClientes tbody');
    let list = Storage.getClients().slice().sort((a,b)=>a.nombre.localeCompare(b.nombre));
    if(searchTerm){
      const t = Utils.normalize(searchTerm);
      list = list.filter(c => Utils.normalize(c.nombre).includes(t));
    }
    if(list.length === 0){
      tbody.innerHTML = `<tr><td colspan="7"><div class="t-empty">No se encontraron clientes.</div></td></tr>`;
      return;
    }
    tbody.innerHTML = list.map(c => `
      <tr>
        <td>
          <div class="flex gap10">
            <div class="avatar" style="background:${Utils.colorFor(c.nombre)}">${Utils.escapeHtml(Utils.initials(c.nombre))}</div>
            <b>${Utils.escapeHtml(c.nombre)}</b>
          </div>
        </td>
        <td>${Utils.escapeHtml(c.rnc) || '<span class="muted">—</span>'}</td>
        <td>${Utils.escapeHtml(c.telefono) || '<span class="muted">—</span>'}</td>
        <td>${Utils.escapeHtml(c.correo) || '<span class="muted">—</span>'}</td>
        <td>${Utils.escapeHtml(c.contacto) || '<span class="muted">—</span>'}</td>
        <td>${Utils.escapeHtml(c.direccion) || '<span class="muted">—</span>'}</td>
        <td>
          <div class="flex gap6">
            <button class="btn btn-ghost btn-icon btn-sm" onclick="Clients.openEdit('${c.id}')" title="Editar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="btn btn-ghost btn-icon btn-sm" onclick="Clients.confirmRemove('${c.id}')" title="Eliminar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function setSearch(term){
    searchTerm = term;
    render();
  }

  function openNew(){
    if(typeof App !== 'undefined' && App.clearPendingVinculo) App.clearPendingVinculo();
    document.getElementById('clienteModalTitle').textContent = 'Nuevo cliente';
    document.getElementById('clienteId').value = '';
    ['clienteNombre','clienteRnc','clienteTelefono','clienteDireccion','clienteCorreo','clienteContacto'].forEach(id => document.getElementById(id).value = '');
    UI.openModal('modalCliente');
  }
  function openEdit(id){
    if(typeof App !== 'undefined' && App.clearPendingVinculo) App.clearPendingVinculo();
    const c = byId(id);
    if(!c) return;
    document.getElementById('clienteModalTitle').textContent = 'Editar cliente';
    document.getElementById('clienteId').value = c.id;
    document.getElementById('clienteNombre').value = c.nombre || '';
    document.getElementById('clienteRnc').value = c.rnc || '';
    document.getElementById('clienteTelefono').value = c.telefono || '';
    document.getElementById('clienteDireccion').value = c.direccion || '';
    document.getElementById('clienteCorreo').value = c.correo || '';
    document.getElementById('clienteContacto').value = c.contacto || '';
    UI.openModal('modalCliente');
  }
  function saveFromForm(){
    const nombre = document.getElementById('clienteNombre').value.trim();
    if(!nombre){ UI.toast('El nombre del consorcio es obligatorio', 'err'); return null; }
    const data = {
      id: document.getElementById('clienteId').value || null,
      nombre,
      rnc: document.getElementById('clienteRnc').value.trim(),
      telefono: document.getElementById('clienteTelefono').value.trim(),
      direccion: document.getElementById('clienteDireccion').value.trim(),
      correo: document.getElementById('clienteCorreo').value.trim(),
      contacto: document.getElementById('clienteContacto').value.trim(),
    };
    const saved = upsert(data);
    UI.closeModal('modalCliente');
    render();
    UI.toast('Cliente guardado', 'ok');
    return saved;
  }
  function confirmRemove(id){
    const c = byId(id);
    if(!c) return;
    UI.confirm(`Eliminar cliente`, `¿Eliminar a "${c.nombre}"? Esta acción no se puede deshacer.`, () => {
      remove(id);
      render();
      UI.toast('Cliente eliminado', 'ok');
    });
  }

  return { findMatch, upsert, remove, all, byId, render, setSearch, openNew, openEdit, saveFromForm, confirmRemove };
})();
