/* ============================================================
   SolicitudPago — genera el documento de solicitud de pago
   para un corte seleccionado
   ============================================================ */
const SolicitudPago = (() => {

  let _corteSelected = '';
  let _rows = [];
  let _solicitudNumero = null;   // número de la solicitud persistida para el corte actual

  // "Unir cortes": varios cortes pendientes de pago en UNA sola hoja / solicitud.
  // Mientras haya unión (2+ cortes) _corteSelected guarda la etiqueta combinada
  // ("corte A + corte B") y _rows reúne los CXP pendientes de todos ellos.
  let _cortesUnidos = [];
  const _UNIDOS = '__unidos__';
  const _SEP = ' + ';
  const _esUnion = () => _cortesUnidos.length > 1;
  function _rowsDeSeleccion(){
    if(_esUnion()) return _cortesUnidos.reduce((acc, c) => acc.concat(DataModule.getCXPByCorte(c)), []);
    return _corteSelected ? DataModule.getCXPByCorte(_corteSelected) : [];
  }

  // Indicadores financieros: siempre auto-calculados desde Disponibilidad Bancaria
  // y Saldo a Favor de Compensación, nunca digitados a mano (ver _fetchIndicadores).
  let _indicadores = { balanceComp:0, transferencia:0, balanceOp:0 };

  // ------ helpers ------
  function _round2(n){ return Math.round((Number(n)||0)*100)/100; }
  function _findSolicitudForCorte(corte){
    const list = Storage.getSolicitudes().filter(s => s.corte === corte);
    return list.length ? list[list.length - 1] : null;
  }

  // ------ Indicadores automáticos (Disponibilidad Bancaria + Saldo a Favor) ------
  async function _fetchIndicadores(){
    let balanceComp = 0, transferencia = 0, balanceOp = 0;
    try{
      if(window.Sync){
        const [bi, mov, transf] = await Promise.all([
          Sync.pullBalanceInicial ? Sync.pullBalanceInicial() : null,
          Sync.pullMovimientosCuenta ? Sync.pullMovimientosCuenta('compensacion') : null,
          Sync.pullTransferData ? Sync.pullTransferData() : null
        ]);
        // Balance en Cuenta de Compensación = Disponibilidad Bancaria → Resumen Ejecutivo
        // → Balance de la Cuenta de Compensación (último balanceRunning importado, o el
        // Balance Inicial si todavía no se ha cargado ningún movimiento).
        const movRows = (mov && mov.rows) || [];
        balanceComp = movRows.length
          ? (movRows[movRows.length-1].balanceRunning || 0)
          : ((bi && bi.compensacion && bi.compensacion.balance) || 0);

        // Transferencias entre Cuentas = neto de transferencias PENDIENTES (no Aplicadas)
        // que involucran la cuenta de Compensación. Positivo = monto pendiente de salir.
        const transferencias = transf || [];
        const transferSigned = transferencias
          .filter(t => (t.estado||'Pendiente') === 'Pendiente' && (t.tipo||'Compensación')==='Compensación')
          .reduce((s,t) => {
            const monto = Number(t.monto)||0;
            if(t.destino==='compensacion') return s + monto;
            if(t.origen==='compensacion')  return s - monto;
            return s;
          }, 0);
        transferencia = -transferSigned;
      }
      if(window.SaldoFavor && SaldoFavor.getUltimoSaldo){
        balanceOp = await SaldoFavor.getUltimoSaldo();
      }
    }catch(e){ console.warn('SolicitudPago._fetchIndicadores', e); }
    _indicadores = { balanceComp, transferencia, balanceOp };
  }

  function _calcTotals(){
    const { balanceComp, transferencia, balanceOp } = _indicadores;
    const balanceCompAct = balanceComp - transferencia;
    const totalPagar     = _rows.reduce((s,r) => s + Math.abs(r.pendiente), 0);
    const balanceDispOP  = balanceOp - totalPagar;
    return { balanceComp, transferencia, balanceOp, balanceCompAct, totalPagar, balanceDispOP };
  }

  // ------ Populate corte selector ------
  function _populateCortes(){
    const cortes = DataModule.getCortes();
    const sel = document.getElementById('spCorteSelect');
    if(!sel) return;
    sel.innerHTML = `<option value="">-- Seleccionar corte --</option>` +
      (_esUnion() ? `<option value="${_UNIDOS}" selected>Cortes unidos (${_cortesUnidos.length})</option>` : '') +
      cortes.map(c => `<option value="${Utils.escapeHtml(c)}"${(!_esUnion() && c===_corteSelected)?' selected':''}>${Utils.escapeHtml(c)}</option>`).join('');
  }

  // ------ Build document HTML ------
  function _buildDocHTML(){
    const { balanceComp, transferencia, balanceOp, balanceCompAct, totalPagar, balanceDispOP } = _calcTotals();
    const cfg  = Storage.getSettings();
    const fecha = new Date().toLocaleDateString('es-DO', { day:'2-digit', month:'long', year:'numeric' });

    const balRow = (label, val, extra='') =>
      `<div class="doc-bal-row${extra}">
         <span class="doc-bal-label">${Utils.escapeHtml(label)}</span>
         <span class="doc-bal-val${val<0?' neg':''}">${val<0 ? '('+Utils.fmtMoney(-val)+')' : Utils.fmtMoney(val)}</span>
       </div>`;

    // Con cortes unidos, cada consorcio sale UNA sola vez con la suma de lo pendiente en
    // todos los cortes (los ítems guardados siguen siendo uno por factura de Data).
    const _filasUnidas = () => {
      const mapa = new Map();
      _rows.forEach(r => {
        const g = mapa.get(r.consorcio) || { consorcio: r.consorcio, cortes: [], total: 0 };
        if(g.cortes.indexOf(r.corte) === -1) g.cortes.push(r.corte);
        g.total += Math.abs(r.pendiente);
        mapa.set(r.consorcio, g);
      });
      return [...mapa.values()].sort((a,b) => String(a.consorcio).localeCompare(String(b.consorcio), 'es'))
        .map(g => `<tr>
            <td>${Utils.escapeHtml(g.consorcio)}</td>
            <td>${Utils.escapeHtml(g.cortes.join(_SEP))}</td>
            <td class="r">${Utils.fmtMoney(g.total)}</td>
          </tr>`).join('');
    };
    const tableRows = _rows.length === 0
      ? `<tr><td colspan="3"><div class="t-empty">${_corteSelected ? 'No hay CXP pendientes en este corte.' : 'Selecciona un corte.'}</div></td></tr>`
      : (_esUnion() ? _filasUnidas() : _rows.map(r => `<tr>
            <td>${Utils.escapeHtml(r.consorcio)}</td>
            <td>${Utils.escapeHtml(r.corte)}</td>
            <td class="r">${Utils.fmtMoney(Math.abs(r.pendiente))}</td>
          </tr>`).join(''));

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
          <h2 class="doc-title">Solicitud de Pago</h2>
          <p class="doc-subtitle">Compensación de Consorcios</p>
        </div>

        <div class="doc-corte-tag">
          ${_solicitudNumero ? `<b>Solicitud No.</b> ${_solicitudNumero} &nbsp;·&nbsp; ` : ''}${_corteSelected ? `<b>${_esUnion() ? 'Cortes unidos:' : 'Corte:'}</b> ${Utils.escapeHtml(_corteSelected)}` : '<i style="opacity:.6">Selecciona un corte</i>'}
        </div>

        <div class="doc-balance-grid">
          ${balRow('Balance en Cuenta Bancaria COMP', balanceComp)}
          ${balRow('Transferencia entre Cuentas', -transferencia)}
          ${balRow('Balance COMP Actualizado', balanceCompAct, ' doc-bal-total')}
          ${balRow('Saldo a Favor en Cuenta Operativa', balanceOp)}
          ${balRow('Saldo a Pagar por Concepto de Corte', totalPagar)}
          ${balRow('Balance Disponible Después de Pago CTA OP', balanceDispOP, ' doc-bal-total')}
          <div class="doc-bal-row doc-bal-highlight">
            <span class="doc-bal-label">BALANCE DISPONIBLE COMPENSACIÓN</span>
            <span class="doc-bal-val">${Utils.fmtMoney(balanceCompAct)}</span>
          </div>
        </div>

        <div class="doc-tipo-tag">TIPO: CXP</div>

        <table class="doc-table">
          <thead>
            <tr><th>CONSORCIO</th><th>${_esUnion() ? 'CORTES' : 'CORTE'}</th><th class="r">PENDIENTE</th></tr>
          </thead>
          <tbody>${tableRows}</tbody>
          ${_rows.length > 0 ? `<tfoot>
            <tr>
              <td colspan="2"><b>TOTAL A PAGAR</b></td>
              <td class="r"><b>${Utils.fmtMoney(totalPagar)}</b></td>
            </tr>
          </tfoot>` : ''}
        </table>

        <div class="doc-signatures">
          <div class="doc-sig"><div class="doc-sig-line"></div><div class="doc-sig-label">Preparado por</div></div>
          <div class="doc-sig"><div class="doc-sig-line"></div><div class="doc-sig-label">Autorizado por</div></div>
          <div class="doc-sig"><div class="doc-sig-line"></div><div class="doc-sig-label">Autorizado por</div></div>
        </div>
      </div>`;
  }

  // ------ Public: render view ------
  async function render(){
    DataModule.load();
    if(_corteSelected){
      _rows = _rowsDeSeleccion();
      const found = _findSolicitudForCorte(_corteSelected);
      _solicitudNumero = found ? found.numero : null;
    }
    _populateCortes();
    const set = (id, v) => { const el = document.getElementById(id); if(el) el.value = v; };
    set('spBalanceComp', 'Cargando…'); set('spTransferencia', 'Cargando…'); set('spBalanceOp', 'Cargando…');
    await _fetchIndicadores();
    set('spBalanceComp',   Utils.fmtMoney(_indicadores.balanceComp));
    set('spTransferencia', Utils.fmtMoney(_indicadores.transferencia));
    set('spBalanceOp',     Utils.fmtMoney(_indicadores.balanceOp));
    updatePreview();
  }

  function onCorteChange(val){
    if(val === _UNIDOS){ updatePreview(); return; }     // se queda la unión actual
    const veniaDeUnion = _esUnion();
    _cortesUnidos = [];                                  // elegir un corte suelto deshace la unión
    _corteSelected = val;
    _rows = _rowsDeSeleccion();
    if(veniaDeUnion) _populateCortes();                  // quita la opción "Cortes unidos" del selector
    const found = val ? _findSolicitudForCorte(val) : null;
    _solicitudNumero = found ? found.numero : null;
    updatePreview();
  }

  // ------ Generar / guardar la solicitud con numeración consecutiva ------
  function generarSolicitud(){
    if(!_corteSelected){ UI.toast('Selecciona un corte primero', 'err'); return; }
    const rows = _rowsDeSeleccion();
    if(rows.length === 0){ UI.toast('No hay CXP pendientes en este corte', 'err'); return; }
    const existing = _findSolicitudForCorte(_corteSelected);
    const doIt = () => {
      const numero = Storage.nextSolicitudNumber();
      Storage.addSolicitud({
        numero,
        corte: _corteSelected,
        fecha: Utils.todayISO(),
        creadoEn: new Date().toISOString(),
        estado: 'Pendiente',
        items: rows.map(r => ({ dataRowId:r.id, consorcio:r.consorcio, corte:r.corte, monto:_round2(Math.abs(r.pendiente)), pagado:false }))
      });
      _solicitudNumero = numero;
      updatePreview();
      UI.toast('Solicitud ' + numero + ' generada y guardada', 'ok');
    };
    if(existing){
      UI.confirm('Ya existe una solicitud', `Este corte ya tiene la Solicitud ${existing.numero}. ¿Deseas generar una nueva?`, doIt);
    } else if(_esUnion()){
      // Aviso (no bloquea): solicitudes PENDIENTES anteriores que ya incluyen facturas de estos mismos cortes
      const ids = new Set(rows.map(r => r.id));
      const solapadas = Storage.getSolicitudes().filter(s => (s.estado || 'Pendiente') === 'Pendiente' && (s.items || []).some(i => ids.has(i.dataRowId)));
      if(solapadas.length){
        UI.confirm('Ya hay solicitudes pendientes con estos cortes',
          `La(s) Solicitud(es) No. ${solapadas.map(s => s.numero).join(', ')} ya incluye(n) facturas de estos cortes. Si generas la unión, esas facturas quedarán en dos solicitudes pendientes (elimina las anteriores si ya no las necesitas). ¿Continuar?`, doIt);
      } else { doIt(); }
    } else { doIt(); }
  }

  // ------ Firmas siempre en la primera hoja ------
  // Cuando hay muchos consorcios por pagar y el documento no cabe en una sola hoja, el
  // bloque de firmas se sube justo debajo de los balances (antes de la tabla), para que
  // SIEMPRE quede en la primera hoja. Si todo cabe en una hoja, las firmas quedan al final.
  const _RATIO_A4 = 297 / 210;
  const _ANCHO_A4_PX = 794;                       // 210 mm a 96 dpi

  function _subirFirmas(root){
    const sig  = root && root.querySelector('.doc-signatures');
    const grid = root && root.querySelector('.doc-balance-grid');
    if(!sig || !grid) return false;
    grid.insertAdjacentElement('afterend', sig);
    sig.style.margin = '22px 0';
    sig.classList.add('doc-signatures-top');
    return true;
  }
  // Sube las firmas solo si lo medido (medido) pasa del límite de una hoja
  function _acomodarFirmas(root, medido, limitePx){
    if(!medido || !(limitePx > 0)) return false;
    if(medido.getBoundingClientRect().height <= limitePx) return false;      // cabe en una hoja
    return _subirFirmas(root);
  }
  // ¿El documento completo pasa de una hoja A4? Se mide en un contenedor aparte de ancho A4 fijo
  // (así la decisión no depende del ancho de la ventana del usuario).
  function _esLargoA4(){
    const host = document.createElement('div');
    host.className = 'doc-preview';
    host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;width:' + _ANCHO_A4_PX + 'px;';
    host.innerHTML = _buildDocHTML();
    document.body.appendChild(host);
    const h = host.getBoundingClientRect().height;
    host.remove();
    return h > _ANCHO_A4_PX * _RATIO_A4 * 0.97;
  }

  function updatePreview(){
    const el = document.getElementById('spDocument');
    if(!el) return;
    el.innerHTML = _buildDocHTML();
    if(_esLargoA4()) _subirFirmas(el);          // varias hojas: las firmas van en la primera
  }

  // ------ Print ------
  function printDoc(){
    updatePreview();
    // Documento original (firmas al final): aquí se decide con el ancho/alto reales de la hoja impresa
    const content = _buildDocHTML();
    const w = window.open('', '_blank', 'width=900,height=700');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Solicitud de Pago</title>
      <style>${_printCSS()}</style></head><body>${content}</body></html>`);
    w.document.close(); w.focus();
    w.onload = () => {
      try{
        // Área imprimible de una hoja A4 con márgenes de 18mm/20mm (ver @page en _printCSS)
        const d = w.document, page = d.querySelector('.doc-page');
        const probe = d.createElement('div');
        probe.style.cssText = 'position:absolute;visibility:hidden;width:170mm;height:261mm;';
        d.body.appendChild(probe);
        const r = probe.getBoundingClientRect();
        probe.remove();
        if(page){
          page.style.width = r.width + 'px';                       // mismo ancho que la hoja impresa
          _acomodarFirmas(d.body, page, r.height * 0.97);
          page.style.width = '';
        }
      }catch(e){ console.warn('SolicitudPago: no se pudo acomodar las firmas', e); }
      w.print(); w.onafterprint = () => w.close();
    };
  }

  // ------ PDF export — captura el preview HTML tal como se ve ------
  function exportPDF(){
    updatePreview();
    const el = document.getElementById('spDocument');
    if(!el){ UI.toast('No hay documento para exportar', 'err'); return; }
    UI.toast('Generando PDF…', 'ok');
    // El PDF se arma con la imagen de la vista: si esa imagen pasaría de una hoja, las firmas suben a la primera
    _acomodarFirmas(el, el, el.getBoundingClientRect().width * _RATIO_A4 * 0.97);
    html2canvas(el, { scale:2, useCORS:true, backgroundColor:'#ffffff', logging:false })
      .then(canvas => {
        updatePreview();                         // restaura la vista (según la regla estándar)
        const { jsPDF } = window.jspdf;
        const pdf    = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
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
        pdf.save(`Solicitud_Pago_${(_esUnion() ? 'Cortes_unidos_' + Utils.todayISO() : (_corteSelected||Utils.todayISO())).replace(/[\s\/]/g,'_')}.pdf`);
        UI.toast('PDF descargado correctamente', 'ok');
      })
      .catch(() => { updatePreview(); UI.toast('Error al generar el PDF', 'err'); });
  }

  // ------ Print CSS ------
  function _printCSS(){ return `
    *{box-sizing:border-box;margin:0;padding:0}
    @page{size:A4;margin:18mm 20mm}
    body{font-family:Arial,sans-serif;padding:0;color:#334155}
    .doc-page{max-width:100%}
    .doc-header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:2px solid #e2e8f0;margin-bottom:18px}
    .doc-logo{height:130px}
    .doc-header-right{text-align:right}
    .doc-empresa{font-size:15px;font-weight:700;color:#0f172a}
    .doc-sub,.doc-fecha{font-size:11px;color:#64748b}
    .doc-title-block{border-left:4px solid #2563eb;padding-left:12px;margin-bottom:16px}
    .doc-title{font-size:20px;font-weight:800;color:#0f172a}
    .doc-subtitle{font-size:12px;color:#64748b;margin-top:2px}
    .doc-corte-tag{background:#eff6ff;color:#1d4ed8;padding:5px 12px;border-radius:5px;font-size:12px;font-weight:600;display:inline-block;margin-bottom:16px}
    .doc-balance-grid{border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;margin-bottom:16px}
    .doc-bal-row{display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:12px}
    .doc-bal-row:last-child{border-bottom:none}
    .doc-bal-label{flex:1}
    .doc-bal-val{font-weight:600;text-align:right;min-width:130px}
    .doc-bal-val.neg{color:#dc2626}
    .doc-bal-total{background:#f8fafc;font-weight:700}
    .doc-bal-total .doc-bal-label,.doc-bal-total .doc-bal-val{font-weight:700}
    .doc-bal-highlight{background:#eff6ff}
    .doc-bal-highlight .doc-bal-label,.doc-bal-highlight .doc-bal-val{font-weight:800;color:#1d4ed8}
    .doc-tipo-tag{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:6px}
    .doc-table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:22px}
    .doc-table th{background:#2563eb;color:#fff;padding:7px 11px;text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.3px}
    .doc-table th.r,.doc-table td.r{text-align:right}
    .doc-table td{padding:7px 11px;border-bottom:1px solid #e2e8f0}
    .doc-table tfoot td{background:#f1f5f9;font-weight:700;border-top:2px solid #cbd5e1}
    .doc-signatures{display:flex;gap:50px;margin-top:36px;page-break-inside:avoid;break-inside:avoid}
    .doc-sig{flex:1}
    .doc-sig-line{border-bottom:1.5px solid #94a3b8;height:34px;margin-bottom:6px}
    .doc-sig-label{font-size:10px;color:#64748b;text-align:center}
    .t-empty{text-align:center;padding:20px;color:#94a3b8;font-size:12px}
  `; }

  // ------ Unir cortes (modal) ------
  // Los cortes se etiquetan "dd/mm/aaaa – dd/mm/aaaa": para unirlos se ordenan por su fecha de inicio
  function _inicioCorte(c){
    const m = String(c).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? m[3] + m[2].padStart(2,'0') + m[1].padStart(2,'0') : String(c);
  }
  const _porFecha = (a, b) => _inicioCorte(a).localeCompare(_inicioCorte(b));
  function _datosCorte(corte, solPend){
    const rows = DataModule.getCXPByCorte(corte);
    return {
      corte,
      consorcios: new Set(rows.map(r => r.consorcio)).size,
      total: rows.reduce((s, r) => s + Math.abs(r.pendiente), 0),
      solicitudes: solPend.filter(s => (s.items || []).some(i => i.corte === corte)).map(s => s.numero)
    };
  }

  function abrirUnirCortes(){
    DataModule.load();
    const cortes = DataModule.getCortes().slice().sort(_porFecha);
    if(cortes.length < 2){ UI.toast('Solo hay un corte pendiente de pago: no hay cortes que unir', 'err'); return; }
    const solPend = Storage.getSolicitudes().filter(s => (s.estado || 'Pendiente') === 'Pendiente');
    const previos = _esUnion() ? new Set(_cortesUnidos) : null;
    const box = document.getElementById('unirCortesList');
    if(!box) return;
    box.innerHTML = cortes.map((c, i) => {
      const d = _datosCorte(c, solPend);
      const marcado = previos ? previos.has(c) : true;      // por defecto, todos los pendientes
      return `<label class="unir-row" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--line);cursor:pointer;">
        <input type="checkbox" class="chk unir-chk" data-corte="${Utils.escapeHtml(c)}" ${marcado ? 'checked' : ''} onchange="SolicitudPago.actualizarResumenUnir()">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">${Utils.escapeHtml(c)}</div>
          <div style="font-size:12px;color:var(--ink-soft)">${d.consorcios} consorcio${d.consorcios !== 1 ? 's' : ''} por pagar${d.solicitudes.length ? ` · <span style="color:var(--warn)">Solicitud No. ${d.solicitudes.join(', ')} pendiente</span>` : ''}</div>
        </div>
        <div style="font-family:monospace;font-weight:700;white-space:nowrap">${Utils.fmtMoney(d.total)}</div>
      </label>`;
    }).join('');
    actualizarResumenUnir();
    UI.openModal('modalUnirCortes');
  }

  function _cortesMarcados(){
    return [...document.querySelectorAll('.unir-chk')].filter(c => c.checked).map(c => c.dataset.corte);
  }

  function actualizarResumenUnir(){
    const sel = _cortesMarcados();
    const rows = sel.reduce((acc, c) => acc.concat(DataModule.getCXPByCorte(c)), []);
    const total = rows.reduce((s, r) => s + Math.abs(r.pendiente), 0);
    const consorcios = new Set(rows.map(r => r.consorcio)).size;
    const el = document.getElementById('unirCortesResumen');
    if(el) el.innerHTML = `<b>${sel.length}</b> corte(s) · <b>${consorcios}</b> consorcio(s) · Total a pagar <b>${Utils.fmtMoney(total)}</b>`;
    const btn = document.getElementById('unirCortesBtn');
    if(btn) btn.disabled = sel.length < 2;
  }

  function confirmarUnirCortes(){
    const sel = _cortesMarcados().sort(_porFecha);
    if(sel.length < 2){ UI.toast('Marca al menos dos cortes para unirlos', 'err'); return; }
    _cortesUnidos = sel;
    _corteSelected = sel.join(_SEP);
    _rows = _rowsDeSeleccion();
    const found = _findSolicitudForCorte(_corteSelected);
    _solicitudNumero = found ? found.numero : null;
    UI.closeModal('modalUnirCortes');
    _populateCortes();
    updatePreview();
    UI.toast(`${sel.length} cortes unidos en una sola hoja`, 'ok');
  }

  return { render, onCorteChange, updatePreview, printDoc, exportPDF, generarSolicitud,
           abrirUnirCortes, actualizarResumenUnir, confirmarUnirCortes };
})();
