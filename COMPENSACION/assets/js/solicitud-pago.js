/* ============================================================
   SolicitudPago — genera el documento de solicitud de pago
   para un corte seleccionado
   ============================================================ */
const SolicitudPago = (() => {

  let _corteSelected = '';
  let _rows = [];

  // ------ helpers ------
  function _getInputs(){
    const n = id => parseFloat(document.getElementById(id)?.value)||0;
    return {
      balanceComp:  n('spBalanceComp'),
      transferencia: n('spTransferencia'),
      balanceOp:    n('spBalanceOp')
    };
  }

  function _saveBalances(){
    const { balanceComp, transferencia, balanceOp } = _getInputs();
    Storage.saveBankData({ balanceComp, transferencia, balanceOperativa: balanceOp });
  }

  function _calcTotals(){
    const { balanceComp, transferencia, balanceOp } = _getInputs();
    const balanceCompAct = balanceComp + transferencia;
    const totalPagar     = _rows.reduce((s,r) => s + Math.abs(r.pendiente), 0);
    const balanceDispOP  = balanceOp - totalPagar;
    return { balanceComp, transferencia, balanceOp, balanceCompAct, totalPagar, balanceDispOP };
  }

  // ------ Populate corte selector ------
  function _populateCortes(){
    const cortes = DataModule.getCortes();
    const sel = document.getElementById('spCorteSelect');
    if(!sel) return;
    sel.innerHTML = `<option value="">-- Seleccionar corte --</option>` +
      cortes.map(c => `<option value="${Utils.escapeHtml(c)}"${c===_corteSelected?' selected':''}>${Utils.escapeHtml(c)}</option>`).join('');
  }

  // ------ Build document HTML ------
  function _buildDocHTML(){
    const { balanceComp, transferencia, balanceOp, balanceCompAct, totalPagar, balanceDispOP } = _calcTotals();
    const cfg  = Storage.getSettings();
    const fecha = new Date().toLocaleDateString('es-DO', { day:'2-digit', month:'long', year:'numeric' });

    const balRow = (label, val, extra='') =>
      `<div class="doc-bal-row${extra}">
         <span class="doc-bal-label">${Utils.escapeHtml(label)}</span>
         <span class="doc-bal-val${val<0?' neg':''}">${Utils.fmtMoney(val)}</span>
       </div>`;

    const tableRows = _rows.length === 0
      ? `<tr><td colspan="3"><div class="t-empty">${_corteSelected ? 'No hay CXP pendientes en este corte.' : 'Selecciona un corte.'}</div></td></tr>`
      : _rows.map(r => `<tr>
            <td>${Utils.escapeHtml(r.consorcio)}</td>
            <td>${Utils.escapeHtml(r.corte)}</td>
            <td class="r">${Utils.fmtMoney(Math.abs(r.pendiente))}</td>
          </tr>`).join('');

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
          <p class="doc-subtitle">Compensación de Consorcios</p>
        </div>

        <div class="doc-corte-tag">
          ${_corteSelected ? `<b>Corte:</b> ${Utils.escapeHtml(_corteSelected)}` : '<i style="opacity:.6">Selecciona un corte</i>'}
        </div>

        <div class="doc-balance-grid">
          ${balRow('Balance en Cuenta Bancaria COMP', balanceComp)}
          ${balRow('Transferencia entre Cuentas', transferencia)}
          ${balRow('Balance COMP Actualizado', balanceCompAct, ' doc-bal-total')}
          ${balRow('Saldo a Favor en Cuenta Operativa', balanceOp)}
          ${balRow('Saldo a Pagar por Concepto de Corte', totalPagar)}
          ${balRow('Balance Disponible Después de Pago CTA OP', balanceDispOP, ' doc-bal-total')}
          <div class="doc-bal-row doc-bal-highlight">
            <span class="doc-bal-label">BALANCE DISPONIBLE COMPENSACIÓN</span>
            <span class="doc-bal-val">${Utils.fmtMoney(balanceCompAct)}</span>
          </div>
        </div>

        <div class="doc-tipo-tag">TIPO: CXP</div>

        <table class="doc-table">
          <thead>
            <tr><th>CONSORCIO</th><th>CORTE</th><th class="r">PENDIENTE</th></tr>
          </thead>
          <tbody>${tableRows}</tbody>
          ${_rows.length > 0 ? `<tfoot>
            <tr>
              <td colspan="2"><b>TOTAL A PAGAR</b></td>
              <td class="r"><b>${Utils.fmtMoney(totalPagar)}</b></td>
            </tr>
          </tfoot>` : ''}
        </table>

        <div class="doc-signatures">
          <div class="doc-sig"><div class="doc-sig-line"></div><div class="doc-sig-label">Preparado por</div></div>
          <div class="doc-sig"><div class="doc-sig-line"></div><div class="doc-sig-label">Autorizado por</div></div>
        </div>
      </div>`;
  }

  // ------ Public: render view ------
  function render(){
    DataModule.load();
    _populateCortes();
    // Restore saved balance values
    const saved = Storage.getBankData();
    const set = (id, v) => { const el = document.getElementById(id); if(el) el.value = v; };
    set('spBalanceComp',   saved.balanceComp   || 0);
    set('spTransferencia', saved.transferencia  || 0);
    set('spBalanceOp',     saved.balanceOperativa || 0);
    updatePreview();
  }

  function onCorteChange(val){
    _corteSelected = val;
    _rows = val ? DataModule.getCXPByCorte(val) : [];
    updatePreview();
  }

  function updatePreview(){
    _saveBalances();
    const el = document.getElementById('spDocument');
    if(el) el.innerHTML = _buildDocHTML();
  }

  // ------ Print ------
  function printDoc(){
    updatePreview();
    const content = document.getElementById('spDocument').innerHTML;
    const w = window.open('', '_blank', 'width=900,height=700');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Solicitud de Pago</title>
      <style>${_printCSS()}</style></head><body>${content}</body></html>`);
    w.document.close(); w.focus(); w.print(); w.close();
  }

  // ------ PDF export ------
  function exportPDF(){
    updatePreview();
    const { jsPDF } = window.jspdf;
    const doc  = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const W = 210, M = 15;
    const cfg  = Storage.getSettings();
    const { balanceComp, transferencia, balanceOp, balanceCompAct, totalPagar, balanceDispOP } = _calcTotals();
    let y = 20;

    // ---- Header band ----
    doc.setFillColor(11,20,55);
    doc.rect(0, 0, W, 30, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(17); doc.setTextColor(255,255,255);
    doc.text('Solicitud de Pago', M, 13);
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(160,190,230);
    doc.text('Compensación de Consorcios — ' + (cfg.empresa?.nombre||'Gstar Services S.A.'), M, 20);
    doc.text(new Date().toLocaleDateString('es-DO'), W-M, 13, {align:'right'});
    if(_corteSelected) doc.text('Corte: '+_corteSelected, W-M, 20, {align:'right'});
    y = 40;

    // ---- Balance rows ----
    const addBal = (label, val, bold, color) => {
      doc.setFont('helvetica', bold?'bold':'normal'); doc.setFontSize(9.5);
      doc.setTextColor(...(color||[40,50,70]));
      doc.text(label, M, y);
      doc.text(Utils.fmtMoney(val), W-M, y, {align:'right'});
      if(bold){ doc.setDrawColor(200,210,230); doc.line(M, y+1.5, W-M, y+1.5); }
      y += 7;
    };

    addBal('Balance en Cuenta Bancaria COMP', balanceComp);
    addBal('Transferencia entre Cuentas', transferencia);
    addBal('Balance COMP Actualizado', balanceCompAct, true);
    y += 2;
    addBal('Saldo a Favor en Cuenta Operativa', balanceOp);
    addBal('Saldo a Pagar por Concepto de Corte', totalPagar, false, [200,38,38]);
    addBal('Balance Disponible Después de Pago CTA OP', balanceDispOP, true,
      balanceDispOP < 0 ? [200,38,38] : [40,50,70]);
    y += 2;

    // Highlight bar
    doc.setFillColor(37,99,235);
    doc.rect(M-2, y-4.5, W-2*M+4, 11, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(255,255,255);
    doc.text('BALANCE DISPONIBLE COMPENSACIÓN', M+2, y+2);
    doc.text(Utils.fmtMoney(balanceCompAct), W-M-2, y+2, {align:'right'});
    y += 16;

    // ---- TIPO label ----
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(100,116,139);
    doc.text('TIPO: CXP', M, y);
    y += 5;

    // ---- Table ----
    if(_rows.length > 0){
      const body = [
        ..._rows.map(r => [r.consorcio, r.corte, Utils.fmtMoney(Math.abs(r.pendiente))]),
        ['', 'TOTAL A PAGAR', Utils.fmtMoney(totalPagar)]
      ];
      doc.autoTable({
        startY: y,
        head: [['CONSORCIO','CORTE','PENDIENTE']],
        body,
        theme:'grid',
        styles:{ fontSize:8.5, cellPadding:2.5 },
        headStyles:{ fillColor:[37,99,235], textColor:255, fontStyle:'bold' },
        columnStyles:{ 2:{ halign:'right', fontStyle:'bold' } },
        didParseCell: d => { if(d.row.index === body.length-1) d.cell.styles.fontStyle='bold'; }
      });
      y = doc.lastAutoTable.finalY + 14;
    }

    // ---- Signatures ----
    if(y > 240){ doc.addPage(); y = 20; }
    const sigW = (W - 2*M - 20) / 2;
    doc.setDrawColor(148,163,184);
    doc.line(M, y+10, M+sigW, y+10);
    doc.line(M+sigW+20, y+10, M+2*sigW+20, y+10);
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(100,116,139);
    doc.text('Preparado por', M+sigW/2, y+15, {align:'center'});
    doc.text('Autorizado por', M+sigW+20+sigW/2, y+15, {align:'center'});

    doc.save(`Solicitud_Pago_${(_corteSelected||Utils.todayISO()).replace(/\s/g,'_')}.pdf`);
    UI.toast('PDF descargado correctamente', 'ok');
  }

  // ------ Print CSS ------
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
    .doc-corte-tag{background:#eff6ff;color:#1d4ed8;padding:5px 12px;border-radius:5px;font-size:12px;font-weight:600;display:inline-block;margin-bottom:16px}
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
    .doc-table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:22px}
    .doc-table th{background:#2563eb;color:#fff;padding:7px 11px;text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.3px}
    .doc-table th.r,.doc-table td.r{text-align:right}
    .doc-table td{padding:7px 11px;border-bottom:1px solid #e2e8f0}
    .doc-table tfoot td{background:#f1f5f9;font-weight:700;border-top:2px solid #cbd5e1}
    .doc-signatures{display:flex;gap:50px;margin-top:36px}
    .doc-sig{flex:1}
    .doc-sig-line{border-bottom:1.5px solid #94a3b8;height:34px;margin-bottom:6px}
    .doc-sig-label{font-size:10px;color:#64748b;text-align:center}
    .t-empty{text-align:center;padding:20px;color:#94a3b8;font-size:12px}
  `; }

  return { render, onCorteChange, updatePreview, printDoc, exportPDF };
})();
