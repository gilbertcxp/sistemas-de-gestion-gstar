/* ============================================================
   Exportadores — Excel/PDF del resumen y del historial
   ============================================================ */
const Exportadores = (() => {

  function exportResumenExcel(){
    const consorcios = Storage.getConsorcios();
    const grupos = Storage.getGrupos();
    const socios = Storage.getSocios();
    const puntos = Storage.getPuntos().filter(p => p.activo !== false);
    const legalizaciones = Storage.getLegalizaciones();
    const umbralDias = Storage.getSettings().umbralPorVencerDias || 15;
    const hoy = new Date();
    const indice = Estado.construirIndicePuntoLegalizaciones(legalizaciones);

    if(consorcios.length === 0){ UI.toast('No hay datos para exportar', 'err'); return; }

    const aoaResumen = [['Consorcio','Grupos','Total Puntos','Legalizados','Por Vencer','Vencidos','Pendientes','% Legalizado']];
    consorcios.forEach(c => {
      const gruposDelConsorcio = grupos.filter(g => g.consorcioId === c.id);
      const grupoIds = new Set(gruposDelConsorcio.map(g => g.id));
      const puntosDelConsorcio = puntos.filter(p => grupoIds.has(p.grupoId));
      const counts = { Legalizado:0, 'Por Vencer':0, Vencido:0, Pendiente:0 };
      puntosDelConsorcio.forEach(p => counts[Estado.calcularEstadoPuntoIndexado(p.id, indice, {hoy, umbralDias})]++);
      const pct = puntosDelConsorcio.length ? Math.round((counts.Legalizado/puntosDelConsorcio.length)*1000)/10 : 0;
      aoaResumen.push([c.nombre, gruposDelConsorcio.length, puntosDelConsorcio.length, counts.Legalizado, counts['Por Vencer'], counts.Vencido, counts.Pendiente, pct+'%']);
    });

    const aoaGrupos = [['Consorcio','Socio','Grupo','Total Puntos','Legalizados','Por Vencer','Vencidos','Pendientes','% Legalizado']];
    grupos.forEach(g => {
      const c = consorcios.find(x => x.id === g.consorcioId);
      const s = socios.find(x => x.id === g.socioId);
      const puntosDelGrupo = puntos.filter(p => p.grupoId === g.id);
      const counts = { Legalizado:0, 'Por Vencer':0, Vencido:0, Pendiente:0 };
      puntosDelGrupo.forEach(p => counts[Estado.calcularEstadoPuntoIndexado(p.id, indice, {hoy, umbralDias})]++);
      const pct = puntosDelGrupo.length ? Math.round((counts.Legalizado/puntosDelGrupo.length)*1000)/10 : 0;
      aoaGrupos.push([c?c.nombre:'—', s?s.nombre:'—', g.nombre, puntosDelGrupo.length, counts.Legalizado, counts['Por Vencer'], counts.Vencido, counts.Pendiente, pct+'%']);
    });

    const wb = XLSX.utils.book_new();
    const wsR = XLSX.utils.aoa_to_sheet(aoaResumen); wsR['!cols'] = aoaResumen[0].map(()=>({wch:16}));
    XLSX.utils.book_append_sheet(wb, wsR, 'Resumen por Consorcio');
    const wsG = XLSX.utils.aoa_to_sheet(aoaGrupos); wsG['!cols'] = aoaGrupos[0].map(()=>({wch:18}));
    XLSX.utils.book_append_sheet(wb, wsG, 'Resumen por Grupo');
    XLSX.writeFile(wb, `Legalizacion_Resumen_${Utils.todayISO()}.xlsx`);
    UI.toast('Excel descargado', 'ok');
  }

  function exportHistorialExcel(){
    const legalizaciones = Storage.getLegalizaciones();
    const grupos = Storage.getGrupos();
    const consorcios = Storage.getConsorcios();
    if(legalizaciones.length === 0){ UI.toast('No hay legalizaciones para exportar', 'err'); return; }

    const aoa = [['Fecha Legalización','Grupo','Consorcio','Cantidad Puntos','Vence','Estado','Creado Por','Observaciones']];
    legalizaciones.slice().sort((a,b) => (b.fechaLegalizacion||'').localeCompare(a.fechaLegalizacion||'')).forEach(l => {
      const g = grupos.find(gr => gr.id === l.grupoId);
      const c = g ? consorcios.find(co => co.id === g.consorcioId) : null;
      aoa.push([
        Utils.fmtDate(l.fechaLegalizacion), g?g.nombre:'—', c?c.nombre:'—',
        l.cantidadPuntos||0, Utils.fmtDate(l.fechaVencimiento),
        Estado.calcularEstadoLegalizacion(l), l.creadoPor||'—', l.observaciones||''
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{wch:14},{wch:22},{wch:16},{wch:14},{wch:14},{wch:12},{wch:20},{wch:30}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Historial de Legalizaciones');
    XLSX.writeFile(wb, `Legalizacion_Historial_${Utils.todayISO()}.xlsx`);
    UI.toast('Excel descargado', 'ok');
  }

  function exportResumenPDF(){
    const el = document.getElementById('view-dashboard');
    if(!el){ UI.toast('No hay contenido para exportar', 'err'); return; }
    UI.toast('Generando PDF…', 'ok');
    html2canvas(el, { scale:2, useCORS:true, backgroundColor:'#ffffff', logging:false })
      .then(canvas => {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        const pgW = 210, pgH = 297;
        const imgH = (canvas.height / canvas.width) * pgW;
        let yOff = 0;
        while(yOff < imgH){
          if(yOff > 0) pdf.addPage();
          pdf.addImage(imgData, 'JPEG', 0, -yOff, pgW, imgH);
          yOff += pgH;
        }
        pdf.save(`Legalizacion_Resumen_${Utils.todayISO()}.pdf`);
        UI.toast('PDF descargado', 'ok');
      })
      .catch(() => UI.toast('Error al generar el PDF', 'err'));
  }

  return { exportResumenExcel, exportHistorialExcel, exportResumenPDF };
})();
window.Exportadores = Exportadores;
