/* ============================================================
   Charts — gráficos del Dashboard de Caja Chica (Chart.js)
   Doble clic en cualquier gráfico muestra el detalle de los
   movimientos que componen ese indicador.
   ============================================================ */
const Charts = (() => {

  const PALETTE = ['#1768FF','#ED1556','#3E4095','#15875A','#B7791F','#0F4FCC','#B80F42','#4C1D95','#0EA5E9','#DC2626'];
  let _charts = {};
  let _lastClick = null;

  function _destroyAll(){
    Object.values(_charts).forEach(c => { try{ c.destroy(); }catch(e){} });
    _charts = {};
  }

  function _dblClickGuard(idx, cb){
    const now = Date.now();
    if(_lastClick && _lastClick.idx === idx && (now - _lastClick.t) < 400){
      _lastClick = null;
      cb();
      return;
    }
    _lastClick = { idx, t: now };
  }

  function _showDetalle(title, rows){
    document.getElementById('detTitle').textContent = title;
    if(rows.length === 0){
      document.getElementById('detBody').innerHTML = '<p class="muted">No hay movimientos para este indicador.</p>';
    } else {
      document.getElementById('detBody').innerHTML = `
        <div class="table-wrap"><table class="t">
          <thead><tr><th>Fecha</th><th>Número</th><th>Concepto</th><th>Descripción</th><th>Responsable</th><th class="r">Monto</th></tr></thead>
          <tbody>${rows.map(m => `<tr style="cursor:pointer" onclick="UI.closeModal('modalDetalle');App.verDetalle('${m.id}')">
            <td>${Utils.fmtDate(m.fecha)}</td><td class="mono">${m.numero}</td>
            <td>${Utils.escapeHtml(m.concepto||'—')}</td>
            <td>${Utils.escapeHtml(m.descripcion||'—')}</td>
            <td>${Utils.escapeHtml(m.responsable||'—')}</td>
            <td class="r num">${Utils.fmtMoney(m.monto)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    }
    UI.openModal('modalDetalle');
  }

  function _onLegendDblClick(evt, item, legend, cb){
    _dblClickGuard(item.index, () => cb(legend.chart.data.labels[item.index]));
    const ci = legend.chart;
    ci.toggleDataVisibility(item.index);
    ci.update();
  }

  function _wireCanvasDblClick(canvasId, getChart, onPointFound){
    const canvas = document.getElementById(canvasId);
    if(!canvas || canvas._ccWired) return;
    canvas._ccWired = true;
    canvas.addEventListener('dblclick', evt => {
      const chart = getChart();
      if(!chart) return;
      const points = chart.getElementsAtEventForMode(evt, 'nearest', { intersect:true }, true);
      if(!points.length) return;
      onPointFound(points[0]);
    });
  }

  function renderAll(periodo){
    if(typeof Chart === 'undefined') return; // sin internet: Chart.js no cargó
    _destroyAll();
    const gastos = periodo.filter(m => m.tipo === 'Gasto');
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = dark ? 'rgba(255,255,255,.08)' : 'rgba(15,15,22,.06)';

    /* ---- Gastos por Categoría (concepto) ---- */
    const byConcepto = {};
    gastos.forEach(m => { byConcepto[m.concepto||'Sin concepto'] = (byConcepto[m.concepto||'Sin concepto']||0) + (Number(m.monto)||0); });
    const conceptoEntries = Object.entries(byConcepto).sort((a,b)=>b[1]-a[1]);
    _charts.categoria = new Chart(document.getElementById('chartCategoria'), {
      type:'doughnut',
      data:{ labels: conceptoEntries.map(e=>e[0]), datasets:[{ data: conceptoEntries.map(e=>e[1]), backgroundColor: PALETTE, borderWidth:2, borderColor:'#fff' }] },
      options:{ responsive:true, maintainAspectRatio:false, cutout:'62%',
        plugins:{ legend:{ position:'right', labels:{ boxWidth:10, font:{size:10.5} }, onClick:(e,item,legend)=>_onLegendDblClick(e,item,legend, label => {
          _showDetalle('Gastos — ' + label, gastos.filter(m => (m.concepto||'Sin concepto') === label));
        }) },
        tooltip:{ callbacks:{ label:c => ` ${c.label}: ${Utils.fmtMoney(c.parsed)}` } } } }
    });
    _wireCanvasDblClick('chartCategoria', ()=>_charts.categoria, pt => {
      const label = _charts.categoria.data.labels[pt.index];
      _showDetalle('Gastos — ' + label, gastos.filter(m => (m.concepto||'Sin concepto') === label));
    });

    /* ---- Gastos por Mes ---- */
    const byMes = {};
    gastos.forEach(m => { const k = (m.fecha||'').slice(0,7); byMes[k] = (byMes[k]||0) + (Number(m.monto)||0); });
    const meses = Object.keys(byMes).sort();
    _charts.mes = new Chart(document.getElementById('chartMes'), {
      type:'bar',
      data:{ labels: meses.map(_mesLabel), datasets:[{ label:'Gastos', data: meses.map(k=>byMes[k]), backgroundColor:'#ED1556BB', borderColor:'#ED1556', borderWidth:1.5, borderRadius:5 }] },
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>` ${Utils.fmtMoney(c.parsed.y)}`}} },
        scales:{ y:{ beginAtZero:true, grid:{color:gridColor} }, x:{ grid:{display:false} } } }
    });
    _wireCanvasDblClick('chartMes', ()=>_charts.mes, pt => {
      const k = meses[pt.index];
      _showDetalle('Gastos — ' + _mesLabel(k), gastos.filter(m => (m.fecha||'').slice(0,7) === k));
    });

    /* ---- Comparativo Ingresos vs Gastos ---- */
    const ingresos = periodo.filter(m => m.tipo === 'Ingreso');
    const byMesIng = {}, byMesGas = {};
    ingresos.forEach(m => { const k=(m.fecha||'').slice(0,7); byMesIng[k]=(byMesIng[k]||0)+(Number(m.monto)||0); });
    gastos.forEach(m => { const k=(m.fecha||'').slice(0,7); byMesGas[k]=(byMesGas[k]||0)+(Number(m.monto)||0); });
    const mesesComp = [...new Set([...Object.keys(byMesIng), ...Object.keys(byMesGas)])].sort();
    _charts.comparativo = new Chart(document.getElementById('chartComparativo'), {
      type:'bar',
      data:{ labels: mesesComp.map(_mesLabel), datasets:[
        { label:'Ingresos', data: mesesComp.map(k=>byMesIng[k]||0), backgroundColor:'#15875ABB', borderColor:'#15875A', borderWidth:1.5, borderRadius:4 },
        { label:'Gastos', data: mesesComp.map(k=>byMesGas[k]||0), backgroundColor:'#ED1556BB', borderColor:'#ED1556', borderWidth:1.5, borderRadius:4 }
      ]},
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{position:'top',labels:{boxWidth:10,font:{size:10.5}}}, tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ${Utils.fmtMoney(c.parsed.y)}`}} },
        scales:{ y:{ beginAtZero:true, grid:{color:gridColor} }, x:{ grid:{display:false} } } }
    });
    _wireCanvasDblClick('chartComparativo', ()=>_charts.comparativo, pt => {
      const k = mesesComp[pt.index];
      const tipo = pt.datasetIndex === 0 ? 'Ingreso' : 'Gasto';
      _showDetalle(`${tipo}s — ${_mesLabel(k)}`, periodo.filter(m => m.tipo===tipo && (m.fecha||'').slice(0,7)===k));
    });

    /* ---- Balance Histórico ---- */
    const historicos = Storage.getMovimientos().slice()
      .filter(m => App.ESTADOS_QUE_CUENTAN.indexOf(m.estado) !== -1)
      .sort((a,b) => (a.fecha||'').localeCompare(b.fecha||'') || (a.creadoEn||'').localeCompare(b.creadoEn||''));
    _charts.balance = new Chart(document.getElementById('chartBalance'), {
      type:'line',
      data:{ labels: historicos.map(m=>Utils.fmtDate(m.fecha)), datasets:[{ label:'Balance', data: historicos.map(m=>m.balance),
        borderColor:'#1768FF', backgroundColor:'rgba(23,104,255,.12)', fill:true, tension:.35, pointRadius:2.5, pointBackgroundColor:'#1768FF', borderWidth:2 }] },
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>` ${Utils.fmtMoney(c.parsed.y)}`}} },
        scales:{ y:{ beginAtZero:false, grid:{color:gridColor} }, x:{ grid:{display:false}, ticks:{ maxTicksLimit:8 } } } }
    });
    _wireCanvasDblClick('chartBalance', ()=>_charts.balance, pt => {
      const mov = historicos[pt.index];
      if(mov) App.verDetalle(mov.id);
    });

    /* ---- Distribución de Gastos por Responsable ---- */
    const byResp = {};
    gastos.forEach(m => { const k = m.responsable || 'Sin responsable'; byResp[k] = (byResp[k]||0) + (Number(m.monto)||0); });
    const respEntries = Object.entries(byResp).sort((a,b)=>b[1]-a[1]);
    _charts.responsable = new Chart(document.getElementById('chartResponsable'), {
      type:'doughnut',
      data:{ labels: respEntries.map(e=>e[0]), datasets:[{ data: respEntries.map(e=>e[1]), backgroundColor: PALETTE, borderWidth:2, borderColor:'#fff' }] },
      options:{ responsive:true, maintainAspectRatio:false, cutout:'55%',
        plugins:{ legend:{ position:'right', labels:{ boxWidth:10, font:{size:10.5} }, onClick:(e,item,legend)=>_onLegendDblClick(e,item,legend, label => {
          _showDetalle('Gastos de ' + label, gastos.filter(m => (m.responsable||'Sin responsable') === label));
        }) },
        tooltip:{ callbacks:{ label:c => ` ${c.label}: ${Utils.fmtMoney(c.parsed)}` } } } }
    });
    _wireCanvasDblClick('chartResponsable', ()=>_charts.responsable, pt => {
      const label = _charts.responsable.data.labels[pt.index];
      _showDetalle('Gastos de ' + label, gastos.filter(m => (m.responsable||'Sin responsable') === label));
    });
  }

  function _mesLabel(key){
    if(!key) return 'Sin fecha';
    try{ const [y,m] = key.split('-'); return new Date(y, parseInt(m)-1, 1).toLocaleString('es-DO', { month:'short', year:'2-digit' }); }
    catch(e){ return key; }
  }

  return { renderAll };
})();
window.Charts = Charts;
