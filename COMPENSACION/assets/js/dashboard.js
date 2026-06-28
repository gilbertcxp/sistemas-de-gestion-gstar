/* ============================================================
   Dashboard — KPIs de CxC / CxP desde módulo Data
   ============================================================ */
const Dashboard = (() => {

  function _rows() { return Storage.getDataRows ? Storage.getDataRows() : []; }

  function renderKPIs(){
    const rows      = _rows();
    const cxc       = rows.filter(r => r.tipo === 'CXC');
    const cxp       = rows.filter(r => r.tipo === 'CXP');
    const totalCXC  = cxc.filter(r => r.estado !== 'Cobrada').reduce((s, r) => s + (r.pendiente || 0), 0);
    const totalCXP  = cxp.filter(r => r.estado !== 'Pagada').reduce((s, r) => s + (r.pendiente || 0), 0);
    const diferencia = totalCXC - totalCXP;
    const difPos    = diferencia >= 0;

    const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
    set('kpiTotalCXC',       Utils.fmtMoney(totalCXC));
    set('kpiTotalCXP',       Utils.fmtMoney(totalCXP));
    set('kpiTotalRegistros', rows.length.toLocaleString());
    set('kpiDiferencia',     Utils.fmtMoney(Math.abs(diferencia)));
    set('kpiDifLabel',       difPos ? 'CxC > CxP · Saldo a favor' : 'CxP > CxC · Saldo en contra');

    const kpiDif = document.getElementById('kpiDiferenciaCard');
    if(kpiDif){
      kpiDif.className = 'kpi ' + (difPos ? 'ok' : 'red');
    }
    // keep invoice badge updated
    const badge = document.getElementById('navInvCount');
    if(badge && Storage.getInvoices) badge.textContent = Storage.getInvoices().length;
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
    renderPulse();
  }

  return { renderAll, renderKPIs, renderPulse };
})();
