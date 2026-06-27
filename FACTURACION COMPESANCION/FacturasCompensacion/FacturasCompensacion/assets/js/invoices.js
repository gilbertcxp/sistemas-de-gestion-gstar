/* ============================================================
   Invoices — staging, generación, plantilla de impresión,
   historial, filtros y factura consolidada UD
   ============================================================ */
const Invoices = (() => {

  let staged = [];          // filas del último archivo cargado
  let stagedMeta = { desde:'', hasta:'', sourceLabel:'' };
  let udIncluded = true;    // ¿incluir la factura consolidada UD al generar?
  let filters = {};
  let selectedNumbers = new Set();

  const UD_NAMES_NORMALIZED = UD_CLIENTS.map(Utils.normalize);

  function isUDName(name){
    const n = Utils.normalize(name);
    if(UD_NAMES_NORMALIZED.includes(n)) return true;
    const core = Utils.coreName(name);
    if(core.length < 3) return false;
    return UD_CLIENTS.some(udName => Utils.coreName(udName) === core);
  }

  // ---------------- Carga / staging ----------------
  function setStaged(parsed){
    stagedMeta = { desde: parsed.desde||'', hasta: parsed.hasta||'', sourceLabel: parsed.sourceLabel||'' };
    udIncluded = true;
    const clients = Storage.getClients();
    staged = parsed.rows.map(r => {
      const status = r.balance < 0 ? 'neg' : (r.balance > 0 ? 'pos' : 'zero');
      const isUD = isUDName(r.consorcio);
      const match = (status === 'neg' && !isUD) ? Clients.findMatch(r.consorcio, clients) : null;
      return {
        excelName: r.consorcio,
        balance: r.balance,
        montoOriginal: Math.abs(r.balance),
        status,
        isUD,
        included: status === 'neg' && !isUD,
        clientId: match ? match.id : null,
        clientName: match ? match.nombre : null
      };
    });
    return { staged, stagedMeta };
  }
  function getStaged(){ return staged; }
  function getStagedMeta(){ return stagedMeta; }
  function clearStaged(){ staged = []; stagedMeta = { desde:'', hasta:'', sourceLabel:'' }; udIncluded = true; }

  function setStagedLink(excelName, clientId){
    const row = staged.find(r => r.excelName === excelName);
    if(!row) return;
    const c = Clients.byId(clientId);
    row.clientId = c ? c.id : null;
    row.clientName = c ? c.nombre : null;
  }
  function setStagedIncluded(excelName, included){
    const row = staged.find(r => r.excelName === excelName);
    if(row) row.included = included;
  }
  function setAllIncluded(included){
    staged.forEach(r => { if(r.status === 'neg' && !r.isUD && r.clientId) r.included = included; });
  }
  function setUDIncluded(on){ udIncluded = on; }
  function getUDIncluded(){ return udIncluded; }

  // Resumen del grupo UD detectado en la carga actual (para la vista previa)
  function getUDPreview(){
    const settings = Storage.getSettings();
    const pct = Number(settings.porcentaje)||0;
    const udRows = staged.filter(r => r.isUD && r.balance !== 0);
    const cxc = udRows.filter(r => r.balance < 0);
    const cxp = udRows.filter(r => r.balance > 0);
    const totalCXC = Math.abs(cxc.reduce((s,r)=> s + r.balance*(1+pct/100), 0));
    const totalCXP = cxp.reduce((s,r)=> s + r.balance*(1+pct/100), 0);
    const resultadoNeto = Math.round((totalCXC - totalCXP)*100)/100;
    const resultadoTipo = resultadoNeto > 0 ? 'COBRAR' : resultadoNeto < 0 ? 'PAGAR' : 'CERO';
    return { cxcCount: cxc.length, cxpCount: cxp.length, totalCXC, totalCXP, resultadoNeto, resultadoTipo, montoFinal: Math.abs(resultadoNeto) };
  }

  // ---------------- Concepto ----------------
  function buildConcepto(desde, hasta){
    const periodo = Utils.conceptoPeriodo(desde, hasta);
    if(!periodo) return 'Compensación (ORKAPI)';
    return `Compensación Sem. ${periodo} (ORKAPI)`;
  }
  function buildConceptoUD(desde, hasta){
    const periodo = Utils.conceptoPeriodo(desde, hasta);
    if(!periodo) return 'Compensación';
    return `Compensación Sem. ${periodo}`;
  }

  // ---------------- Generación ----------------
  function buildUDInvoice(settings, fecha, vencimiento){
    const pct = Number(settings.porcentaje)||0;
    const udRows = staged.filter(r => r.isUD && r.balance !== 0);
    if(udRows.length === 0) return null;

    const round2 = n => Math.round(n*100)/100;
    const mk = r => {
      const subtotal = r.balance;
      const comision = round2(subtotal*(pct/100));
      const balanceFinal = round2(subtotal+comision);
      return { nombre: r.excelName, subtotal, comision, balanceFinal };
    };
    const cxc = udRows.filter(r => r.balance < 0).map(mk);
    const cxp = udRows.filter(r => r.balance > 0).map(mk);

    const totalCXC = {
      subtotal: round2(cxc.reduce((s,r)=>s+r.subtotal,0)),
      comision: round2(cxc.reduce((s,r)=>s+r.comision,0)),
      balanceFinal: round2(cxc.reduce((s,r)=>s+r.balanceFinal,0)),
    };
    const totalCXP = {
      subtotal: round2(cxp.reduce((s,r)=>s+r.subtotal,0)),
      comision: round2(cxp.reduce((s,r)=>s+r.comision,0)),
      balanceFinal: round2(cxp.reduce((s,r)=>s+r.balanceFinal,0)),
    };

    // Fórmula: Total Cuentas por Cobrar - Total Cuentas por Pagar = Resultado Neto
    const resultadoNeto = round2(Math.abs(totalCXC.balanceFinal) - totalCXP.balanceFinal);
    const resultadoTipo = resultadoNeto > 0 ? 'COBRAR' : resultadoNeto < 0 ? 'PAGAR' : 'CERO';
    const montoFinal = Math.abs(resultadoNeto);

    const udClient = Clients.all().find(c => Utils.normalize(c.nombre) === 'GRUPO UD' || Utils.normalize(c.nombre) === 'CONSORCIO UD');
    const numero = Storage.nextInvoiceNumber();

    return {
      numero,
      tipo: 'UD',
      clienteId: udClient ? udClient.id : null,
      clienteNombre: 'CONSORCIO UD',
      clienteTelefono: (udClient && udClient.telefono) || '(849) 621-8595',
      clienteDireccion: (udClient && udClient.direccion) || 'Sto Dgo',
      clienteRnc: (udClient && udClient.rnc) || '',
      clienteCorreo: (udClient && udClient.correo) || '',
      clienteContacto: (udClient && udClient.contacto) || '',
      fecha, vencimiento,
      periodoDesde: stagedMeta.desde, periodoHasta: stagedMeta.hasta,
      concepto: buildConceptoUD(stagedMeta.desde, stagedMeta.hasta),
      cxc, cxp, totalCXC, totalCXP,
      resultadoNeto, resultadoTipo, montoFinal,
      montoOriginal: null, monto2: null, total: montoFinal,
      porcentaje: pct,
      vendedor: settings.vendedor,
      entregadoPor: settings.entregadoPor,
      estado: 'Pendiente',
      creadoEn: new Date().toISOString()
    };
  }

  function generateFromStaged(){
    const settings = Storage.getSettings();
    const fecha = Utils.todayISO();
    const vencimiento = Utils.addDays(fecha, settings.diasVencimiento);
    const concepto = buildConcepto(stagedMeta.desde, stagedMeta.hasta);

    const toGenerate = staged.filter(r => r.status === 'neg' && !r.isUD && r.included && r.clientId);
    const created = [];

    toGenerate.forEach(r => {
      const client = Clients.byId(r.clientId);
      const numero = Storage.nextInvoiceNumber();
      const montoOriginal = r.montoOriginal;
      const pct = Number(settings.porcentaje)||0;
      const monto2 = Math.round(montoOriginal * (pct/100) * 100)/100;
      const total = Math.round((montoOriginal + monto2) * 100)/100;
      created.push({
        numero,
        tipo: 'standard',
        clienteId: client.id,
        clienteNombre: client.nombre,
        clienteTelefono: client.telefono || '',
        clienteDireccion: client.direccion || '',
        clienteRnc: client.rnc || '',
        clienteCorreo: client.correo || '',
        clienteContacto: client.contacto || '',
        fecha, vencimiento,
        periodoDesde: stagedMeta.desde, periodoHasta: stagedMeta.hasta,
        concepto,
        montoOriginal, porcentaje: pct, monto2, total,
        vendedor: settings.vendedor,
        entregadoPor: settings.entregadoPor,
        estado: 'Pendiente',
        creadoEn: new Date().toISOString()
      });
    });

    let udInvoice = null;
    if(udIncluded){
      udInvoice = buildUDInvoice(settings, fecha, vencimiento);
      if(udInvoice) created.push(udInvoice);
    }

    if(created.length === 0) return [];
    Storage.addInvoices(created);

    // remove generated rows from staging so no se vuelvan a facturar por accidente
    const generatedNames = new Set(toGenerate.map(r=>r.excelName));
    staged = staged.filter(r => !generatedNames.has(r.excelName) && !(r.isUD && udInvoice));
    if(udInvoice) udIncluded = false; // ya se generó, evita duplicarla si se genera de nuevo

    return created;
  }

  // ---------------- Historial / filtros ----------------
  function setFilters(f){ filters = {...filters, ...f}; }
  function clearFilters(){ filters = {}; }

  function getFiltered(){
    let list = Storage.getInvoices().slice().sort((a,b)=> b.creadoEn.localeCompare(a.creadoEn) || b.numero.localeCompare(a.numero));
    const f = filters;
    if(f.cliente) list = list.filter(i => i.clienteId === f.cliente);
    if(f.numero) list = list.filter(i => Utils.normalize(i.numero).includes(Utils.normalize(f.numero)));
    if(f.fechaDesde) list = list.filter(i => i.fecha >= f.fechaDesde);
    if(f.fechaHasta) list = list.filter(i => i.fecha <= f.fechaHasta);
    if(f.montoMin) list = list.filter(i => i.total >= Number(f.montoMin));
    if(f.montoMax) list = list.filter(i => i.total <= Number(f.montoMax));
    if(f.estado) list = list.filter(i => i.estado === f.estado);
    return list;
  }

  function byNumero(numero){ return Storage.getInvoices().find(i => i.numero === numero); }
  function setEstado(numero, estado){ Storage.updateInvoice(numero, { estado }); }
  function remove(numero){ Storage.deleteInvoice(numero); selectedNumbers.delete(numero); }

  function toggleSelected(numero, on){
    if(on) selectedNumbers.add(numero); else selectedNumbers.delete(numero);
  }
  function clearSelected(){ selectedNumbers.clear(); }
  function getSelected(){ return Array.from(selectedNumbers); }

  // ---------------- Plantilla de factura estándar (réplica exacta) ----------------
  function renderInvoiceHTML(inv){
    if(inv.tipo === 'UD') return renderUDInvoiceHTML(inv);
    const s = Storage.getSettings();
    const emp = s.empresa;
    return `
      <div class="inv-row-top">
        <img class="inv-logo" src="${Assets.LOGO}" alt="Gstar Services / La Primera">
        <div class="inv-proforma">
          <div class="t1">PROFORMA</div>
          <div class="t2">Hora: ${new Date(inv.creadoEn).toLocaleTimeString('es-DO',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true})}</div>
        </div>
      </div>

      <div class="inv-company">
        <b>${Utils.escapeHtml(emp.nombre)}</b><br>
        RNC:${Utils.escapeHtml(emp.rnc)}<br>
        ${Utils.escapeHtml(emp.direccion)}<br>
        TEL.: ${Utils.escapeHtml(emp.telefono)}
      </div>

      <div class="inv-meta">
        <div class="inv-client">
          <div><b>Nombre:</b> <span class="v">${Utils.escapeHtml(inv.clienteNombre)}</span></div>
          <div><b>Teléfono:</b> <span class="v">${Utils.escapeHtml(inv.clienteTelefono)||'—'}</span></div>
          <div><b>Dirección:</b> <span class="v">${Utils.escapeHtml(inv.clienteDireccion)||'—'}</span></div>
        </div>
        <div class="inv-doc">
          <div><b>Número</b> <span class="invno">${Utils.escapeHtml(inv.numero)}</span></div>
          <div><b>DE FECHA:</b> ${Utils.fmtDate(inv.fecha)}</div>
          <div><b>VENDEDOR:</b> ${Utils.escapeHtml(inv.vendedor)}</div>
          <div><b>VENCIMIENTO:</b> ${Utils.fmtDate(inv.vencimiento)}</div>
        </div>
      </div>

      <div class="inv-table">
        <div class="hd"><div>CONCEPTO</div><div>CANTIDAD</div><div>PRECIO</div><div>DESC.</div><div>SUBTOTAL</div></div>
        <div class="it"><div>${Utils.escapeHtml(inv.concepto)}</div><div>1</div><div>${Utils.fmtNum(inv.total)}</div><div>0.00</div><div>${Utils.fmtNum(inv.total)}</div></div>
      </div>

      <div class="inv-stamp-area">
        <img class="inv-stamp" src="${Assets.SELLO}" alt="Sello">
        <img class="inv-watermark" src="${Assets.WATERMARK}" alt="">
      </div>

      <div class="inv-summary">
        <table>
          <tr><td class="k">SUBTOTAL:</td><td class="c">RD$</td><td class="c">${Utils.fmtNum(inv.total)}</td></tr>
          <tr><td class="k">DESCUENTO:</td><td class="c">RD$</td><td class="c">0.00</td></tr>
          <tr><td class="k">I.T.B.I.S:</td><td class="c">RD$</td><td class="c">0.00</td></tr>
          <tr class="total"><td class="k">TOTAL:</td><td class="c">RD$</td><td class="c">${Utils.fmtNum(inv.total)}</td></tr>
        </table>
      </div>

      <div class="inv-foot">
        <div class="inv-sign"><div class="line">&nbsp;</div><div class="lbl">RECIBIDO POR</div></div>
        <div class="inv-sign"><div class="line">${Utils.escapeHtml(inv.entregadoPor)}</div><div class="lbl">ENTREGADO POR</div></div>
      </div>

      <div class="inv-bank">Depositar en cuenta corriente: ${Utils.escapeHtml(emp.cuenta)} a nombre de ${Utils.escapeHtml(emp.nombre)}</div>
    `;
  }

  // ---------------- Plantilla de factura consolidada UD ----------------
  function udRowHTML(r){
    return `<tr><td>${Utils.escapeHtml(r.nombre)}</td><td>${Utils.fmtNum(r.subtotal)}</td><td>${Utils.fmtNum(r.comision)}</td><td>${Utils.fmtNum(r.balanceFinal)}</td><td>${r.subtotal<0?'CXC':'CXP'}</td></tr>`;
  }

  function renderUDInvoiceHTML(inv){
    const s = Storage.getSettings();
    const emp = s.empresa;
    const tagClass = inv.resultadoTipo === 'PAGAR' ? 'pagar' : inv.resultadoTipo === 'COBRAR' ? 'cobrar' : 'cero';
    const tagText = inv.resultadoTipo === 'CERO' ? 'BALANCE EN CERO' : `A ${inv.resultadoTipo}`;

    return `
      <div class="inv-row-top">
        <img class="inv-logo" src="${Assets.LOGO}" alt="Gstar Services / La Primera">
        <div class="inv-proforma">
          <div class="t1">PROFORMA</div>
          <div class="t2">Hora: ${new Date(inv.creadoEn).toLocaleTimeString('es-DO',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true})}</div>
        </div>
      </div>

      <div class="inv-company">
        <b>${Utils.escapeHtml(emp.nombre)}</b><br>
        RNC:${Utils.escapeHtml(emp.rnc)}<br>
        ${Utils.escapeHtml(emp.direccion)}<br>
        TEL.: ${Utils.escapeHtml(emp.telefono)}
      </div>

      <div class="inv-meta">
        <div class="inv-client">
          <div><b>Nombre:</b> <span class="v">${Utils.escapeHtml(inv.clienteNombre)}</span></div>
          <div><b>Teléfono:</b> <span class="v">${Utils.escapeHtml(inv.clienteTelefono)||'—'}</span></div>
          <div><b>Dirección:</b> <span class="v">${Utils.escapeHtml(inv.clienteDireccion)||'—'}</span></div>
        </div>
        <div class="inv-doc">
          <div><b>Número</b> <span class="invno">${Utils.escapeHtml(inv.numero)}</span></div>
          <div><b>DE FECHA:</b> ${Utils.fmtDate(inv.fecha)}</div>
          <div><b>VENDEDOR:</b> ${Utils.escapeHtml(inv.vendedor)}</div>
          <div><b>VENCIMIENTO:</b> ${Utils.fmtDate(inv.vencimiento)}</div>
        </div>
      </div>

      <div class="inv-table">
        <div class="hd"><div>CONCEPTO</div><div>CANTIDAD</div><div>PRECIO</div><div>DESC.</div><div>SUBTOTAL</div></div>
        <div class="it"><div>${Utils.escapeHtml(inv.concepto)}</div><div>1</div><div>${Utils.fmtNum(inv.montoFinal)}</div><div>0.00</div><div>${Utils.fmtNum(inv.montoFinal)}</div></div>
      </div>

      <div class="inv-ud-resultado">
        Resultado: <span class="tag ${tagClass}">${tagText} RD$ ${Utils.fmtNum(inv.montoFinal)}</span>
      </div>

      <div class="inv-ud-section">
        <div class="ud-title">CUENTAS POR COBRAR (CXC)</div>
        <table class="inv-ud-table">
          <thead><tr><th>CONSORCIO</th><th>SUB TOTAL</th><th>2% COMISION</th><th>BALANCE FINAL</th><th>TIPO</th></tr></thead>
          <tbody>
            ${inv.cxc.map(udRowHTML).join('')}
            <tr class="tot"><td>TOTALES</td><td>${Utils.fmtNum(inv.totalCXC.subtotal)}</td><td>${Utils.fmtNum(inv.totalCXC.comision)}</td><td>${Utils.fmtNum(inv.totalCXC.balanceFinal)}</td><td>CXC</td></tr>
          </tbody>
        </table>
      </div>

      <div class="inv-ud-section">
        <div class="ud-title">CUENTAS POR PAGAR (CXP)</div>
        <table class="inv-ud-table">
          <thead><tr><th>CONSORCIO</th><th>SUB TOTAL</th><th>2% COMISION</th><th>BALANCE FINAL</th><th>TIPO</th></tr></thead>
          <tbody>
            ${inv.cxp.map(udRowHTML).join('')}
            <tr class="tot"><td>TOTALES</td><td>${Utils.fmtNum(inv.totalCXP.subtotal)}</td><td>${Utils.fmtNum(inv.totalCXP.comision)}</td><td>${Utils.fmtNum(inv.totalCXP.balanceFinal)}</td><td>CXP</td></tr>
          </tbody>
        </table>
      </div>

      <div class="inv-stamp-area">
        <img class="inv-stamp" src="${Assets.SELLO}" alt="Sello">
        <img class="inv-watermark" src="${Assets.WATERMARK}" alt="">
      </div>

      <div class="inv-summary">
        <table>
          <tr><td class="k">SUBTOTAL:</td><td class="c">RD$</td><td class="c">${Utils.fmtNum(inv.montoFinal)}</td></tr>
          <tr><td class="k">DESCUENTO:</td><td class="c">RD$</td><td class="c">0.00</td></tr>
          <tr><td class="k">I.T.B.I.S:</td><td class="c">RD$</td><td class="c">0.00</td></tr>
          <tr class="total"><td class="k">TOTAL:</td><td class="c">RD$</td><td class="c">${Utils.fmtNum(inv.montoFinal)}</td></tr>
        </table>
      </div>

      <div class="inv-foot">
        <div class="inv-sign"><div class="line">&nbsp;</div><div class="lbl">RECIBIDO POR</div></div>
        <div class="inv-sign"><div class="line">${Utils.escapeHtml(inv.entregadoPor)}</div><div class="lbl">ENTREGADO POR</div></div>
      </div>

      <div class="inv-bank">Depositar en cuenta corriente: ${Utils.escapeHtml(emp.cuenta)} a nombre de ${Utils.escapeHtml(emp.nombre)}</div>
    `;
  }

  return {
    isUDName, setStaged, getStaged, getStagedMeta, clearStaged, setStagedLink, setStagedIncluded, setAllIncluded,
    setUDIncluded, getUDIncluded, getUDPreview,
    buildConcepto, buildConceptoUD, generateFromStaged,
    setFilters, clearFilters, getFiltered, byNumero, setEstado, remove,
    toggleSelected, clearSelected, getSelected,
    renderInvoiceHTML
  };
})();
