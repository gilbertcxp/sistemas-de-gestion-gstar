/* ============================================================
   Historial — lista de Solicitudes de Pago guardadas
   ============================================================ */
const Historial = (() => {

  function _pillClass(estado){
    if(estado === 'Pagada')              return 'ok';
    if(estado === 'Parcialmente Pagada') return 'blue';
    return 'warn';  // Pendiente
  }

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
        <div>Aún no hay solicitudes de pago registradas.</div>
      </div>`;
      return;
    }

    wrap.innerHTML = list.map(s => {
      const eClass   = _pillClass(s.estado || 'Pendiente');
      const numTag   = s.numero
        ? `<span style="font-weight:700;font-size:15px;">Solicitud #${s.numero}</span>`
        : `<span style="font-weight:700;font-size:15px;">${Utils.fmtDateLong(s.fecha)}</span>`;

      const fechaCreacion = s.numero
        ? `<div class="muted" style="font-size:12px;margin-top:2px;">Creada el ${Utils.fmtDateLong(s.fecha)}</div>`
        : '';

      const fechaPago = s.fechaPago
        ? `<div class="muted" style="font-size:12px;margin-top:2px;">
             Pagada el <b>${Utils.fmtDateLong(s.fechaPago.slice(0,10))}</b>
             ${s.usuarioPago ? `· por ${Utils.escapeHtml(s.usuarioPago)}` : ''}
           </div>`
        : '';

      const montos = (s.estado === 'Parcialmente Pagada' && s.totalPagado != null)
        ? `<div class="muted" style="font-size:12px;margin-top:2px;">
             Pagado: <b>${Utils.fmtMoney(s.totalPagado)}</b>
             de ${Utils.fmtMoney((s.totalPagado||0) + ((s.itemsNoProcesados||[]).reduce((a,i)=>a+(i.valor||0),0)))}
             · ${s.totalDocsPagados||0} de ${(s.totalDocs||0)+(s.itemsNoProcesados?.length||0)} doc(s)
           </div>`
        : `<div class="muted" style="font-size:12px;margin-top:2px;">
             ${s.totalDocs||0} documento(s) · ${Utils.fmtMoney(s.totalGeneral||0)}
           </div>`;

      // Beneficiarios únicos (primeros 4)
      const beneficiarios = [...new Set((s.items||[]).map(i=>i.proveedor))].slice(0,4);
      const bensStr = beneficiarios.length
        ? `<div class="muted" style="font-size:11px;margin-top:4px;line-height:1.4">
             ${beneficiarios.map(b=>Utils.escapeHtml(b)).join(' · ')}${(s.items||[]).length > 4 ? ' · …' : ''}
           </div>`
        : '';

      return `
        <div class="card" style="margin-bottom:12px;">
          <div class="card-body flex between wrap" style="gap:14px;align-items:center;">
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:2px;">
                ${numTag}
                <span class="pill ${eClass}">${Utils.escapeHtml(s.estado||'Pendiente')}</span>
              </div>
              ${fechaCreacion}
              ${montos}
              ${fechaPago}
              ${bensStr}
            </div>
            <div class="flex gap8" style="flex-shrink:0;align-items:center;">
              <button class="btn btn-soft btn-sm" onclick="Historial.ver('${s.id}')">
                Ver / Reimprimir
              </button>
              <button class="btn btn-ghost btn-icon btn-sm" title="Eliminar solicitud"
                onclick="Historial.eliminar('${s.id}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                </svg>
              </button>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  return { render, ver, eliminar };
})();
