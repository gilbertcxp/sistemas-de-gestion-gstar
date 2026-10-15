/* ============================================================
   Facturas — listado, generación, detalle y anulación.

   Reglas (definidas con el negocio / derivadas de la plantilla):
     - 1 factura POR CONSORCIO y por lote (la plantilla es un cuadro por
       consorcio: Venta Bruta ← Ventas Netas, Premios ← |Pagos|).
     - Numeración correlativa JV-0001, JV-0002… (nunca se reutiliza un
       número, ni el de una factura anulada).
     - Una venta (loteId + filaId) sólo puede tener UNA factura vigente.
       Para corregir: anular la factura (PIN + motivo) → la venta queda
       libre → se genera una nueva con otro número ("refacturación"),
       que guarda a qué factura anulada reemplaza.
     - Cada factura guarda un snapshot del cálculo y de los porcentajes
       usados, y la relación loteId + filaId con la venta original.
   ============================================================ */
const Facturas = (() => {

  const F = { q:'', periodo:'', estado:'', tipo:'', emDesde:'', emHasta:'' };
  let _busy = false;
  let _detId = null;
  let _anularId = null;

  const money = v => Utils.fmtNum(v);
  const user = () => (window.Auth && Auth.getUser && Auth.getUser()) || {};
  const userName = () => { const u = user(); return u.name || u.email || '—'; };
  const periodoKey = f => f.desde + '|' + f.hasta;
  const periodoTxt = f => Utils.fmtDate(f.desde) + ' al ' + Utils.fmtDate(f.hasta);

  // ---------- filtros ----------
  function setFilter(k, v){ F[k] = v; render(); }

  function _filtradas(){
    const q = Utils.normalize(F.q);
    return Storage.getFacturas().filter(f => {
      if(F.estado && f.estado !== F.estado) return false;
      if(F.tipo && (Storage.esGeneral(f) ? 'General' : 'Normal') !== F.tipo) return false;
      if(F.periodo && periodoKey(f) !== F.periodo) return false;
      if(F.emDesde && f.fechaEmision < F.emDesde) return false;
      if(F.emHasta && f.fechaEmision > F.emHasta) return false;
      if(q && Utils.normalize(f.numero + ' ' + f.cliente + ' ' + f.consorcio).indexOf(q) === -1) return false;
      return true;
    }).sort((a, b) => String(b.numero).localeCompare(String(a.numero)));
  }

  function render(){
    const todas = Storage.getFacturas();
    // opciones de período (sin perder la selección)
    const periodos = [...new Set(todas.map(periodoKey))].sort().reverse();
    const sel = document.getElementById('fcPeriodo');
    sel.innerHTML = '<option value="">Todos los períodos</option>' + periodos.map(p => {
      const [d, h] = p.split('|');
      return '<option value="' + p + '"' + (F.periodo === p ? ' selected' : '') + '>' + Utils.fmtDate(d) + ' al ' + Utils.fmtDate(h) + '</option>';
    }).join('');

    const list = _filtradas();
    const body = document.getElementById('fcBody');
    if(!list.length){
      body.innerHTML = '<tr><td colspan="10" class="t-empty" style="text-align:center;padding:34px;color:var(--ink-faint)">'
        + (todas.length ? 'No hay facturas que coincidan con los filtros.' : 'Aún no hay facturas. Importa un archivo en "Cargar" y usa "Generar facturas".') + '</td></tr>';
    }else{
      body.innerHTML = list.map(f => {
        const pill = f.estado === 'Anulada' ? 'red' : 'ok';
        return '<tr class="row-clickable" onclick="Facturas.ver(\'' + Utils.jsAttr(f.id) + '\')">'
          + '<td><b>' + Utils.escapeHtml(f.numero) + '</b>' + (Storage.esGeneral(f) ? ' <span class="pill indigo" style="margin-left:4px">General</span>' : '') + '</td>'
          + '<td>' + Utils.fmtDate(f.fechaEmision) + '</td>'
          + '<td>' + Utils.escapeHtml(f.cliente) + '</td>'
          + '<td>' + periodoTxt(f) + '</td>'
          + '<td class="r">' + money(f.calc.ventaBruta) + '</td>'
          + '<td class="r">' + money(f.calc.totalPagarOperador) + '</td>'
          + '<td class="r">' + money(f.calc.totalPagarGstar) + '</td>'
          + '<td><span class="pill ' + pill + '"><span class="pill-dot"></span>' + f.estado + '</span></td>'
          + '<td>' + Utils.fmtDate(String(f.creadoEn).slice(0, 10)) + '</td>'
          + '<td class="c"><button class="btn btn-ghost btn-sm">Ver</button></td></tr>';
      }).join('');
    }
    document.getElementById('fcCount').textContent = list.length + ' factura(s)';
  }

  // ---------- generación ----------
  let _gen = { loteId:'' };

  function abrirGenerar(){
    const lotes = Storage.getLotesActivos().filter(l => l.filas.some(f => !Storage.getFacturaDeFila(l.id, f.id)) || !Storage.getFacturaGeneralDeLote(l.id));
    if(!lotes.length){ UI.toast('No hay ventas pendientes de facturar. Importa un lote en "Cargar".', 'err'); return; }
    const sel = document.getElementById('genLote');
    sel.innerHTML = lotes.slice().sort((a, b) => b.desde.localeCompare(a.desde)).map(l =>
      '<option value="' + Utils.escapeHtml(l.id) + '">' + Utils.fmtDate(l.desde) + ' al ' + Utils.fmtDate(l.hasta) + ' — ' + Utils.escapeHtml(l.archivo) + '</option>').join('');
    const hoy = Utils.todayISO();
    document.getElementById('genEmision').value = hoy;
    document.getElementById('genVence').value = Utils.addDays(hoy, Storage.getSettings().diasVencimiento);
    document.getElementById('genObs').value = '';
    _gen.loteId = sel.value;
    _renderGen();
    UI.openModal('modalGenerar');
  }

  function onGenLote(id){ _gen.loteId = id; _renderGen(); }
  function onGenEmision(v){
    if(v) document.getElementById('genVence').value = Utils.addDays(v, Storage.getSettings().diasVencimiento);
  }

  function _renderGen(){
    const l = Storage.getLote(_gen.loteId);
    const body = document.getElementById('genBody');
    if(!l){ body.innerHTML = ''; return; }
    _renderGeneralBox(l);
    body.innerHTML = l.filas.map(f => {
      const fac = Storage.getFacturaDeFila(l.id, f.id);
      const c = Calculo.calcular(f.ventasNetas, Math.abs(f.pagos));
      const sinVentas = !(f.ventasNetas > 0);
      const dis = !!fac;
      const nota = fac ? '<span class="pill ok"><span class="pill-dot"></span>Facturada ' + Utils.escapeHtml(fac.numero) + '</span>'
        : (sinVentas ? '<span class="pill warn"><span class="pill-dot"></span>Sin ventas</span>' : '<span class="pill gray"><span class="pill-dot"></span>Pendiente</span>');
      return '<tr><td style="width:34px"><input type="checkbox" class="chk genChk" data-fila="' + Utils.escapeHtml(f.id) + '"' + (dis ? ' disabled' : (sinVentas ? '' : ' checked')) + ' onchange="Facturas.updGenCount()"></td>'
        + '<td>' + Utils.escapeHtml(f.consorcio) + '</td>'
        + '<td><input type="text" class="input genCliente" data-fila="' + Utils.escapeHtml(f.id) + '" value="' + Utils.escapeHtml(f.nombre) + '"' + (dis ? ' disabled' : '') + ' style="min-width:150px"></td>'
        + '<td class="r">' + money(f.ventasNetas) + '</td><td class="r">' + money(Math.abs(f.pagos)) + '</td>'
        + '<td class="r">' + money(c.totalPagarOperador) + '</td><td class="r">' + money(c.totalPagarGstar) + '</td><td>' + nota + '</td></tr>';
    }).join('');
    updGenCount();
  }

  // Totales de la factura GENERAL de un lote: suma de TODOS sus consorcios
  function _baseGeneral(l){
    const sum = k => Utils.round2(l.filas.reduce((s, f) => s + (Number(f[k]) || 0), 0));
    return { ventasNetas: sum('ventasNetas'), pagos: sum('pagos'), cargo: sum('cargo'), totalBruto: sum('totalBruto') };
  }

  function _renderGeneralBox(l){
    const chk = document.getElementById('genGeneralChk');
    const info = document.getElementById('genGeneralInfo');
    const existente = Storage.getFacturaGeneralDeLote(l.id);
    const b = _baseGeneral(l);
    if(existente){
      chk.checked = false; chk.disabled = true;
      info.innerHTML = '<span class="pill ok"><span class="pill-dot"></span>Ya generada: ' + Utils.escapeHtml(existente.numero) + '</span>';
    }else{
      const c = Calculo.calcular(b.ventasNetas, Math.abs(b.pagos));
      chk.disabled = false;
      info.innerHTML = 'Será la ' + Utils.escapeHtml(Storage.proximoNumero('General')) + ' · Venta Bruta ' + money(c.ventaBruta) + ' · Premios ' + money(c.premios)
        + ' · Total Operador ' + money(c.totalPagarOperador) + ' · Total Gstar ' + money(c.totalPagarGstar);
    }
  }

  function updGenCount(){
    const chks = [...document.querySelectorAll('.genChk')].filter(c => !c.disabled);
    const n = chks.filter(c => c.checked).length;
    const gen = document.getElementById('genGeneralChk');
    const nGeneral = gen && gen.checked && !gen.disabled ? 1 : 0;
    document.getElementById('genCount').textContent = n;
    const all = document.getElementById('genChkAll');
    if(all){ all.checked = chks.length > 0 && n === chks.length; all.indeterminate = n > 0 && n < chks.length; }
    document.getElementById('genBtn').disabled = _busy || (n === 0 && nGeneral === 0);
  }
  function toggleGenAll(v){
    document.querySelectorAll('.genChk').forEach(c => { if(!c.disabled) c.checked = v; });
    updGenCount();
  }

  async function generar(){
    if(_busy) return;
    const emision = document.getElementById('genEmision').value;
    const vence = document.getElementById('genVence').value;
    if(!emision){ UI.toast('Indica la fecha de emisión', 'err'); return; }
    if(vence && vence < emision){ UI.toast('La fecha de vencimiento no puede ser anterior a la emisión', 'err'); return; }
    const marcadas = [...document.querySelectorAll('.genChk')].filter(c => c.checked && !c.disabled).map(c => c.dataset.fila);
    const gChk = document.getElementById('genGeneralChk');
    const quiereGeneral = !!(gChk && gChk.checked && !gChk.disabled);
    if(!marcadas.length && !quiereGeneral){ UI.toast('Selecciona al menos un consorcio o la factura general', 'err'); return; }

    _busy = true; updGenCount();
    const previo = Storage.getFacturas();
    try{
      if(window.Sync){ try{ await Sync.pull(); }catch(e){} }      // versión más reciente (otro usuario pudo facturar)
      const l = Storage.getLote(_gen.loteId);
      if(!l || l.estado !== 'Activo'){ UI.toast('El lote ya no está activo', 'err'); return; }
      const clientes = {};
      document.querySelectorAll('.genCliente').forEach(i => { clientes[i.dataset.fila] = i.value.trim(); });
      const obs = document.getElementById('genObs').value.trim();

      const facturas = Storage.getFacturas();
      const nuevas = [];
      const yaFacturadas = [];
      for(const filaId of marcadas){
        const fila = l.filas.find(x => x.id === filaId);
        if(!fila) continue;
        const existente = Storage.getFacturaDeFila(l.id, fila.id);
        if(existente){ yaFacturadas.push(fila.consorcio + ' (' + existente.numero + ')'); continue; }
        if(!(fila.ventasNetas > 0)) { continue; }
        const calc = Calculo.calcular(fila.ventasNetas, Math.abs(fila.pagos));
        const anterior = facturas.filter(f => f.loteId === l.id && f.filaId === fila.id && f.estado === 'Anulada')
          .sort((a, b) => String(b.numero).localeCompare(String(a.numero)))[0];
        // número consecutivo calculado sobre lo ya acumulado en esta misma tanda
        nuevas.push({
          id: Utils.uid('fac'),
          tipo: 'Normal',
          numero: Storage.proximoNumero('Normal', facturas.concat(nuevas)),
          loteId: l.id, filaId: fila.id,
          consorcio: fila.consorcio,
          cliente: clientes[fila.id] || fila.nombre,
          fechaEmision: emision, fechaVence: vence || '',
          desde: l.desde, hasta: l.hasta,
          estado: 'Emitida',
          params: { ...Calculo.PARAMS_DEFAULT },
          base: { ventasNetas: fila.ventasNetas, pagos: fila.pagos, cargo: fila.cargo, totalBruto: fila.totalBruto },
          calc,
          observaciones: obs,
          refacturaDe: anterior ? anterior.numero : null,
          // "Entregado por" de la factura = el usuario que cargó las ventas (lote)
          entregadoPor: l.importadoPor || '',
          creadoPor: userName(), creadoEn: new Date().toISOString(),
          anuladoPor: null, anuladoEn: null, motivoAnulacion: null
        });
      }
      // Factura GENERAL: una sola por lote, suma de todos los consorcios, cliente GENERAL, serie de numeración propia
      if(quiereGeneral){
        const yaGeneral = Storage.getFacturaGeneralDeLote(l.id);
        if(yaGeneral){ yaFacturadas.push('GENERAL (' + yaGeneral.numero + ')'); }
        else{
          const base = _baseGeneral(l);
          if(!(base.ventasNetas > 0)){ UI.toast('El lote no tiene ventas: no se puede generar la factura general', 'err'); return; }
          const anteriorG = facturas.filter(f => Storage.esGeneral(f) && f.loteId === l.id && f.estado === 'Anulada')
            .sort((a, b) => String(b.numero).localeCompare(String(a.numero)))[0];
          nuevas.push({
            id: Utils.uid('fac'),
            tipo: 'General',
            numero: Storage.proximoNumero('General', facturas.concat(nuevas)),
            loteId: l.id, filaId: null,
            consorcio: 'GENERAL',
            cliente: 'GENERAL',
            fechaEmision: emision, fechaVence: vence || '',
            desde: l.desde, hasta: l.hasta,
            estado: 'Emitida',
            params: { ...Calculo.PARAMS_DEFAULT },
            base,
            calc: Calculo.calcular(base.ventasNetas, Math.abs(base.pagos)),
            observaciones: obs,
            refacturaDe: anteriorG ? anteriorG.numero : null,
            entregadoPor: l.importadoPor || '',
            creadoPor: userName(), creadoEn: new Date().toISOString(),
            anuladoPor: null, anuladoEn: null, motivoAnulacion: null
          });
        }
      }
      if(!nuevas.length){
        UI.toast(yaFacturadas.length ? 'Ya estaban facturadas: ' + yaFacturadas.join(', ') : 'No hay facturas por generar', 'err');
        return;
      }

      Storage.saveFacturas(facturas.concat(nuevas));
      const r = window.Sync ? await Sync.pushNow(Storage.KEYS.FACTURAS) : { ok:false, reason:'no-sync' };
      if(!r.ok){
        Storage.saveFacturas(previo);
        if(window.Sync) Sync.push(Storage.KEYS.FACTURAS, previo);
        UI.toast('No se pudo guardar en Supabase (' + r.reason + '). No se generó ninguna factura.', 'err');
        return;
      }
      Storage.addAuditoria({
        usuarioNombre: userName(), accion:'generar_facturas', entidad:'factura', entidadId: nuevas[0].id,
        detalle: { lote: l.archivo, desde: l.desde, hasta: l.hasta, cantidad: nuevas.length, numeros: nuevas.map(n => n.numero) }
      });
      UI.closeModal('modalGenerar');
      UI.toast(nuevas.length + ' factura(s) generada(s): ' + (nuevas.length > 4 ? nuevas[0].numero + ' … ' + nuevas[nuevas.length - 1].numero : nuevas.map(n => n.numero).join(', ')), 'ok');
      render();
      if(window.Cargar) Cargar.renderLotes();
    }catch(err){
      console.error(err);
      Storage.saveFacturas(previo);
      UI.toast('Error al generar: ' + err.message, 'err');
    }finally{
      _busy = false; updGenCount();
    }
  }

  // ---------- detalle ----------
  async function ver(id){
    const f = Storage.getFactura(id);
    if(!f) return;
    _detId = id;
    document.getElementById('facDetTitle').textContent = 'Factura ' + f.numero + (f.estado === 'Anulada' ? ' (ANULADA)' : '');
    document.getElementById('facDetBody').innerHTML = '<p class="sub">Cargando…</p>';
    UI.openModal('modalFacturaDetalle');
    const lote = Storage.getLote(f.loteId);
    const html = await Exportador.renderFacturaHTML(f);
    const general = Storage.esGeneral(f);
    // Factura normal: 1 renglón (su consorcio). Factura GENERAL: todos los consorcios del lote + total.
    const ventas = general && lote
      ? lote.filas.map(x => ({ consorcio: x.consorcio, ventasNetas: x.ventasNetas, pagos: x.pagos, cargo: x.cargo, totalBruto: x.totalBruto }))
      : [{ consorcio: f.consorcio, ventasNetas: f.base.ventasNetas, pagos: f.base.pagos, cargo: f.base.cargo, totalBruto: f.base.totalBruto }];
    const filaV = v => '<tr><td>' + Utils.escapeHtml(v.consorcio) + '</td><td>' + periodoTxt(f) + '</td><td class="r">' + money(v.ventasNetas) + '</td><td class="r">' + money(v.pagos) + '</td><td class="r">' + money(v.cargo) + '</td><td class="r">' + money(v.totalBruto) + '</td></tr>';
    let extra = '<div class="card" style="margin-top:14px"><div class="card-head"><div><h3>' + (general ? 'Ventas que consolida la factura general (' + ventas.length + ' consorcios)' : 'Ventas que componen la factura') + '</h3><p class="sub">'
      + (lote ? 'Lote: ' + Utils.escapeHtml(lote.archivo) + ' · importado por ' + Utils.escapeHtml(lote.importadoPor || '—') + ' el ' + new Date(lote.importadoEn).toLocaleString('es-DO') : 'Lote no disponible') + '</p></div></div>'
      + '<div class="card-body pad-0"><div class="table-wrap"><table class="t"><thead><tr><th>Consorcio (ORKAPI)</th><th>Período</th><th class="r">Ventas Netas</th><th class="r">Pagos</th><th class="r">Cargo</th><th class="r">Total Bruto</th></tr></thead><tbody>'
      + ventas.map(filaV).join('')
      + (general ? '<tr style="font-weight:700"><td>TOTAL</td><td></td><td class="r">' + money(f.base.ventasNetas) + '</td><td class="r">' + money(f.base.pagos) + '</td><td class="r">' + money(f.base.cargo) + '</td><td class="r">' + money(f.base.totalBruto) + '</td></tr>' : '')
      + '</tbody></table></div></div></div>';
    if(f.refacturaDe) extra += '<p class="sub" style="margin-top:10px">Refacturación: reemplaza a la factura anulada ' + Utils.escapeHtml(f.refacturaDe) + '.</p>';
    if(f.estado === 'Anulada') extra += '<div class="cc-alert danger" style="margin-top:10px">Anulada por ' + Utils.escapeHtml(f.anuladoPor || '—') + ' el ' + new Date(f.anuladoEn).toLocaleString('es-DO') + '. Motivo: ' + Utils.escapeHtml(f.motivoAnulacion || '—') + '</div>';
    if(f.observaciones) extra += '<p class="sub" style="margin-top:10px">Observaciones: ' + Utils.escapeHtml(f.observaciones) + '</p>';
    document.getElementById('facDetBody').innerHTML = '<div class="fac-scroll">' + html + '</div>' + extra;
    document.getElementById('facBtnAnular').style.display = f.estado === 'Anulada' ? 'none' : '';
    // El TXT contable (Entrada de diario) se genera desde la factura GENERAL vigente
    document.getElementById('facBtnTxt').style.display = (general && f.estado !== 'Anulada') ? '' : 'none';
  }

  function abrirAsiento(){ const f = Storage.getFactura(_detId); if(f) Asiento.abrir(f); }
  function exportarExcel(){ const f = Storage.getFactura(_detId); if(f) Exportador.exportExcel(f); }
  function exportarPDF(){ const f = Storage.getFactura(_detId); if(f) Exportador.exportPDF(f); }

  // ---------- anulación ----------
  function anular(){
    const f = Storage.getFactura(_detId);
    if(!f || f.estado === 'Anulada') return;
    UI.requirePin(() => {
      _anularId = f.id;
      document.getElementById('anularMotivo').value = '';
      document.getElementById('anularInfo').textContent = 'Se anulará la factura ' + f.numero + ' (' + f.cliente + '). ' + (Storage.esGeneral(f) ? 'Podrás generar otra factura general del lote con un número nuevo. ' : 'La venta quedará libre para volver a facturarse con un número nuevo. ') + 'El número ' + f.numero + ' no se reutiliza.';
      UI.openModal('modalAnularFactura');
    });
  }

  async function confirmarAnular(){
    if(_busy) return;
    const motivo = document.getElementById('anularMotivo').value.trim();
    if(motivo.length < 5){ UI.toast('Indica el motivo de la anulación (mínimo 5 caracteres)', 'err'); return; }
    _busy = true;
    const previo = Storage.getFacturas();
    try{
      if(window.Sync){ try{ await Sync.pull(); }catch(e){} }
      const f = Storage.getFactura(_anularId);
      if(!f || f.estado === 'Anulada'){ UI.toast('La factura ya estaba anulada', 'err'); UI.closeModal('modalAnularFactura'); return; }
      Storage.saveFacturas(Storage.getFacturas().map(x => x.id === f.id
        ? { ...x, estado:'Anulada', anuladoPor: userName(), anuladoEn: new Date().toISOString(), motivoAnulacion: motivo } : x));
      const r = window.Sync ? await Sync.pushNow(Storage.KEYS.FACTURAS) : { ok:false, reason:'no-sync' };
      if(!r.ok){
        Storage.saveFacturas(previo);
        UI.toast('No se pudo guardar en Supabase (' + r.reason + '). La factura no se anuló.', 'err');
        return;
      }
      Storage.addAuditoria({ usuarioNombre: userName(), accion:'anular_factura', entidad:'factura', entidadId: f.id, detalle:{ numero: f.numero, motivo } });
      UI.closeModal('modalAnularFactura');
      UI.closeModal('modalFacturaDetalle');
      UI.toast('Factura ' + f.numero + ' anulada', 'ok');
      render();
      if(window.Cargar) Cargar.renderLotes();
    }catch(err){
      console.error(err);
      Storage.saveFacturas(previo);
      UI.toast('Error al anular: ' + err.message, 'err');
    }finally{ _busy = false; }
  }

  return { render, setFilter, abrirGenerar, onGenLote, onGenEmision, updGenCount, toggleGenAll, generar,
           ver, exportarExcel, exportarPDF, abrirAsiento, anular, confirmarAnular };
})();
window.Facturas = Facturas;
