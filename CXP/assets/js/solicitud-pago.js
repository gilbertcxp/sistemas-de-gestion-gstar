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
  // El Saldo Pendiente ya viene expresado en RD$ desde el reporte (las facturas en
  // US$ se registran con su equivalente ya convertido), así que el total es uno solo.
  function _calcTotals(){
    const bank = _getBankInputs();
    const montoDisponible = bank.balanceBanco - bank.chequesTransito - bank.provisiones + bank.depositos;
    const montoAPagar = _items.reduce((s,i)=>s+(i.valor||0),0);
    const disponibilidadActualizada = montoDisponible - montoAPagar;
    return { bank, montoDisponible, montoAPagar, disponibilidadActualizada };
  }
  function _fmtDateShort(iso){
    const d = Utils.parseISODate(iso);
    if(!d) return '—';
    return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
  }
  // Formato contable: negativos entre paréntesis y en rojo, sin símbolo de moneda
  function _fmtSigned(n){
    n = Number(n)||0;
    return n < 0 ? `<span class="neg">(${Utils.fmtNum(Math.abs(n))})</span>` : Utils.fmtNum(n);
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
    const { montoAPagar } = _calcTotals();
    const sol = {
      id: _id || Utils.uid('sol'),
      fecha: _createdAt || Utils.todayISO(),
      guardadaEn: new Date().toISOString(),
      estado: 'Guardada',
      bank: Storage.getBank(),
      items: _items,
      totalGeneral: montoAPagar,
      totalDocs: _items.length
    };
    Storage.upsertSolicitud(sol);
    _id = sol.id;
    _locked = true;
    render();
    UI.toast('Solicitud de pago guardada', 'ok');
  }

  // ------ Build doc HTML (vista previa / impresión / PDF) — réplica del Excel ------
  function _buildDocHTML(){
    const { bank, montoDisponible, montoAPagar, disponibilidadActualizada } = _calcTotals();
    const cuenta = bank.cuentaLabel || 'Balance en banco';

    const bbRow = (label, val, extra='') =>
      `<div class="bb-row${extra}">
         <span class="l">${Utils.escapeHtml(label)}</span>
         <span class="v">${_fmtSigned(val)}</span>
       </div>`;
    const bbRowText = (label, text, extra='') =>
      `<div class="bb-row${extra}">
         <span class="l">${Utils.escapeHtml(label)}</span>
         <span class="v">${Utils.escapeHtml(text)}</span>
       </div>`;

    const tableRows = _items.length === 0
      ? `<tr><td colspan="4"><div class="t-empty">No hay documentos en esta solicitud.</div></td></tr>`
      : _items.map(i => {
          const detalle = Utils.escapeHtml(i.detalle||'—') + (i.observaciones ? ` <i>(${Utils.escapeHtml(i.observaciones)})</i>` : '');
          return `<tr>
            <td>${Utils.fmtDate(i.fecha)}</td>
            <td>${Utils.escapeHtml(i.proveedor)}</td>
            <td>${detalle}</td>
            <td class="r">${Utils.fmtNum(i.valor)}</td>
          </tr>`;
        }).join('');

    return `
      <div class="doc-page">
        <div class="doc-top">
          <img src="assets/img/logo.png" class="doc-logo2" alt="Logo" onerror="this.style.display='none'">
          <div class="doc-bankblock">
            ${bbRowText('Actualizado', _fmtDateShort(_createdAt || Utils.todayISO()), ' header')}
            ${bbRow(cuenta, bank.balanceBanco)}
            ${bbRow('Menos: Cheques o transferencias en transito', -bank.chequesTransito)}
            ${bbRow('Menos: Provisiones, Reservas y pagos de compensacion de la sem.', -bank.provisiones)}
            ${bbRow('Mas: Depositos o transferencias entre cuentas', bank.depositos)}
            ${bbRow('Monto disponible para pagos', montoDisponible, ' total')}
            <div class="bb-spacer"></div>
            ${bbRow('Monto a Pagar', montoAPagar, ' pagar')}
            ${bbRow(`Disponibilidad actualizada ${cuenta}`, disponibilidadActualizada, ' total')}
          </div>
        </div>

        <div class="doc-title-bar">Solicitud De Pagos</div>
        <table class="doc-table2">
          <thead>
            <tr><th>FECHA</th><th>SUPLIDOR</th><th>DETALLE</th><th class="r">VALOR</th></tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
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
    // Captura .doc-page (tamaño real del documento), no el contenedor con scroll horizontal
    const el = document.querySelector('#spDocument .doc-page');
    if(!el){ UI.toast('No hay documento para exportar', 'err'); return; }
    UI.toast('Generando PDF…', 'ok');
    html2canvas(el, { scale:2, useCORS:true, backgroundColor:'#ffffff', logging:false })
      .then(canvas => {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
        const imgData = canvas.toDataURL('image/jpeg', 0.97);
        const pgW = 297, pgH = 210, imgW = pgW;
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
    @page{ size:A4 landscape; margin:12mm 14mm; }
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;color:#1f2937}
    .doc-page{max-width:100%}
    .doc-top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:18px}
    .doc-logo2{height:56px}
    .doc-bankblock{min-width:400px}
    .bb-row{display:flex;justify-content:space-between;gap:20px;padding:2px 0;font-size:11.5px}
    .bb-row .l{flex:1;text-align:right;color:#1f2937}
    .bb-row .v{font-weight:700;text-align:right;min-width:110px}
    .bb-row .v .neg{color:#dc2626}
    .bb-row.header .l,.bb-row.header .v{font-weight:800}
    .bb-row.total{background:#d9d9d9;font-weight:800}
    .bb-row.total .l,.bb-row.total .v{font-weight:800}
    .bb-row.pagar .l{font-weight:700}
    .bb-row.pagar .v{color:#dc2626;font-weight:800}
    .bb-spacer{height:6px}
    .doc-title-bar{background:#1f3864;color:#fff;text-align:center;font-weight:700;font-size:12.5px;letter-spacing:.3px;padding:8px;margin-top:4px}
    .doc-table2{width:100%;border-collapse:collapse;font-size:11px}
    .doc-table2 th{background:#1f3864;color:#fff;padding:7px 10px;text-align:left;font-size:10.5px;font-weight:700}
    .doc-table2 th.r,.doc-table2 td.r{text-align:right}
    .doc-table2 td{padding:5px 10px;border-bottom:1px solid #f1f5f9}
    .doc-table2 td.r{font-weight:600}
    .t-empty{text-align:center;padding:20px;color:#94a3b8;font-size:12px}
  `; }

  return { generar, cargar, render, updatePreview, setObservacion, eliminarItem,
           habilitarEdicion, guardar, printDoc, exportPDF, exportExcel };
})();
