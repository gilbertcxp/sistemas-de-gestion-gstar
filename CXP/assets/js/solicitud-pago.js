/* ============================================================
   SolicitudPago — arma, edita, guarda e imprime la Solicitud
   de Pago a partir de las facturas seleccionadas en el Reporte
   ============================================================ */
const SolicitudPago = (() => {

  let _id = null;
  let _items = [];      // [{ rowId, fecha, proveedor, empresa, moneda, valor, detalle, observaciones }]
  let _locked = false;
  let _createdAt = '';

  // ------ helpers ------
  function _getBankInputs(){
    const n = id => parseFloat(document.getElementById(id)?.value)||0;
    return {
      cuentaLabel: document.getElementById('spCuentaLabel')?.value || Storage.getBank().cuentaLabel,
      balanceBanco: n('spBalanceBanco'),
      chequesTransito: n('spChequesTransito'),
      provisiones: n('spProvisiones'),
      depositos: n('spDepositos')
    };
  }
  function _saveBank(){
    if(_locked) return;
    Storage.saveBank(_getBankInputs());
  }
  function _calcTotals(){
    const bank = _getBankInputs();
    const montoDisponible = bank.balanceBanco - bank.chequesTransito - bank.provisiones + bank.depositos;
    const totalRD = _items.filter(i=>i.moneda==='RD$').reduce((s,i)=>s+(i.valor||0),0);
    const totalUS = _items.filter(i=>i.moneda==='US$').reduce((s,i)=>s+(i.valor||0),0);
    const disponibilidadActualizada = montoDisponible - totalRD;
    return { bank, montoDisponible, totalRD, totalUS, disponibilidadActualizada };
  }
  function _totalesPorSuplidor(){
    const map = {};
    _items.forEach(i => {
      const k = i.proveedor;
      if(!map[k]) map[k] = { RD$:0, 'US$':0 };
      map[k][i.moneda] = (map[k][i.moneda]||0) + (i.valor||0);
    });
    return map;
  }

  // ------ Public: iniciar nueva solicitud desde la selección del Reporte ------
  function generar(rows){
    if(!rows || rows.length === 0){ UI.toast('Selecciona al menos una factura', 'err'); return false; }
    _id = null;
    _locked = false;
    _createdAt = Utils.todayISO();
    _items = rows.map(r => ({
      rowId: r.id,
      fecha: r.fechaVencimiento || r.fecha,
      proveedor: r.proveedor,
      empresa: r.empresa || 'Gstar Services',
      moneda: r.moneda || 'RD$',
      valor: r.saldoPendiente || 0,
      detalle: r.detalle || '',
      observaciones: ''
    }));
    render();
    return true;
  }

  // ------ Public: cargar una solicitud guardada (desde Historial) ------
  function cargar(sol){
    _id = sol.id;
    _locked = true;
    _createdAt = sol.fecha;
    _items = sol.items.map(i => ({...i}));
    Storage.saveBank(sol.bank);
    render();
  }

  function setObservacion(idx, val){
    if(_locked) return;
    if(_items[idx]) _items[idx].observaciones = val;
  }
  function eliminarItem(idx){
    if(_locked) return;
    _items.splice(idx,1);
    render();
  }
  function habilitarEdicion(){
    _locked = false;
    render();
    UI.toast('Edición habilitada', 'ok');
  }

  function guardar(){
    if(_items.length === 0){ UI.toast('No hay documentos en la solicitud', 'err'); return; }
    const { totalRD, totalUS } = _calcTotals();
    const sol = {
      id: _id || Utils.uid('sol'),
      fecha: _createdAt || Utils.todayISO(),
      guardadaEn: new Date().toISOString(),
      estado: 'Guardada',
      bank: Storage.getBank(),
      items: _items,
      totalRD, totalUS,
      totalDocs: _items.length
    };
    Storage.upsertSolicitud(sol);
    _id = sol.id;
    _locked = true;
    render();
    UI.toast('Solicitud de pago guardada', 'ok');
  }

  // ------ Build doc HTML (vista previa / impresión / PDF) ------
  function _buildDocHTML(){
    const { bank, montoDisponible, totalRD, totalUS, disponibilidadActualizada } = _calcTotals();
    const cfg = Storage.getSettings();
    const fecha = new Date().toLocaleDateString('es-DO', { day:'2-digit', month:'long', year:'numeric' });

    const balRow = (label, val, extra='') =>
      `<div class="doc-bal-row${extra}">
         <span class="doc-bal-label">${Utils.escapeHtml(label)}</span>
         <span class="doc-bal-val${val<0?' neg':''}">${Utils.fmtMoney(val)}</span>
       </div>`;

    const tableRows = _items.length === 0
      ? `<tr><td colspan="6"><div class="t-empty">No hay documentos en esta solicitud.</div></td></tr>`
      : _items.map(i => `<tr>
            <td>${Utils.fmtDate(i.fecha)}</td>
            <td>${Utils.escapeHtml(i.proveedor)}</td>
            <td>${Utils.escapeHtml(i.detalle||'—')}</td>
            <td class="c">${Utils.escapeHtml(i.moneda)}</td>
            <td class="r">${Utils.fmtMoney(i.valor)}</td>
            <td>${Utils.escapeHtml(i.observaciones||'')}</td>
          </tr>`).join('');

    const porSuplidor = _totalesPorSuplidor();
    const suplidorRows = Object.keys(porSuplidor).sort().map(prov => {
      const t = porSuplidor[prov];
      const partes = [];
      if(t['RD$']) partes.push(Utils.fmtMoney(t['RD$']));
      if(t['US$']) partes.push('US$ ' + Utils.fmtNum(t['US$']));
      return `<tr><td>${Utils.escapeHtml(prov)}</td><td class="r">${partes.join(' + ')}</td></tr>`;
    }).join('');

    return `
      <div class="doc-page">
        <div class="doc-header">
          <img src="assets/img/logo.png" class="doc-logo" alt="Logo" onerror="this.style.display='none'">
          <div class="doc-header-right">
            <div class="doc-empresa">${Utils.escapeHtml(cfg.empresa?.nombre||'Gstar Services S.A.')}</div>
            <div class="doc-sub">RNC ${Utils.escapeHtml(cfg.empresa?.rnc||'131751016')}</div>
            <div class="doc-fecha">${fecha}</div>
          </div>
        </div>

        <div class="doc-title-block">
          <h2 class="doc-title">Solicitud de Pago</h2>
          <p class="doc-subtitle">Cuentas por Pagar — Proveedores</p>
        </div>

        <div class="doc-balance-grid">
          ${balRow(bank.cuentaLabel || 'Balance en banco', bank.balanceBanco)}
          ${balRow('Menos: Cheques o transferencias en tránsito', -bank.chequesTransito)}
          ${balRow('Menos: Provisiones y reservas', -bank.provisiones)}
          ${balRow('Más: Depósitos o transferencias entre cuentas', bank.depositos)}
          ${balRow('Monto disponible para pagos', montoDisponible, ' doc-bal-total')}
          ${balRow('Monto a Pagar (RD$)', totalRD)}
          ${totalUS ? balRow('Monto a Pagar (US$, no incluido en disponibilidad RD$)', totalUS) : ''}
          <div class="doc-bal-row doc-bal-highlight">
            <span class="doc-bal-label">DISPONIBILIDAD ACTUALIZADA</span>
            <span class="doc-bal-val">${Utils.fmtMoney(disponibilidadActualizada)}</span>
          </div>
        </div>

        <div class="doc-tipo-tag">DOCUMENTOS SELECCIONADOS (${_items.length})</div>

        <table class="doc-table">
          <thead>
            <tr><th>FECHA</th><th>SUPLIDOR</th><th>DETALLE</th><th>MONEDA</th><th class="r">VALOR</th><th>OBSERVACIONES</th></tr>
          </thead>
          <tbody>${tableRows}</tbody>
          ${_items.length > 0 ? `<tfoot>
            <tr>
              <td colspan="4"><b>TOTAL A PAGAR</b></td>
              <td class="r"><b>${Utils.fmtMoney(totalRD)}${totalUS?' + US$ '+Utils.fmtNum(totalUS):''}</b></td>
              <td></td>
            </tr>
          </tfoot>` : ''}
        </table>

        ${suplidorRows ? `
        <div class="doc-tipo-tag">TOTAL POR SUPLIDOR</div>
        <table class="doc-table" style="margin-bottom:22px;">
          <thead><tr><th>SUPLIDOR</th><th class="r">TOTAL</th></tr></thead>
          <tbody>${suplidorRows}</tbody>
        </table>` : ''}

        <div class="doc-signatures">
          <div class="doc-sig"><div class="doc-sig-line"></div><div class="doc-sig-label">Preparado por</div></div>
          <div class="doc-sig"><div class="doc-sig-line"></div><div class="doc-sig-label">Autorizado por</div></div>
          <div class="doc-sig"><div class="doc-sig-line"></div><div class="doc-sig-label">Autorizado por</div></div>
        </div>
      </div>`;
  }

  // ------ Editable items table (pantalla, no impresión) ------
  function _buildItemsTable(){
    if(_items.length === 0){
      return `<div class="t-empty" style="padding:40px 20px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="32" height="32"><path d="M7 3h8l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="m9 13 2 2 4-4"/></svg>
        <div>Selecciona facturas en el Reporte de CXP y presiona "Generar Solicitud de Pago".</div>
      </div>`;
    }
    return `<div class="table-wrap"><table class="t">
      <thead><tr><th>Fecha</th><th>Suplidor</th><th>Detalle</th><th class="c">Moneda</th><th class="r">Valor</th><th>Observaciones</th><th class="c">Acción</th></tr></thead>
      <tbody>
        ${_items.map((i,idx) => `<tr>
          <td>${Utils.fmtDate(i.fecha)}</td>
          <td>${Utils.escapeHtml(i.proveedor)}</td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Utils.escapeHtml(i.detalle)}">${Utils.escapeHtml(i.detalle||'—')}</td>
          <td class="c">${Utils.escapeHtml(i.moneda)}</td>
          <td class="r num">${Utils.fmtNum(i.valor)}</td>
          <td>
            <input type="text" class="input" style="font-size:12px;padding:5px 8px;" placeholder="Observación…"
              value="${Utils.escapeHtml(i.observaciones||'')}" ${_locked?'disabled':''}
              oninput="SolicitudPago.setObservacion(${idx}, this.value)">
          </td>
          <td class="c">
            <button class="btn btn-ghost btn-icon btn-sm" ${_locked?'disabled':''} title="Quitar de la solicitud" onclick="SolicitudPago.eliminarItem(${idx})">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  }

  // ------ Public: render view ------
  function render(){
    const saved = Storage.getBank();
    const set = (id,v) => { const el = document.getElementById(id); if(el) el.value = v; };
    set('spCuentaLabel', saved.cuentaLabel);
    set('spBalanceBanco', saved.balanceBanco);
    set('spChequesTransito', saved.chequesTransito);
    set('spProvisiones', saved.provisiones);
    set('spDepositos', saved.depositos);
    document.querySelectorAll('#spBankFields input').forEach(el => { el.disabled = _locked; });

    const itemsWrap = document.getElementById('spItemsTable');
    if(itemsWrap) itemsWrap.innerHTML = _buildItemsTable();

    const doc = document.getElementById('spDocument');
    if(doc) doc.innerHTML = _buildDocHTML();

    const badge = document.getElementById('spEstadoBadge');
    if(badge){
      badge.textContent = _locked ? 'Guardada' : 'Borrador';
      badge.className = 'pill ' + (_locked ? 'ok' : 'warn');
    }
    const btnGuardar = document.getElementById('btnGuardarSolicitud');
    if(btnGuardar) btnGuardar.style.display = _locked ? 'none' : '';
    const btnEditar = document.getElementById('btnEditarSolicitud');
    if(btnEditar) btnEditar.style.display = _locked ? '' : 'none';
  }

  function updatePreview(){
    _saveBank();
    const doc = document.getElementById('spDocument');
    if(doc) doc.innerHTML = _buildDocHTML();
  }

  // ------ Print ------
  function printDoc(){
    updatePreview();
    const content = document.getElementById('spDocument').innerHTML;
    const w = window.open('', '_blank', 'width=900,height=700');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Solicitud de Pago</title>
      <style>${_printCSS()}</style></head><body>${content}</body></html>`);
    w.document.close(); w.focus();
    w.onload = () => { w.print(); w.onafterprint = () => w.close(); };
  }

  // ------ PDF export ------
  function exportPDF(){
    updatePreview();
    const el = document.getElementById('spDocument');
    if(!el){ UI.toast('No hay documento para exportar', 'err'); return; }
    UI.toast('Generando PDF…', 'ok');
    html2canvas(el, { scale:2, useCORS:true, backgroundColor:'#ffffff', logging:false })
      .then(canvas => {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
        const imgData = canvas.toDataURL('image/jpeg', 0.97);
        const pgW = 210, pgH = 297, imgW = pgW;
        const imgH = (canvas.height / canvas.width) * pgW;
        if(imgH <= pgH){ pdf.addImage(imgData, 'JPEG', 0, 0, imgW, imgH); }
        else { let yOff=0; while(yOff<imgH){ if(yOff>0) pdf.addPage(); pdf.addImage(imgData,'JPEG',0,-yOff,imgW,imgH); yOff+=pgH; } }
        pdf.save(`Solicitud_Pago_CXP_${Utils.todayISO()}.pdf`);
        UI.toast('PDF descargado correctamente', 'ok');
      })
      .catch(() => UI.toast('Error al generar el PDF', 'err'));
  }

  // ------ Excel export ------
  function exportExcel(){
    if(_items.length === 0){ UI.toast('No hay documentos para exportar', 'err'); return; }
    try{
      const data = _items.map(i => ({
        'Fecha': Utils.fmtDate(i.fecha),
        'Suplidor': i.proveedor,
        'Empresa': i.empresa,
        'Detalle': i.detalle,
        'Moneda': i.moneda,
        'Valor': i.valor,
        'Observaciones': i.observaciones||''
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws['!cols'] = [{wch:12},{wch:30},{wch:18},{wch:40},{wch:8},{wch:14},{wch:30}];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Solicitud de Pago');
      XLSX.writeFile(wb, `Solicitud_Pago_CXP_${Utils.todayISO()}.xlsx`);
      UI.toast('Excel descargado', 'ok');
    }catch(err){
      console.error('exportExcel error:', err);
      UI.toast('No se pudo generar el Excel', 'err');
    }
  }

  function _printCSS(){ return `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;padding:18mm 20mm;color:#334155}
    .doc-page{max-width:100%}
    .doc-header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:2px solid #e2e8f0;margin-bottom:18px}
    .doc-logo{height:56px}
    .doc-header-right{text-align:right}
    .doc-empresa{font-size:15px;font-weight:700;color:#0f172a}
    .doc-sub,.doc-fecha{font-size:11px;color:#64748b}
    .doc-title-block{border-left:4px solid #2563eb;padding-left:12px;margin-bottom:16px}
    .doc-title{font-size:20px;font-weight:800;color:#0f172a}
    .doc-subtitle{font-size:12px;color:#64748b;margin-top:2px}
    .doc-balance-grid{border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:16px}
    .doc-bal-row{display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:12px}
    .doc-bal-row:last-child{border-bottom:none}
    .doc-bal-label{flex:1}
    .doc-bal-val{font-weight:600;text-align:right;min-width:130px}
    .doc-bal-val.neg{color:#dc2626}
    .doc-bal-total{background:#f8fafc;font-weight:700}
    .doc-bal-total .doc-bal-label,.doc-bal-total .doc-bal-val{font-weight:700}
    .doc-bal-highlight{background:#eff6ff}
    .doc-bal-highlight .doc-bal-label,.doc-bal-highlight .doc-bal-val{font-weight:800;color:#1d4ed8}
    .doc-tipo-tag{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:6px}
    .doc-table{width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:22px}
    .doc-table th{background:#2563eb;color:#fff;padding:7px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.3px}
    .doc-table th.r,.doc-table td.r{text-align:right}
    .doc-table th.c,.doc-table td.c{text-align:center}
    .doc-table td{padding:7px 10px;border-bottom:1px solid #e2e8f0}
    .doc-table tfoot td{background:#f1f5f9;font-weight:700;border-top:2px solid #cbd5e1}
    .doc-signatures{display:flex;gap:50px;margin-top:36px}
    .doc-sig{flex:1}
    .doc-sig-line{border-bottom:1.5px solid #94a3b8;height:34px;margin-bottom:6px}
    .doc-sig-label{font-size:10px;color:#64748b;text-align:center}
    .t-empty{text-align:center;padding:20px;color:#94a3b8;font-size:12px}
  `; }

  return { generar, cargar, render, updatePreview, setObservacion, eliminarItem,
           habilitarEdicion, guardar, printDoc, exportPDF, exportExcel };
})();
