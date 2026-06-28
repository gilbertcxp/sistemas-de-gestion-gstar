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

    const totalCXC = _rows.filter(r => r.tipo === 'CXC').reduce((s,r) => s + Math.abs(r.pendiente), 0);
    const totalCXP = _rows.filter(r => r.tipo === 'CXP').reduce((s,r) => s + Math.abs(r.pendiente), 0);
    const saldo    = totalCXC - totalCXP;
    const saldoCls = saldo >= 0 ? 'ok' : 'warn';
    const saldoTag = saldo > 0.001 ? 'A FAVOR' : saldo < -0.001 ? 'A PAGAR' : 'EN CERO';

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
          <p class="doc-subtitle">Compensación de Consorcios</p>
        </div>

        <div class="ec-consorcio-head">
          <div class="ec-label">CONSORCIO</div>
          <div class="ec-name">${_consorcioSelected
            ? Utils.escapeHtml(_consorcioSelected)
            : '<span style="color:#94a3b8;font-style:italic;font-size:16px">Selecciona un consorcio</span>'}</div>

          ${_consorcioSelected && _rows.length > 0 ? `
          <div class="ec-balance-cards" style="margin-top:20px;">
            <div class="ec-bal-card blue">
              <div class="ec-bal-lbl">Por Cobrar (CXC)</div>
              <div class="ec-bal-val">${Utils.fmtMoney(totalCXC)}</div>
            </div>
            <div class="ec-bal-card red">
              <div class="ec-bal-lbl">Por Pagar (CXP)</div>
              <div class="ec-bal-val">${Utils.fmtMoney(totalCXP)}</div>
            </div>
          </div>

          <div class="ec-saldo-bloque ec-saldo-${saldoCls}" style="margin-top:16px;">
            <div class="ec-saldo-tag">${saldoTag}</div>
            <div class="ec-saldo-monto">${Utils.fmtMoney(Math.abs(saldo))}</div>
            <div class="ec-saldo-desc">${saldo > 0.001 ? 'Saldo a favor del consorcio' : saldo < -0.001 ? 'Saldo pendiente de pago' : 'Cuenta en cero'}</div>
          </div>

          <div class="doc-signatures" style="margin-top:48px;">
            <div class="doc-sig"><div class="doc-sig-line"></div><div class="doc-sig-label">Preparado por</div></div>
            <div class="doc-sig"><div class="doc-sig-line"></div><div class="doc-sig-label">Recibido por</div></div>
          </div>` : _consorcioSelected ? `
          <div class="t-empty" style="margin-top:20px;">No hay movimientos registrados para este consorcio.</div>` : ''}
        </div>
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
    w.document.close(); w.focus();
    w.onload = () => { w.print(); w.onafterprint = () => w.close(); };
  }

  // ------ PDF export ------
  function exportPDF(){
    _updatePreview();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const W = 210, M = 20;
    const cfg = Storage.getSettings();

    const totalCXC = _rows.filter(r => r.tipo === 'CXC').reduce((s,r) => s + Math.abs(r.pendiente), 0);
    const totalCXP = _rows.filter(r => r.tipo === 'CXP').reduce((s,r) => s + Math.abs(r.pendiente), 0);
    const saldo    = totalCXC - totalCXP;
    const saldoTag = saldo > 0.001 ? 'A FAVOR' : saldo < -0.001 ? 'A PAGAR' : 'EN CERO';
    let y = 20;

    // ---- Header band ----
    doc.setFillColor(11,20,55);
    doc.rect(0, 0, W, 30, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(17); doc.setTextColor(255,255,255);
    doc.text('Estado de Cuenta', M, 13);
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(160,190,230);
    doc.text('Compensación de Consorcios — ' + (cfg.empresa?.nombre||'Gstar Services S.A.'), M, 21);
    doc.text(new Date().toLocaleDateString('es-DO'), W-M, 13, {align:'right'});
    y = 40;

    // ---- Consorcio ----
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(100,116,139);
    doc.text('CONSORCIO', M, y); y += 5;
    doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(15,23,42);
    doc.text(_consorcioSelected||'—', M, y); y += 14;

    // ---- CXC / CXP cards ----
    doc.autoTable({
      startY: y,
      head: [['Por Cobrar (CXC)', 'Por Pagar (CXP)']],
      body: [[Utils.fmtMoney(totalCXC), Utils.fmtMoney(totalCXP)]],
      theme: 'grid',
      styles: { fontSize:11, cellPadding:5, halign:'center', fontStyle:'bold' },
      headStyles: { fillColor:[37,99,235], textColor:255, fontStyle:'bold', fontSize:9 },
    });
    y = doc.lastAutoTable.finalY + 10;

    // ---- Saldo neto highlight ----
    const isAFavor = saldo > 0.001;
    const isAPagar = saldo < -0.001;
    const bandColor = isAFavor ? [21,135,90] : isAPagar ? [214,41,62] : [100,116,139];
    doc.setFillColor(...bandColor);
    doc.roundedRect(M, y, W-2*M, 28, 4, 4, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(255,255,255);
    doc.text(saldoTag, W/2, y+9, {align:'center'});
    doc.setFontSize(18);
    doc.text(Utils.fmtMoney(Math.abs(saldo)), W/2, y+21, {align:'center'});
    y += 42;

    // ---- Signatures ----
    const sigW = (W - 2*M - 20) / 2;
    doc.setDrawColor(148,163,184);
    doc.line(M, y+10, M+sigW, y+10);
    doc.line(M+sigW+20, y+10, M+2*sigW+20, y+10);
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(100,116,139);
    doc.text('Preparado por', M+sigW/2, y+15, {align:'center'});
    doc.text('Recibido por', M+sigW+20+sigW/2, y+15, {align:'center'});

    doc.save(`Estado_Cuenta_${(_consorcioSelected||'consorcio').replace(/\s+/g,'_')}_${Utils.todayISO()}.pdf`);
    UI.toast('PDF descargado correctamente', 'ok');
  }

  // ------ Print CSS ------
  function _printCSS(){ return `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;padding:18mm 22mm;color:#334155;font-size:12px}
    .doc-page{max-width:100%}
    .doc-header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #e2e8f0;margin-bottom:18px}
    .doc-logo{height:52px}
    .doc-header-right{text-align:right}
    .doc-empresa{font-size:14px;font-weight:700;color:#0f172a}
    .doc-sub,.doc-fecha{font-size:11px;color:#64748b}
    .doc-title-block{border-left:4px solid #2563eb;padding-left:11px;margin-bottom:16px}
    .doc-title{font-size:20px;font-weight:800;color:#0f172a}
    .doc-subtitle{font-size:11px;color:#64748b;margin-top:2px}
    .ec-consorcio-head{margin-bottom:0}
    .ec-label{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:3px}
    .ec-name{font-size:19px;font-weight:800;color:#0f172a}
    .ec-balance-cards{display:flex;gap:10px;margin-top:16px}
    .ec-bal-card{flex:1;padding:12px 16px;border-radius:7px;border:1px solid #e2e8f0}
    .ec-bal-card.blue{background:#eff6ff;border-color:#bfdbfe}
    .ec-bal-card.red{background:#fef2f2;border-color:#fecaca}
    .ec-bal-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#64748b}
    .ec-bal-val{font-size:14px;font-weight:800;color:#0f172a;margin-top:4px}
    .ec-saldo-bloque{border-radius:10px;padding:20px 24px;margin-top:16px;text-align:center;print-color-adjust:exact;-webkit-print-color-adjust:exact}
    .ec-saldo-ok{background:#f0fdf4;border:2px solid #86efac}
    .ec-saldo-warn{background:#fef2f2;border:2px solid #fca5a5}
    .ec-saldo-tag{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px}
    .ec-saldo-ok .ec-saldo-tag{color:#15875a}
    .ec-saldo-warn .ec-saldo-tag{color:#b91c1c}
    .ec-saldo-monto{font-size:28px;font-weight:800;color:#0f172a}
    .ec-saldo-desc{font-size:11px;color:#64748b;margin-top:4px}
    .doc-signatures{display:flex;gap:50px;margin-top:40px}
    .doc-sig{flex:1}
    .doc-sig-line{border-bottom:1.5px solid #94a3b8;height:34px;margin-bottom:6px}
    .doc-sig-label{font-size:9.5px;color:#64748b;text-align:center}
    .t-empty{text-align:center;padding:20px;color:#94a3b8}
  `; }

  return { render, onConsorcioChange, printDoc, exportPDF };
})();
