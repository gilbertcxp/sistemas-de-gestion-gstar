/* ============================================================
   EstadoCuenta — genera el estado de cuenta por consorcio
   ============================================================ */
const EstadoCuenta = (() => {

  let _consorcioSelected = '';
  let _rows = [];

  // ------ Populate consorcio selector ------
  function _populateConsorcios(){
    const consorcios = DataModule.getConsorcios();
    const sel = document.getElementById('ecConsorcioSelect');
    if(!sel) return;
    sel.innerHTML = `<option value="">-- Seleccionar consorcio --</option>` +
      consorcios.map(c => `<option value="${Utils.escapeHtml(c)}"${c===_consorcioSelected?' selected':''}>${Utils.escapeHtml(c)}</option>`).join('');
  }

  // ------ Build document HTML ------
  function _buildDocHTML(){
    const cfg   = Storage.getSettings();
    const fecha = new Date().toLocaleDateString('es-DO', { day:'2-digit', month:'long', year:'numeric' });

    const cxcRows = _rows.filter(r => r.tipo === 'CXC');
    const cxpRows = _rows.filter(r => r.tipo === 'CXP');
    const totalCXC  = cxcRows.reduce((s,r) => s + Math.abs(r.pendiente), 0);
    const totalCXP  = cxpRows.reduce((s,r) => s + Math.abs(r.pendiente), 0);
    const saldo     = totalCXC - totalCXP;
    const saldoCls  = saldo >= 0 ? 'ok' : 'warn';
    const saldoTag  = saldo > 0.001 ? 'A FAVOR' : saldo < -0.001 ? 'A PAGAR' : 'EN CERO';

    // Group by corte
    const corteMap = {};
    _rows.forEach(r => {
      if(!corteMap[r.corte]) corteMap[r.corte] = { cxc:[], cxp:[] };
      if(r.tipo === 'CXC') corteMap[r.corte].cxc.push(r);
      else                 corteMap[r.corte].cxp.push(r);
    });
    const corteEntries = Object.entries(corteMap).sort(([a],[b]) => a.localeCompare(b));

    const txRow = r => `<tr>
      <td style="white-space:nowrap">${r.fecha ? Utils.fmtDate(r.fecha) : '—'}</td>
      <td>${Utils.escapeHtml(r.mesLetra||'—')}</td>
      <td>${r.año||'—'}</td>
      <td class="r num">${Utils.fmtNum(r.monto)}</td>
      <td class="r num">${Utils.fmtNum(r.pago)}</td>
      <td class="r num"><b>${Utils.fmtNum(r.pendiente)}</b></td>
      <td style="font-size:10.5px">${r.estado}</td>
    </tr>`;

    const txTable = (rows, color) => rows.length === 0 ? '' : `
      <table class="doc-table" style="margin-bottom:8px">
        <thead style="background:${color}"><tr>
          <th>FECHA</th><th>MES</th><th>AÑO</th>
          <th class="r">MONTO</th><th class="r">PAGO</th><th class="r">PENDIENTE</th><th>ESTADO</th>
        </tr></thead>
        <tbody>${rows.map(txRow).join('')}</tbody>
      </table>`;

    const corteSections = corteEntries.length === 0
      ? `<div class="t-empty">${_consorcioSelected ? 'No hay movimientos para este consorcio.' : 'Selecciona un consorcio para ver su estado de cuenta.'}</div>`
      : corteEntries.map(([corte, data]) => `
          <div class="ec-corte-section">
            <div class="ec-corte-header">${Utils.escapeHtml(corte)}</div>
            ${data.cxc.length > 0 ? `<div class="ec-tipo-label">Cuentas por Cobrar (CXC)</div>${txTable(data.cxc,'#4f46e5')}` : ''}
            ${data.cxp.length > 0 ? `<div class="ec-tipo-label">Cuentas por Pagar (CXP)</div>${txTable(data.cxp,'#dc2626')}` : ''}
          </div>`).join('');

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
          <h2 class="doc-title">Estado de Cuenta</h2>
          <p class="doc-subtitle">Reporte de Compensación Consorcios</p>
        </div>

        <div class="ec-consorcio-head">
          <div class="ec-label">CONSORCIO</div>
          <div class="ec-name">${_consorcioSelected ? Utils.escapeHtml(_consorcioSelected) : '<span style="color:#94a3b8;font-style:italic;font-size:16px">Selecciona un consorcio</span>'}</div>
          ${_consorcioSelected ? `
          <div class="ec-balance-cards">
            <div class="ec-bal-card blue">
              <div class="ec-bal-lbl">CXC — Por Cobrar</div>
              <div class="ec-bal-val">${Utils.fmtMoney(totalCXC)}</div>
            </div>
            <div class="ec-bal-card red">
              <div class="ec-bal-lbl">CXP — Por Pagar</div>
              <div class="ec-bal-val">${Utils.fmtMoney(totalCXP)}</div>
            </div>
            <div class="ec-bal-card ${saldoCls}">
              <div class="ec-bal-lbl">Saldo Neto</div>
              <div class="ec-bal-val">${Utils.fmtMoney(Math.abs(saldo))} <span style="font-size:11px;font-weight:600">${saldoTag}</span></div>
            </div>
          </div>` : ''}
        </div>

        ${corteSections}

        ${_rows.length > 0 ? `<div class="doc-signatures">
          <div class="doc-sig"><div class="doc-sig-line"></div><div class="doc-sig-label">Preparado por</div></div>
          <div class="doc-sig"><div class="doc-sig-line"></div><div class="doc-sig-label">Recibido por</div></div>
        </div>` : ''}
      </div>`;
  }

  // ------ Public: render view ------
  function render(){
    DataModule.load();
    if(_consorcioSelected) _rows = DataModule.getByConsorcio(_consorcioSelected);
    _populateConsorcios();
    _updatePreview();
  }

  function onConsorcioChange(val){
    _consorcioSelected = val;
    _rows = val ? DataModule.getByConsorcio(val) : [];
    _updatePreview();
  }

  function _updatePreview(){
    const el = document.getElementById('ecDocument');
    if(el) el.innerHTML = _buildDocHTML();
  }

  // ------ Print ------
  function printDoc(){
    _updatePreview();
    const content = document.getElementById('ecDocument').innerHTML;
    const w = window.open('', '_blank', 'width=980,height=750');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Estado de Cuenta — ${Utils.escapeHtml(_consorcioSelected)}</title>
      <style>${_printCSS()}</style></head><body>${content}</body></html>`);
    w.document.close(); w.focus(); w.print(); w.close();
  }

  // ------ PDF export ------
  function exportPDF(){
    _updatePreview();
    const { jsPDF } = window.jspdf;
    const doc  = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const W = 210, M = 15;
    const cfg  = Storage.getSettings();
    const cxcRows = _rows.filter(r => r.tipo === 'CXC');
    const cxpRows = _rows.filter(r => r.tipo === 'CXP');
    const totalCXC = cxcRows.reduce((s,r) => s + Math.abs(r.pendiente), 0);
    const totalCXP = cxpRows.reduce((s,r) => s + Math.abs(r.pendiente), 0);
    const saldo    = totalCXC - totalCXP;
    const saldoTag = saldo > 0.001 ? 'A FAVOR' : saldo < -0.001 ? 'A PAGAR' : 'EN CERO';
    let y = 20;

    // ---- Header band ----
    doc.setFillColor(11,20,55);
    doc.rect(0, 0, W, 30, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(17); doc.setTextColor(255,255,255);
    doc.text('Estado de Cuenta', M, 13);
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(160,190,230);
    doc.text('Reporte de Compensación Consorcios — ' + (cfg.empresa?.nombre||'Gstar Services S.A.'), M, 20);
    doc.text(new Date().toLocaleDateString('es-DO'), W-M, 13, {align:'right'});
    y = 38;

    // ---- Consorcio ----
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(100,116,139);
    doc.text('CONSORCIO', M, y);
    y += 5;
    doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(15,23,42);
    doc.text(_consorcioSelected||'—', M, y);
    y += 10;

    // ---- Summary table ----
    doc.autoTable({
      startY: y,
      head: [['CXC — Por Cobrar', 'CXP — Por Pagar', 'Saldo Neto']],
      body: [[Utils.fmtMoney(totalCXC), Utils.fmtMoney(totalCXP),
              Utils.fmtMoney(Math.abs(saldo)) + ' ' + saldoTag]],
      theme:'grid', styles:{ fontSize:9, cellPadding:3, halign:'right' },
      headStyles:{ fillColor:[37,99,235], textColor:255, fontStyle:'bold', halign:'center' }
    });
    y = doc.lastAutoTable.finalY + 10;

    const txCols = [['CORTE','FECHA','MES','AÑO','MONTO','PAGO','PENDIENTE','ESTADO']];
    const txBody = rows => rows.map(r => [
      r.corte, r.fecha?Utils.fmtDate(r.fecha):'—', r.mesLetra||'—', r.año||'—',
      Utils.fmtNum(r.monto), Utils.fmtNum(r.pago), Utils.fmtNum(r.pendiente), r.estado
    ]);
    const txColStyles = { 4:{halign:'right'}, 5:{halign:'right'}, 6:{halign:'right',fontStyle:'bold'} };

    // ---- CXC ----
    if(cxcRows.length > 0){
      if(y > 240){ doc.addPage(); y = 20; }
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(79,70,229);
      doc.text('Cuentas por Cobrar (CXC)', M, y); y += 4;
      doc.autoTable({
        startY: y,
        head: txCols, body: txBody(cxcRows),
        theme:'grid', styles:{ fontSize:7.5, cellPadding:2 },
        headStyles:{ fillColor:[79,70,229], textColor:255, fontStyle:'bold', fontSize:7 },
        columnStyles: txColStyles
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    // ---- CXP ----
    if(cxpRows.length > 0){
      if(y > 240){ doc.addPage(); y = 20; }
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(220,38,38);
      doc.text('Cuentas por Pagar (CXP)', M, y); y += 4;
      doc.autoTable({
        startY: y,
        head: txCols, body: txBody(cxpRows),
        theme:'grid', styles:{ fontSize:7.5, cellPadding:2 },
        headStyles:{ fillColor:[220,38,38], textColor:255, fontStyle:'bold', fontSize:7 },
        columnStyles: txColStyles
      });
      y = doc.lastAutoTable.finalY + 14;
    }

    // ---- Signatures ----
    if(y > 250){ doc.addPage(); y = 20; }
    const sigW = (W - 2*M - 20) / 2;
    doc.setDrawColor(148,163,184);
    doc.line(M, y+10, M+sigW, y+10);
    doc.line(M+sigW+20, y+10, M+2*sigW+20, y+10);
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(100,116,139);
    doc.text('Preparado por', M+sigW/2, y+15, {align:'center'});
    doc.text('Recibido por', M+sigW+20+sigW/2, y+15, {align:'center'});

    const fname = `Estado_Cuenta_${(_consorcioSelected||'consorcio').replace(/\s+/g,'_')}_${Utils.todayISO()}.pdf`;
    doc.save(fname);
    UI.toast('PDF descargado correctamente', 'ok');
  }

  // ------ Print CSS ------
  function _printCSS(){ return `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;padding:15mm 18mm;color:#334155;font-size:12px}
    .doc-page{max-width:100%}
    .doc-header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #e2e8f0;margin-bottom:16px}
    .doc-logo{height:52px}
    .doc-header-right{text-align:right}
    .doc-empresa{font-size:14px;font-weight:700;color:#0f172a}
    .doc-sub,.doc-fecha{font-size:11px;color:#64748b}
    .doc-title-block{border-left:4px solid #2563eb;padding-left:11px;margin-bottom:14px}
    .doc-title{font-size:19px;font-weight:800;color:#0f172a}
    .doc-subtitle{font-size:11px;color:#64748b;margin-top:2px}
    .ec-consorcio-head{margin-bottom:16px}
    .ec-label{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:3px}
    .ec-name{font-size:18px;font-weight:800;color:#0f172a}
    .ec-balance-cards{display:flex;gap:10px;margin-top:10px}
    .ec-bal-card{flex:1;padding:10px 14px;border-radius:6px;border:1px solid #e2e8f0}
    .ec-bal-card.blue{background:#eff6ff;border-color:#bfdbfe}
    .ec-bal-card.red{background:#fef2f2;border-color:#fecaca}
    .ec-bal-card.ok{background:#f0fdf4;border-color:#bbf7d0}
    .ec-bal-card.warn{background:#fffbeb;border-color:#fde68a}
    .ec-bal-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#64748b}
    .ec-bal-val{font-size:13px;font-weight:800;color:#0f172a;margin-top:3px}
    .ec-corte-section{margin-bottom:18px}
    .ec-corte-header{background:#1e3a8a;color:#fff;padding:5px 12px;border-radius:5px;font-size:11px;font-weight:700;margin-bottom:7px}
    .ec-tipo-label{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:4px;margin-top:8px}
    .doc-table{width:100%;border-collapse:collapse;font-size:10.5px;margin-bottom:6px}
    .doc-table th{color:#fff;padding:6px 9px;text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.2px}
    .doc-table th.r,.doc-table td.r{text-align:right}
    .doc-table td.num,.r.num{text-align:right;font-variant-numeric:tabular-nums}
    .doc-table td{padding:6px 9px;border-bottom:1px solid #e2e8f0}
    .doc-signatures{display:flex;gap:45px;margin-top:32px}
    .doc-sig{flex:1}
    .doc-sig-line{border-bottom:1.5px solid #94a3b8;height:32px;margin-bottom:5px}
    .doc-sig-label{font-size:9.5px;color:#64748b;text-align:center}
    .t-empty{text-align:center;padding:20px;color:#94a3b8}
  `; }

  return { render, onConsorcioChange, printDoc, exportPDF };
})();
