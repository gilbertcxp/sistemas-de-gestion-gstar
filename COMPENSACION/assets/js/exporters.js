/* ============================================================
   Exporters — PDF individual/lote, ZIP de la carga actual,
   reportes Excel/PDF
   ============================================================ */
const Exporters = (() => {

  function waitImages(container){
    const imgs = Array.from(container.querySelectorAll('img'));
    return Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(res => { img.onload = res; img.onerror = res; })));
  }

  function safeFileName(s){
    return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_\- ]/g,'').replace(/\s+/g,'_').slice(0,60);
  }

  // Renderiza una factura fuera de pantalla y devuelve el canvas
  async function renderInvoiceCanvas(inv){
    const holder = document.createElement('div');
    holder.style.position = 'fixed';
    holder.style.left = '-9999px';
    holder.style.top = '0';
    holder.className = 'invoice-paper';
    holder.style.width = '850px';
    holder.innerHTML = Invoices.renderInvoiceHTML(inv);
    document.body.appendChild(holder);
    try{
      await waitImages(holder);
      await new Promise(r => setTimeout(r, 80)); // layout settle
      const canvas = await html2canvas(holder, { scale:2, backgroundColor:'#ffffff', useCORS:true, allowTaint:false });
      return canvas;
    } finally {
      document.body.removeChild(holder);
    }
  }

  function addCanvasToPdf(pdf, canvas, isFirst){
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const ratio = Math.min(pageW/canvas.width, pageH/canvas.height);
    const w = canvas.width*ratio, h = canvas.height*ratio;
    if(!isFirst) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg',0.95), 'JPEG', (pageW-w)/2, 10, w, h-10);
  }

  async function buildSinglePdfBlob(inv){
    const canvas = await renderInvoiceCanvas(inv);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation:'p', unit:'mm', format:'letter' });
    addCanvasToPdf(pdf, canvas, true);
    return pdf.output('blob');
  }

  async function exportSinglePDF(numero){
    const inv = Invoices.byNumero(numero);
    if(!inv) return;
    try{
      UI.toast('Generando PDF…');
      const blob = await buildSinglePdfBlob(inv);
      Utils.download(`${inv.numero}_${safeFileName(inv.clienteNombre)}.pdf`, blob);
      UI.toast('PDF descargado', 'ok');
    }catch(err){
      console.error('exportSinglePDF error:', err);
      UI.toast('No se pudo generar el PDF: ' + (err && err.message ? err.message : 'error desconocido'), 'err');
    }
  }

  async function exportBatchPDF(numbers){
    if(!numbers.length){ UI.toast('Selecciona al menos una factura', 'err'); return; }
    try{
      UI.toast(`Generando ${numbers.length} factura(s)…`);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation:'p', unit:'mm', format:'letter' });
      let first = true;
      for(const numero of numbers){
        const inv = Invoices.byNumero(numero);
        if(!inv) continue;
        const canvas = await renderInvoiceCanvas(inv);
        addCanvasToPdf(pdf, canvas, first);
        first = false;
      }
      pdf.save(`Facturas_Compensacion_${Utils.todayISO()}.pdf`);
      UI.toast('PDF descargado', 'ok');
    }catch(err){
      console.error('exportBatchPDF error:', err);
      UI.toast('No se pudo generar el PDF en lote: ' + (err && err.message ? err.message : 'error desconocido'), 'err');
    }
  }

  // Descarga un ZIP con un PDF individual por cada factura indicada
  async function exportZIP(numbers, zipName){
    if(!numbers.length){ UI.toast('No hay facturas para descargar', 'err'); return; }
    try{
      UI.toast(`Generando ${numbers.length} PDF(s) para el ZIP…`);
      const zip = new JSZip();
      const usedNames = new Set();
      for(const numero of numbers){
        const inv = Invoices.byNumero(numero);
        if(!inv) continue;
        const blob = await buildSinglePdfBlob(inv);
        let name = `${inv.numero}_${safeFileName(inv.clienteNombre)}.pdf`;
        let n = 2;
        while(usedNames.has(name)){ name = `${inv.numero}_${safeFileName(inv.clienteNombre)}_${n}.pdf`; n++; }
        usedNames.add(name);
        zip.file(name, blob);
      }
      const zipBlob = await zip.generateAsync({ type:'blob' });
      Utils.download(zipName || `Facturas_${Utils.todayISO()}.zip`, zipBlob);
      UI.toast(`ZIP descargado con ${numbers.length} factura(s)`, 'ok');
    }catch(err){
      console.error('exportZIP error:', err);
      UI.toast('No se pudo generar el ZIP: ' + (err && err.message ? err.message : 'error desconocido'), 'err');
    }
  }

  function exportGeneralExcel(){
    try{
      const list = Invoices.getFiltered();
      if(!list.length){ UI.toast('No hay facturas para exportar', 'err'); return; }
      const data = list.map(i => ({
        'Número': i.numero,
        'Cliente': i.clienteNombre,
        'RNC': i.clienteRnc,
        'Fecha': Utils.fmtDate(i.fecha),
        'Vencimiento': Utils.fmtDate(i.vencimiento),
        'Concepto': i.concepto,
        'Monto Original': i.tipo === 'UD' ? '' : i.montoOriginal,
        '2%': i.tipo === 'UD' ? '' : i.monto2,
        'Total Facturado': i.total,
        'Estado': i.estado
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws['!cols'] = [{wch:12},{wch:26},{wch:14},{wch:12},{wch:12},{wch:38},{wch:14},{wch:12},{wch:14},{wch:10}];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Facturas');
      XLSX.writeFile(wb, `Reporte_Facturas_${Utils.todayISO()}.xlsx`);
      UI.toast('Excel descargado', 'ok');
    }catch(err){
      console.error('exportGeneralExcel error:', err);
      UI.toast('No se pudo generar el Excel: ' + (err && err.message ? err.message : 'error desconocido'), 'err');
    }
  }

  function exportGeneralPDF(){
    try{
      const list = Invoices.getFiltered();
      if(!list.length){ UI.toast('No hay facturas para exportar', 'err'); return; }
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation:'l', unit:'mm', format:'letter' });
      pdf.setFontSize(14);
      pdf.text('Reporte General de Facturas de Compensación', 14, 14);
      pdf.setFontSize(9);
      pdf.setTextColor(110);
      pdf.text(`Gstar Services S.A. — Generado el ${Utils.fmtDate(Utils.todayISO())}`, 14, 20);

      const rows = list.map(i => [i.numero, i.clienteNombre, Utils.fmtDate(i.fecha), i.tipo==='UD'?'—':Utils.fmtNum(i.montoOriginal), i.tipo==='UD'?'—':Utils.fmtNum(i.monto2), Utils.fmtNum(i.total), i.estado]);
      const totalOriginal = list.reduce((s,i)=>s+(i.montoOriginal||0),0);
      const total2 = list.reduce((s,i)=>s+(i.monto2||0),0);
      const totalGeneral = list.reduce((s,i)=>s+i.total,0);

      pdf.autoTable({
        startY:26,
        head:[['Número','Cliente','Fecha','Monto Original','2%','Total','Estado']],
        body:rows,
        foot:[['','','TOTALES', Utils.fmtNum(totalOriginal), Utils.fmtNum(total2), Utils.fmtNum(totalGeneral), '']],
        styles:{ fontSize:8.5, cellPadding:3 },
        headStyles:{ fillColor:[19,20,28] },
        footStyles:{ fillColor:[237,21,86], textColor:255, fontStyle:'bold' },
        columnStyles:{ 3:{halign:'right'},4:{halign:'right'},5:{halign:'right'} }
      });
      pdf.save(`Reporte_General_${Utils.todayISO()}.pdf`);
      UI.toast('PDF descargado', 'ok');
    }catch(err){
      console.error('exportGeneralPDF error:', err);
      UI.toast('No se pudo generar el PDF: ' + (err && err.message ? err.message : 'error desconocido'), 'err');
    }
  }

  function exportClientesExcel(){
    try{
      const list = Storage.getClients();
      const data = list.map(c => ({
        'Consorcio': c.nombre, 'RNC': c.rnc, 'Teléfono': c.telefono,
        'Correo': c.correo, 'Contacto': c.contacto, 'Dirección': c.direccion
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws['!cols'] = [{wch:28},{wch:14},{wch:16},{wch:24},{wch:20},{wch:30}];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
      XLSX.writeFile(wb, `Clientes_${Utils.todayISO()}.xlsx`);
      UI.toast('Excel descargado', 'ok');
    }catch(err){
      console.error('exportClientesExcel error:', err);
      UI.toast('No se pudo generar el Excel: ' + (err && err.message ? err.message : 'error desconocido'), 'err');
    }
  }

  return { exportSinglePDF, exportBatchPDF, exportZIP, exportZipIndividual: exportZIP, exportGeneralExcel, exportGeneralPDF, exportClientesExcel, renderInvoiceCanvas };
})();
