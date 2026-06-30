/* ============================================================
   Historial — lista de Solicitudes de Pago guardadas
   ============================================================ */
const Historial = (() => {

  function ver(id){
    const sol = Storage.getSolicitudes().find(s => s.id === id);
    if(!sol){ UI.toast('Solicitud no encontrada', 'err'); return; }
    SolicitudPago.cargar(sol);
    App.switchView('solicitud-pago');
  }

  function eliminar(id){
    UI.requirePin(() => {
      Storage.deleteSolicitud(id);
      render();
      UI.toast('Solicitud eliminada', 'ok');
    });
  }

  function render(){
    const wrap = document.getElementById('histList');
    if(!wrap) return;
    const list = Storage.getSolicitudes();
    if(list.length === 0){
      wrap.innerHTML = `<div class="t-empty" style="padding:50px 20px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="34" height="34"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>
        <div>Aún no has guardado ninguna solicitud de pago.</div>
      </div>`;
      return;
    }
    wrap.innerHTML = list.map(s => `
      <div class="card" style="margin-bottom:12px;">
        <div class="card-body flex between wrap" style="gap:14px;">
          <div>
            <div style="font-weight:700;font-size:14px;">${Utils.fmtDateLong(s.fecha)}</div>
            <div class="muted" style="font-size:12px;margin-top:3px;">
              ${s.totalDocs} documento(s) · Total ${Utils.fmtMoney(s.totalGeneral||0)}
            </div>
          </div>
          <div class="flex gap8">
            <span class="pill ok">${Utils.escapeHtml(s.estado||'Guardada')}</span>
            <button class="btn btn-soft btn-sm" onclick="Historial.ver('${s.id}')">Ver / Reimprimir</button>
            <button class="btn btn-ghost btn-icon btn-sm" title="Eliminar" onclick="Historial.eliminar('${s.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
          </div>
        </div>
      </div>`).join('');
  }

  return { render, ver, eliminar };
})();
