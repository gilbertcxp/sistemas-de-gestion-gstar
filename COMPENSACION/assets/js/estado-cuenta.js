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

  // ------ Iconos (inline SVG) ------
  const _icons = {
    building: '<path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M9 7h2M9 11h2M9 15h2"/><path d="M15 21V11h2a2 2 0 0 1 2 2v8"/>',
    pie:      '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    wallet:   '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
    card:     '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
    scale:    '<path d="M12 3v18M7 21h10M5 7h14l-3-4H8zM6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z"/>',
    check:    '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    thumb:    '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>',
    clipboard:'<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
    info:     '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'
  };
  function _svg(name, cls){
    return `<svg class="${cls||''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${_icons[name]}</svg>`;
  }

  // ------ Build document HTML ------
  function _buildDocHTML(){
    const cfg   = Storage.getSettings();
    const now   = new Date();
    const fecha = now.toLocaleDateString('es-DO', { day:'2-digit', month:'long', year:'numeric' });
    const fechaGen = now.toLocaleDateString('es-DO') + ' ' +
      now.toLocaleTimeString('es-DO', { hour:'2-digit', minute:'2-digit' });

    const styles = _docCSS();

    // ----- Estado vacío -----
    if(!_consorcioSelected || _rows.length === 0){
      return `<style>${styles}</style>
        <div class="ec-doc">
          ${_docHeader(cfg, fecha)}
          <div class="ec-empty">${_consorcioSelected
            ? 'No hay movimientos registrados para este consorcio.'
            : 'Selecciona un consorcio para generar su estado de cuenta.'}</div>
        </div>`;
    }

    const totalCXC = _rows.filter(r => r.tipo === 'CXC').reduce((s,r) => s + Math.abs(r.pendiente), 0);
    const totalCXP = _rows.filter(r => r.tipo === 'CXP').reduce((s,r) => s + Math.abs(r.pendiente), 0);
    const saldo    = totalCXC - totalCXP;
    const isFavor  = saldo > 0.001, isPagar = saldo < -0.001;
    const stateCls = isFavor ? 'favor' : isPagar ? 'pagar' : 'cero';
    const stateTag = isFavor ? 'A FAVOR DEL CONSORCIO' : isPagar ? 'A PAGAR' : 'EN CERO';

    const detRows = _rows.filter(r => Math.abs(r.pendiente) > 0.001).map(r => {
      const isCXP = r.tipo === 'CXP';
      return `<tr>
        <td>${r.año||'—'}</td>
        <td>${Utils.escapeHtml(r.mesLetra||'—')}</td>
        <td><span class="ec-tipo-pill ${isCXP?'red':'blue'}">${r.tipo}</span></td>
        <td>${Utils.escapeHtml(r.corte||'—')}</td>
        <td class="r ${isCXP?'neg':''}">${isCXP?'-':''}${Utils.fmtMoney(Math.abs(r.pendiente))}</td>
      </tr>`;
    }).join('');

    return `<style>${styles}</style>
      <div class="ec-doc">
        ${_docHeader(cfg, fecha)}

        <div class="ec-consorcio-row">
          <div class="ec-cons-icon">${_svg('building')}</div>
          <div>
            <div class="ec-cons-lbl">CONSORCIO</div>
            <div class="ec-cons-name">${Utils.escapeHtml(_consorcioSelected)}</div>
          </div>
        </div>

        <div class="ec-section-title">
          <span class="ec-sec-ic">${_svg('pie')}</span>
          <div>
            <div class="ec-sec-h">RESUMEN GENERAL</div>
            <div class="ec-sec-sub">Compensación de Consorcios</div>
          </div>
        </div>

        <div class="ec-cards">
          <div class="ec-card blue">
            <div class="ec-card-ic">${_svg('wallet')}</div>
            <div class="ec-card-ttl">Total por Cobrar (CxC)</div>
            <div class="ec-card-val">${Utils.fmtMoney(totalCXC)}</div>
          </div>
          <div class="ec-card red">
            <div class="ec-card-ic">${_svg('card')}</div>
            <div class="ec-card-ttl">Total por Pagar (CxP)</div>
            <div class="ec-card-val">${Utils.fmtMoney(totalCXP)}</div>
          </div>
          <div class="ec-card green">
            <div class="ec-card-ic">${_svg('scale')}</div>
            <div class="ec-card-ttl">Balance Neto (CxC − CxP)</div>
            <div class="ec-card-val">${Utils.fmtMoney(saldo)}</div>
          </div>
        </div>

        <div class="ec-total ${stateCls}">
          <div class="ec-total-thumb">${_svg('thumb')}</div>
          <div class="ec-total-check">${_svg('check')}</div>
          <div class="ec-total-tag">${stateTag}</div>
          <div class="ec-total-val">${Utils.fmtMoney(Math.abs(saldo))}</div>
        </div>

        <div class="ec-section-title sm">
          <span class="ec-sec-ic light">${_svg('clipboard')}</span>
          <div>
            <div class="ec-sec-h">DETALLE DE MOVIMIENTOS</div>
            <div class="ec-sec-sub">Información del período seleccionado</div>
          </div>
        </div>

        <table class="ec-det-table">
          <thead>
            <tr><th>AÑO</th><th>MES</th><th>TIPO</th><th>RANGO DE CORTE</th><th class="r">MONTO</th></tr>
          </thead>
          <tbody>${detRows}</tbody>
        </table>

        <div class="ec-footer">
          <div class="ec-foot-gen">
            <span class="ec-foot-ic">${_svg('calendar')}</span>
            <span><b>Fecha de generación:</b> ${fechaGen}</span>
          </div>
        </div>
      </div>`;
  }

  function _docHeader(cfg, fecha){
    return `<div class="ec-head">
      <img src="assets/img/logo.png" class="ec-logo" alt="Logo" onerror="this.style.display='none'">
      <div class="ec-head-right">
        <div class="ec-empresa">${Utils.escapeHtml(cfg.empresa?.nombre||'Gstar Services S.A')}</div>
        <div class="ec-rnc">RNC ${Utils.escapeHtml(cfg.empresa?.rnc||'131751016')}</div>
        <div class="ec-fecha">${fecha}</div>
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
      <style>body{margin:0;padding:14mm}</style></head><body>${content}</body></html>`);
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

  // ------ Document CSS (embebido para preview + print + PDF idénticos) ------
  function _docCSS(){ return `
    .ec-doc{font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;background:#fff;
      max-width:820px;margin:0 auto;border-top:5px solid #1d4ed8;border-radius:4px;
      padding:32px 36px 28px}
    .ec-doc *{box-sizing:border-box}
    .ec-doc svg{width:100%;height:100%;display:block}

    .ec-head{display:flex;justify-content:space-between;align-items:flex-start;
      padding-bottom:18px;border-bottom:1px solid #e2e8f0;margin-bottom:22px}
    .ec-logo{height:54px}
    .ec-head-right{text-align:right}
    .ec-empresa{font-size:18px;font-weight:800;color:#0f172a}
    .ec-rnc{font-size:12px;color:#94a3b8;margin-top:2px}
    .ec-fecha{font-size:12px;color:#64748b;margin-top:2px}

    .ec-consorcio-row{display:flex;align-items:center;gap:16px;
      padding-bottom:20px;border-bottom:1px solid #e2e8f0;margin-bottom:22px}
    .ec-cons-icon{width:54px;height:54px;border-radius:50%;background:#1d4ed8;color:#fff;
      display:flex;align-items:center;justify-content:center;flex:none}
    .ec-cons-icon svg{width:28px;height:28px}
    .ec-cons-lbl{font-size:12px;font-weight:700;letter-spacing:.5px;color:#2563eb}
    .ec-cons-name{font-size:30px;font-weight:800;color:#0f172a;line-height:1.1}

    .ec-section-title{display:flex;align-items:center;justify-content:center;gap:12px;margin:8px 0 18px}
    .ec-section-title.sm{justify-content:flex-start;margin:26px 0 14px}
    .ec-sec-ic{width:30px;height:30px;color:#2563eb;flex:none}
    .ec-sec-ic.light{color:#64748b}
    .ec-sec-h{font-size:17px;font-weight:800;color:#0f172a;letter-spacing:.3px}
    .ec-section-title:not(.sm) .ec-sec-h{text-align:center}
    .ec-sec-sub{font-size:12px;color:#64748b}
    .ec-section-title:not(.sm){flex-direction:row;text-align:center}
    .ec-section-title:not(.sm) > div{text-align:center}

    .ec-cards{display:flex;gap:14px;margin-bottom:22px}
    .ec-card{flex:1;border-radius:14px;padding:18px;border:1.5px solid}
    .ec-card.blue{background:#eff6ff;border-color:#bfdbfe}
    .ec-card.red{background:#fef2f2;border-color:#fecaca}
    .ec-card.green{background:#f0fdf4;border-color:#bbf7d0}
    .ec-card-ic{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;
      justify-content:center;color:#fff;margin-bottom:14px}
    .ec-card-ic svg{width:22px;height:22px}
    .ec-card.blue .ec-card-ic{background:#2563eb}
    .ec-card.red .ec-card-ic{background:#dc2626}
    .ec-card.green .ec-card-ic{background:#16a34a}
    .ec-card-ttl{font-size:14px;font-weight:700;color:#0f172a;line-height:1.3}
    .ec-card-val{font-size:22px;font-weight:800;margin-top:14px}
    .ec-card.blue .ec-card-val{color:#2563eb}
    .ec-card.red .ec-card-val{color:#dc2626}
    .ec-card.green .ec-card-val{color:#16a34a}

    .ec-total{position:relative;overflow:hidden;border-radius:16px;padding:30px 24px;
      text-align:center;margin-bottom:8px;border:2px solid}
    .ec-total.favor{background:#f0fdf4;border-color:#86efac}
    .ec-total.pagar{background:#fef2f2;border-color:#fca5a5}
    .ec-total.cero{background:#f8fafc;border-color:#cbd5e1}
    .ec-total-thumb{position:absolute;right:18px;bottom:-6px;width:130px;height:130px;opacity:.10}
    .ec-total.favor .ec-total-thumb{color:#16a34a}
    .ec-total.pagar .ec-total-thumb{color:#dc2626}
    .ec-total.cero .ec-total-thumb{color:#64748b}
    .ec-total-check{width:46px;height:46px;margin:0 auto 8px}
    .ec-total.favor .ec-total-check{color:#16a34a}
    .ec-total.pagar .ec-total-check{color:#dc2626}
    .ec-total.cero .ec-total-check{color:#64748b}
    .ec-total-tag{font-size:14px;font-weight:800;letter-spacing:.6px;margin-bottom:6px}
    .ec-total.favor .ec-total-tag{color:#15803d}
    .ec-total.pagar .ec-total-tag{color:#b91c1c}
    .ec-total.cero .ec-total-tag{color:#475569}
    .ec-total-val{font-size:54px;font-weight:800;line-height:1}
    .ec-total.favor .ec-total-val{color:#16a34a}
    .ec-total.pagar .ec-total-val{color:#dc2626}
    .ec-total.cero .ec-total-val{color:#334155}

    .ec-det-table{width:100%;border-collapse:collapse;font-size:13px;
      border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}
    .ec-det-table th{background:#f1f5f9;color:#64748b;padding:13px 18px;text-align:left;
      font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}
    .ec-det-table th.r,.ec-det-table td.r{text-align:right}
    .ec-det-table td{padding:15px 18px;border-top:1px solid #eef2f7;white-space:nowrap;font-weight:600}
    .ec-det-table td.neg{color:#dc2626}
    .ec-tipo-pill{display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700}
    .ec-tipo-pill.blue{background:#dbeafe;color:#1d4ed8}
    .ec-tipo-pill.red{background:#fee2e2;color:#dc2626}

    .ec-footer{display:flex;justify-content:center;align-items:center;gap:20px;
      background:#eff6ff;border:1px solid #dbeafe;border-radius:12px;padding:16px 20px;margin-top:22px}
    .ec-foot-gen{display:flex;gap:10px;align-items:center;font-size:12.5px;color:#2563eb}
    .ec-foot-gen b{color:#2563eb}
    .ec-foot-ic{width:20px;height:20px;color:#2563eb;flex:none;margin-top:1px}

    .ec-empty{text-align:center;padding:60px 20px;color:#94a3b8;font-size:14px}
  `; }

  return { render, onConsorcioChange, printDoc, exportPDF };
})();
