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

          <table class="ec-det-table">
            <thead>
              <tr><th>Año</th><th>Mes</th><th>Tipo</th><th>Corte</th><th class="r">Saldo</th></tr>
            </thead>
            <tbody>
              ${_rows.map(r => {
                const isCXP = r.tipo === 'CXP';
                const amt   = isCXP
                  ? `(${Utils.fmtNum(Math.abs(r.pendiente))})`
                  : Utils.fmtNum(r.pendiente);
                return `<tr>
                  <td>${r.año||'—'}</td>
                  <td>${Utils.escapeHtml(r.mesLetra||'—')}</td>
                  <td><span class="ec-tipo-pill ${isCXP?'red':'blue'}">${r.tipo}</span></td>
                  <td>${Utils.escapeHtml(r.corte||'—')}</td>
                  <td class="r${isCXP?' neg':''}">${amt}</td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="4"><b>SALDO NETO</b></td>
                <td class="r ${saldo<0?'neg':''}"><b>${saldo<0?'(':''}${Utils.fmtMoney(Math.abs(saldo))}${saldo<0?')':''}</b></td>
              </tr>
            </tfoot>
          </table>

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

  // ------ PDF export — captura el preview HTML tal como se ve ------
  function exportPDF(){
    _updatePreview();
    const el = document.getElementById('ecDocument');
    if(!el){ UI.toast('No hay documento para exportar', 'err'); return; }
    UI.toast('Generando PDF…', 'ok');
    html2canvas(el, { scale:2, useCORS:true, backgroundColor:'#ffffff', logging:false })
      .then(canvas => {
        const { jsPDF } = window.jspdf;
        const pdf     = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
        const imgData = canvas.toDataURL('image/jpeg', 0.97);
        const pgW = 210, pgH = 297;
        const imgW = pgW;
        const imgH = (canvas.height / canvas.width) * pgW;
        if(imgH <= pgH){
          pdf.addImage(imgData, 'JPEG', 0, 0, imgW, imgH);
        } else {
          let yOff = 0;
          while(yOff < imgH){
            if(yOff > 0) pdf.addPage();
            pdf.addImage(imgData, 'JPEG', 0, -yOff, imgW, imgH);
            yOff += pgH;
          }
        }
        pdf.save(`Estado_Cuenta_${(_consorcioSelected||'consorcio').replace(/[\s\/]/g,'_')}_${Utils.todayISO()}.pdf`);
        UI.toast('PDF descargado correctamente', 'ok');
      })
      .catch(() => UI.toast('Error al generar el PDF', 'err'));
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
    .ec-det-table{width:100%;border-collapse:collapse;font-size:12px;margin:18px 0}
    .ec-det-table th{background:#1e3a8a;color:#fff;padding:10px 16px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}
    .ec-det-table th.r,.ec-det-table td.r{text-align:right}
    .ec-det-table td{padding:10px 16px;border-bottom:1px solid #e2e8f0;white-space:nowrap}
    .ec-det-table tbody tr:nth-child(even) td{background:#f8fafc}
    .ec-det-table tbody tr:hover td{background:#eff6ff}
    .ec-det-table tfoot td{background:#f1f5f9;font-weight:700;border-top:2px solid #cbd5e1;font-size:13px;padding:12px 16px}
    .ec-det-table td.neg{color:#dc2626}
    .ec-tipo-pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:10.5px;font-weight:700}
    .ec-tipo-pill.blue{background:#dbeafe;color:#1d4ed8}
    .ec-tipo-pill.red{background:#fee2e2;color:#dc2626}
  `; }

  return { render, onConsorcioChange, printDoc, exportPDF };
})();
