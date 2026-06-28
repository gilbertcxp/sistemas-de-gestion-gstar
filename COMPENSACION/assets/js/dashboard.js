/* ============================================================
   Dashboard — KPIs ejecutivos, tabla reciente, top clientes
   ============================================================ */
const Dashboard = (() => {

  function compute(){
    const invoices = Storage.getInvoices();
    const totalFacturas = invoices.length;
    const montoOriginal = invoices.reduce((s,i)=>s+i.montoOriginal,0);
    const total2 = invoices.reduce((s,i)=>s+i.monto2,0);
    const montoTotal = invoices.reduce((s,i)=>s+i.total,0);
    const clientesFacturados = new Set(invoices.map(i=>i.clienteId)).size;
    const totalClientes = Storage.getClients().length;
    let ultima = null;
    invoices.forEach(i => { if(!ultima || i.creadoEn > ultima) ultima = i.creadoEn; });
    return { totalFacturas, montoOriginal, total2, montoTotal, clientesFacturados, totalClientes, ultima };
  }

  function renderKPIs(){
    const k = compute();
    document.getElementById('kpiTotalFacturas').textContent = k.totalFacturas;
    document.getElementById('kpiMontoTotal').textContent = Utils.fmtMoney(k.montoTotal);
    document.getElementById('kpiTotal2').textContent = Utils.fmtMoney(k.total2);
    document.getElementById('kpiClientes').textContent = k.clientesFacturados;
    document.getElementById('kpiClientesTotal').textContent = `de ${k.totalClientes} registrados`;
    if(k.ultima){
      const d = new Date(k.ultima);
      document.getElementById('kpiUltimaFecha').textContent = Utils.fmtDate(Utils.toISODate(d));
      document.getElementById('kpiUltimaHora').textContent = d.toLocaleTimeString('es-DO',{hour:'2-digit',minute:'2-digit',hour12:true});
    } else {
      document.getElementById('kpiUltimaFecha').textContent = '—';
      document.getElementById('kpiUltimaHora').textContent = 'Sin actividad';
    }
    document.getElementById('navInvCount').textContent = k.totalFacturas;
  }

  function renderRecientes(){
    const invoices = Storage.getInvoices().slice().sort((a,b)=>b.creadoEn.localeCompare(a.creadoEn) || b.numero.localeCompare(a.numero)).slice(0,8);
    const tbody = document.querySelector('#tblRecientes tbody');
    if(invoices.length === 0){
      tbody.innerHTML = `<tr><td colspan="7"><div class="t-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 3h8l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/></svg>
        <div>Aún no se han generado facturas.<br>Carga un Excel para comenzar.</div>
      </div></td></tr>`;
      return;
    }
    tbody.innerHTML = invoices.map(i => `
      <tr style="cursor:pointer" onclick="App.viewInvoice('${i.numero}')">
        <td><span class="tag-inv">${i.numero}</span></td>
        <td>${Utils.escapeHtml(i.clienteNombre)}</td>
        <td>${Utils.fmtDate(i.fecha)}</td>
        <td class="r num">${Utils.fmtNum(i.montoOriginal)}</td>
        <td class="r num">${Utils.fmtNum(i.monto2)}</td>
        <td class="r num"><b>${Utils.fmtNum(i.total)}</b></td>
        <td>${UI.estadoPill(i.estado)}</td>
      </tr>
    `).join('');
  }

  function renderTopClientes(){
    const invoices = Storage.getInvoices();
    const map = {};
    invoices.forEach(i => {
      map[i.clienteNombre] = (map[i.clienteNombre]||0) + i.total;
    });
    const entries = Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,7);
    const el = document.getElementById('topClientesChart');
    if(entries.length === 0){
      el.innerHTML = `<div class="t-empty">Aún no hay facturas generadas.</div>`;
      return;
    }
    const max = entries[0][1];
    el.innerHTML = `<div class="barchart">` + entries.map(([name,amt]) => `
      <div class="row">
        <div class="lbl" title="${Utils.escapeHtml(name)}">${Utils.escapeHtml(name)}</div>
        <div class="track"><div class="fill" style="width:${Math.max(4,(amt/max*100)).toFixed(1)}%"></div></div>
        <div class="amt">${Utils.fmtMoney(amt)}</div>
      </div>
    `).join('') + `</div>`;
  }

  function renderPulse(){
    const staged = Invoices.getStaged();
    const neg = staged.filter(r=>r.status==='neg').length;
    const pos = staged.filter(r=>r.status==='pos').length;
    const total = neg+pos;
    const pct = total ? (neg/total*100) : 50;
    document.getElementById('balancePulse').style.setProperty('--neg-pct', pct.toFixed(0)+'%');
    document.getElementById('pulseNeg').textContent = neg;
    document.getElementById('pulsePos').textContent = pos;
  }

  function renderAll(){
    renderKPIs();
    renderRecientes();
    renderTopClientes();
    renderPulse();
  }

  return { compute, renderAll, renderKPIs, renderRecientes, renderTopClientes, renderPulse };
})();
