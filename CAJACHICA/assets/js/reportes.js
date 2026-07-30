/* ============================================================
   Reportes — Caja Chica: 8 reportes + exportación Excel/PDF/Imprimir
   ============================================================ */
const Reportes = (() => {

  const LIST = [
    { key:'estado',        label:'Estado de Caja Chica',        desc:'Resumen general del fondo', icon:'wallet' },
    { key:'libro',          label:'Libro de Movimientos',        desc:'Detalle cronológico completo', icon:'book' },
    { key:'porResponsable', label:'Movimientos por Responsable', desc:'Agrupado por responsable', icon:'user' },
    { key:'porConcepto',    label:'Movimientos por Concepto',    desc:'Agrupado por concepto', icon:'tag' },
    { key:'reposiciones',   label:'Reposiciones',                desc:'Historial de reposiciones de fondo', icon:'refresh' },
    { key:'porCategoria',   label:'Gastos por Categoría',        desc:'Distribución porcentual de gastos', icon:'pie' },
    { key:'mensual',        label:'Resumen Mensual',             desc:'Totales agrupados por mes', icon:'calendar' },
    { key:'anual',          label:'Resumen Anual',               desc:'Totales agrupados por año', icon:'chart' }
  ];
  const ICONS = {
    wallet:  '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
    book:    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    user:    '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    tag:     '<path d="M20.6 12.5 12.9 4.8a2 2 0 0 0-1.4-.6H5a2 2 0 0 0-2 2v6.5a2 2 0 0 0 .6 1.4l7.7 7.7a2 2 0 0 0 2.8 0l6.5-6.5a2 2 0 0 0 0-2.8Z"/><circle cx="7.5" cy="7.5" r="1"/>',
    refresh: '<path d="M17 2.1l4 4-4 4"/><path d="M3 12.2v-2a4 4 0 0 1 4-4h12.8M7 21.9l-4-4 4-4"/><path d="M21 11.8v2a4 4 0 0 1-4 4H4.2"/>',
    pie:     '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    calendar:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    chart:   '<path d="M4 19V9m6 10V5m6 14v-7"/><path d="M3 19h18"/>'
  };

  let _active = 'estado';
  let _lastTable = { title:'Reporte', headers:[], rows:[] }; // usado por exportExcel/exportPDF/imprimir

  function _movs(){ return Storage.getMovimientos().filter(m => m.estado !== 'Anulado'); }

  function render(){
    document.getElementById('repGrid').innerHTML = LIST.map(r => `
      <div class="rep-card ${r.key===_active?'active':''}" onclick="Reportes.select('${r.key}')">
        <div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICONS[r.icon]}</svg></div>
        <h4>${r.label}</h4><p>${r.desc}</p>
      </div>`).join('');
    _renderActive();
  }
  function select(key){ _active = key; render(); }

  function _renderActive(){
    const meta = LIST.find(r => r.key === _active) || LIST[0];
    document.getElementById('repTitle').textContent = meta.label;
    document.getElementById('repSub').textContent = meta.desc;
    const fn = { estado:_repEstado, libro:_repLibro, porResponsable:_repPorResponsable,
      porConcepto:_repPorConcepto, reposiciones:_repReposiciones, porCategoria:_repPorCategoria,
      mensual:_repMensual, anual:_repAnual }[_active];
    fn();
  }

  function _renderTable(title, headers, rows, totalsRow){
    _lastTable = { title, headers, rows, totalsRow };
    const html = `
      <div class="table-wrap"><table class="t">
        <thead><tr>${headers.map(h=>`<th${h.right?' class="r"':''}>${h.label}</th>`).join('')}</tr></thead>
        <tbody>${rows.length===0 ? `<tr><td colspan="${headers.length}"><div class="t-empty">Sin datos para este reporte.</div></td></tr>` :
          rows.map(r => `<tr>${headers.map(h=>`<td${h.right?' class="r num"':''}>${r[h.key] ?? '—'}</td>`).join('')}</tr>`).join('')}
        </tbody>
        ${totalsRow ? `<tfoot><tr>${headers.map((h,i)=>`<td${h.right?' class="r"':''}><b>${totalsRow[h.key] ?? (i===0?'TOTAL':'')}</b></td>`).join('')}</tr></tfoot>` : ''}
      </table></div>`;
    document.getElementById('repContent').innerHTML = html;
  }

  /* ---- 1. Estado de Caja Chica ---- */
  function _repEstado(){
    const s = Storage.getSettings();
    const balance = App.getBalanceActual();
    const movs = _movs();
    const ingresos = movs.filter(m=>m.tipo==='Ingreso').reduce((a,m)=>a+(Number(m.monto)||0),0);
    const gastos = movs.filter(m=>m.tipo==='Gasto').reduce((a,m)=>a+(Number(m.monto)||0),0);
    const reposiciones = movs.filter(m=>m.tipo==='Reposición').reduce((a,m)=>a+(Number(m.monto)||0),0);
    const rows = [
      { k:'Balance inicial configurado', v:Utils.fmtMoney(s.balanceInicial) },
      { k:'Total Ingresos (histórico)', v:Utils.fmtMoney(ingresos) },
      { k:'Total Gastos (histórico)', v:Utils.fmtMoney(gastos) },
      { k:'Total Reposiciones (histórico)', v:Utils.fmtMoney(reposiciones) },
      { k:'Balance actual disponible', v:Utils.fmtMoney(balance) },
      { k:'Monto mínimo de alerta', v:Utils.fmtMoney(s.montoMinimo) },
      { k:'Responsable principal', v:s.responsablePrincipal || '—' },
      { k:'Cuenta bancaria de reposición', v:s.cuentaBancariaReposicion || '—' },
      { k:'Movimientos registrados', v:String(Storage.getMovimientos().length) }
    ];
    _renderTable('Estado de Caja Chica', [{key:'k',label:'Indicador'},{key:'v',label:'Valor',right:true}], rows);
  }

  /* ---- 2. Libro de Movimientos ---- */
  function _repLibro(){
    const rows = _movs().slice().sort((a,b)=>(a.fecha||'').localeCompare(b.fecha||'')).map(m => ({
      fecha:Utils.fmtDate(m.fecha), numero:m.numero, tipo:m.tipo, concepto:m.concepto||'—',
      responsable:m.responsable||'—', monto:Utils.fmtMoney(m.monto), balance:Utils.fmtMoney(m.balance), estado:m.estado
    }));
    _renderTable('Libro de Movimientos', [
      {key:'fecha',label:'Fecha'},{key:'numero',label:'Número'},{key:'tipo',label:'Tipo'},
      {key:'concepto',label:'Concepto'},{key:'responsable',label:'Responsable'},
      {key:'monto',label:'Monto',right:true},{key:'balance',label:'Balance',right:true},{key:'estado',label:'Estado'}
    ], rows);
  }

  /* ---- 3. Movimientos por Responsable ---- */
  function _repPorResponsable(){
    const map = {};
    _movs().forEach(m => {
      const k = m.responsable || 'Sin responsable';
      if(!map[k]) map[k] = { n:0, ingresos:0, gastos:0 };
      map[k].n++;
      if(m.tipo==='Ingreso'||m.tipo==='Reposición') map[k].ingresos += Number(m.monto)||0;
      if(m.tipo==='Gasto') map[k].gastos += Number(m.monto)||0;
    });
    const rows = Object.entries(map).sort((a,b)=>b[1].gastos-a[1].gastos).map(([k,v]) => ({
      responsable:k, n:v.n, ingresos:Utils.fmtMoney(v.ingresos), gastos:Utils.fmtMoney(v.gastos)
    }));
    _renderTable('Movimientos por Responsable', [
      {key:'responsable',label:'Responsable'},{key:'n',label:'Movimientos',right:true},
      {key:'ingresos',label:'Ingresos / Reposiciones',right:true},{key:'gastos',label:'Gastos',right:true}
    ], rows);
  }

  /* ---- 4. Movimientos por Concepto ---- */
  function _repPorConcepto(){
    const map = {};
    _movs().forEach(m => {
      const k = m.concepto || 'Sin concepto';
      if(!map[k]) map[k] = { n:0, total:0 };
      map[k].n++; map[k].total += Number(m.monto)||0;
    });
    const rows = Object.entries(map).sort((a,b)=>b[1].total-a[1].total).map(([k,v]) => ({
      concepto:k, n:v.n, total:Utils.fmtMoney(v.total)
    }));
    _renderTable('Movimientos por Concepto', [
      {key:'concepto',label:'Concepto'},{key:'n',label:'Movimientos',right:true},{key:'total',label:'Total',right:true}
    ], rows);
  }

  /* ---- 5. Reposiciones ---- */
  function _repReposiciones(){
    const rows = Storage.getReposiciones().slice().sort((a,b)=>(a.fecha||'').localeCompare(b.fecha||'')).map(r => ({
      fecha:Utils.fmtDate(r.fecha), monto:Utils.fmtMoney(r.monto), banco:r.banco||'—', cuenta:r.cuenta||'—', usuario:r.usuario||'—'
    }));
    _renderTable('Reposiciones', [
      {key:'fecha',label:'Fecha'},{key:'monto',label:'Monto',right:true},{key:'banco',label:'Banco'},
      {key:'cuenta',label:'Cuenta Bancaria'},{key:'usuario',label:'Usuario'}
    ], rows);
  }

  /* ---- 6. Gastos por Categoría ---- */
  function _repPorCategoria(){
    const gastos = _movs().filter(m => m.tipo === 'Gasto');
    const total = gastos.reduce((a,m)=>a+(Number(m.monto)||0),0) || 1;
    const map = {};
    gastos.forEach(m => { const k = m.concepto||'Sin concepto'; map[k]=(map[k]||0)+(Number(m.monto)||0); });
    const rows = Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([k,v]) => ({
      concepto:k, total:Utils.fmtMoney(v), pct:(v/total*100).toFixed(1)+'%'
    }));
    _renderTable('Gastos por Categoría', [
      {key:'concepto',label:'Categoría'},{key:'total',label:'Total',right:true},{key:'pct',label:'% del total',right:true}
    ], rows);
  }

  /* ---- 7. Resumen Mensual ---- */
  function _repMensual(){
    const map = {};
    _movs().forEach(m => {
      const k = (m.fecha||'').slice(0,7);
      if(!map[k]) map[k] = { ingresos:0, gastos:0, reposiciones:0 };
      if(m.tipo==='Ingreso') map[k].ingresos += Number(m.monto)||0;
      if(m.tipo==='Gasto') map[k].gastos += Number(m.monto)||0;
      if(m.tipo==='Reposición') map[k].reposiciones += Number(m.monto)||0;
    });
    const rows = Object.keys(map).sort().map(k => ({
      mes:_mesLabel(k), ingresos:Utils.fmtMoney(map[k].ingresos), gastos:Utils.fmtMoney(map[k].gastos),
      reposiciones:Utils.fmtMoney(map[k].reposiciones), neto:Utils.fmtMoney(map[k].ingresos + map[k].reposiciones - map[k].gastos)
    }));
    _renderTable('Resumen Mensual', [
      {key:'mes',label:'Mes'},{key:'ingresos',label:'Ingresos',right:true},{key:'gastos',label:'Gastos',right:true},
      {key:'reposiciones',label:'Reposiciones',right:true},{key:'neto',label:'Neto',right:true}
    ], rows);
  }

  /* ---- 8. Resumen Anual ---- */
  function _repAnual(){
    const map = {};
    _movs().forEach(m => {
      const k = (m.fecha||'').slice(0,4);
      if(!map[k]) map[k] = { ingresos:0, gastos:0, reposiciones:0 };
      if(m.tipo==='Ingreso') map[k].ingresos += Number(m.monto)||0;
      if(m.tipo==='Gasto') map[k].gastos += Number(m.monto)||0;
      if(m.tipo==='Reposición') map[k].reposiciones += Number(m.monto)||0;
    });
    const rows = Object.keys(map).sort().map(k => ({
      anio:k, ingresos:Utils.fmtMoney(map[k].ingresos), gastos:Utils.fmtMoney(map[k].gastos),
      reposiciones:Utils.fmtMoney(map[k].reposiciones), neto:Utils.fmtMoney(map[k].ingresos + map[k].reposiciones - map[k].gastos)
    }));
    _renderTable('Resumen Anual', [
      {key:'anio',label:'Año'},{key:'ingresos',label:'Ingresos',right:true},{key:'gastos',label:'Gastos',right:true},
      {key:'reposiciones',label:'Reposiciones',right:true},{key:'neto',label:'Neto',right:true}
    ], rows);
  }

  function _mesLabel(key){
    if(!key) return 'Sin fecha';
    try{ const [y,m] = key.split('-'); return new Date(y, parseInt(m)-1, 1).toLocaleString('es-DO', { month:'long', year:'numeric' }); }
    catch(e){ return key; }
  }

  /* ---- Exportación ---- */
  function exportExcel(){
    const { title, headers, rows } = _lastTable;
    if(rows.length === 0){ UI.toast('No hay datos para exportar', 'err'); return; }
    const aoa = [headers.map(h=>h.label), ...rows.map(r => headers.map(h=>r[h.key] ?? ''))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map(()=>({wch:20}));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0,31));
    XLSX.writeFile(wb, `CajaChica_${title.replace(/\s+/g,'_')}_${Utils.todayISO()}.xlsx`);
    UI.toast('Excel descargado', 'ok');
  }

  function exportPDF(){
    const { title, headers, rows } = _lastTable;
    if(rows.length === 0){ UI.toast('No hay datos para exportar', 'err'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
    doc.setFontSize(14); doc.text('Gstar Services S.A. — Caja Chica', 14, 15);
    doc.setFontSize(11); doc.text(title, 14, 22);
    doc.setFontSize(9); doc.text(`Generado el ${Utils.fmtDateLong(Utils.todayISO())}`, 14, 28);
    doc.autoTable({
      head:[headers.map(h=>h.label)],
      body: rows.map(r => headers.map(h=>String(r[h.key] ?? ''))),
      startY:33, styles:{ fontSize:8.5 }, headStyles:{ fillColor:[23,104,255] }
    });
    doc.save(`CajaChica_${title.replace(/\s+/g,'_')}_${Utils.todayISO()}.pdf`);
    UI.toast('PDF descargado', 'ok');
  }

  function imprimir(){
    const { title, headers, rows } = _lastTable;
    const w = window.open('', '_blank', 'width=980,height=750');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${Utils.escapeHtml(title)}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}
        h1{font-size:18px;margin-bottom:2px} p{color:#64748b;font-size:12px;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th{background:#1768FF;color:#fff;text-align:left;padding:8px 10px}
        td{padding:7px 10px;border-bottom:1px solid #e2e8f0}
        .r{text-align:right}
      </style></head><body>
      <h1>Gstar Services S.A. — Caja Chica</h1>
      <p>${Utils.escapeHtml(title)} · Generado el ${Utils.fmtDateLong(Utils.todayISO())}</p>
      <table><thead><tr>${headers.map(h=>`<th${h.right?' class="r"':''}>${h.label}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r=>`<tr>${headers.map(h=>`<td${h.right?' class="r"':''}>${r[h.key] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table>
      </body></html>`);
    w.document.close(); w.focus();
    w.onload = () => { w.print(); };
  }

  return { render, select, exportExcel, exportPDF, imprimir };
})();
window.Reportes = Reportes;
