/* ============================================================
   Asiento — Entrada de Diario (TXT / Excel) a partir de la factura GENERAL.

   Formato (hoja "ENTRADA DE DIARIO" del archivo de ejemplo):
     Cuenta | Descripcion | Debito | Credito | IdCentroCosto | TipoMov. | Atrib.Ent.Per. 1 | Atrib.Ent.Per. N

   Cómo se llena (definido por el negocio):
     DÉBITO 400125  un renglón POR CADA FACTURA NORMAL vigente del período, con el
                    monto de la factura (TOTAL A PAGAR · GSTAR, celda E29) y el
                    IdCentroCosto de su consorcio.
     DÉBITO 400233  Pago de Premios                   (factura general, C14)
     DÉBITO 400234  Comisión Banquera (0.5% Vta Bruta) (factura general, C24)
     DÉBITO 400235  Distribución de resultados · Operador (factura general, C20)
     CRÉDITO 400125 Venta Bruta general               (factura general, C13)

   Por qué el monto del cliente es "TOTAL A PAGAR · GSTAR": es el único que hace
   cuadrar el asiento. Venta − Premios − Comisión − Distribución Operador =
   Distribución Gstar + Jackpot + Hipódromo = E29 (por cliente y en total).

   Reglas de seguridad:
     - Si falta la factura normal de algún consorcio con ventas, o su centro de
       costo, NO se genera (el asiento no cuadraría / no sería importable).
     - Montos redondeados a centavos como Excel. La diferencia por redondeo
       (centavos) se absorbe en el renglón de cliente más grande y se avisa.
       Si la diferencia es mayor a RD$0.10 no se genera.
     - Un monto negativo (ej. premios mayores que la venta) se pasa a la columna
       contraria (un débito negativo se escribe como crédito), para que el
       archivo no lleve montos negativos.
   ============================================================ */
const Asiento = (() => {

  const COLS = ['Cuenta', 'Descripcion', 'Debito', 'Credito', 'IdCentroCosto', 'TipoMov.', 'Atrib.Ent.Per. 1', 'Atrib.Ent.Per. N'];
  const TOLERANCIA = 0.10;
  let _fac = null;
  let _res = null;
  let _busy = false;

  const esc = Utils.escapeHtml;
  // Redondeo a centavos igual que Excel (ver Utils.fmtNum)
  const r2 = x => Number(Utils.fmtNum(x).replace(/,/g, ''));
  const money = v => Utils.fmtNum(v);
  const claveDe = f => (f.codigo || Utils.normalize(f.nombre || ''));
  // Para el archivo: sin tildes ni separadores que rompan el formato
  const limpio = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\t\r\n|;]+/g, ' ').trim();

  function config(){
    const s = Storage.getSettings();
    return { cuentas: s.cuentasAsiento, descripcion: s.descripcionAsiento, centros: s.centrosCosto || {} };
  }
  function centroDe(clave, centros){
    const v = centros[clave];
    const n = Number(v);
    return (v !== undefined && v !== '' && Number.isInteger(n) && n > 0) ? n : null;
  }

  // ---------- armado del asiento ----------
  function construir(gen){
    const cfg = config();
    const errores = [], avisos = [];
    const lote = Storage.getLote(gen.loteId);
    if(!lote) return { errores: ['El lote de la factura general no está disponible.'], avisos, lineas: [] };

    // facturas NORMALES vigentes del mismo lote (= período)
    const normales = Storage.getFacturasVigentes().filter(f => !Storage.esGeneral(f) && f.loteId === lote.id);
    const sinFactura = lote.filas.filter(f => f.ventasNetas > 0 && !normales.some(n => n.filaId === f.id));
    if(sinFactura.length){
      errores.push('Faltan las facturas (vigentes) de: ' + sinFactura.map(f => f.consorcio).join(', ') + '. Genera esas facturas para que el asiento cuadre con la general.');
    }

    const clientes = normales.map(n => {
      const fila = lote.filas.find(f => f.id === n.filaId) || { codigo: '', nombre: n.cliente, consorcio: n.consorcio };
      const clave = claveDe(fila);
      return { n, fila, clave, centro: centroDe(clave, cfg.centros), monto: r2(n.calc.totalPagarGstar) };
    }).sort((a, b) => String(a.fila.codigo || '').localeCompare(String(b.fila.codigo || ''), 'es', { numeric: true }));

    const sinCentro = clientes.filter(c => c.centro === null);
    if(sinCentro.length){
      errores.push('Falta el Id de Centro de Costo de: ' + sinCentro.map(c => c.fila.consorcio).join(', ') + '.');
    }

    // renglones (monto con signo: positivo = débito, negativo = crédito)
    const L = [];
    clientes.forEach(c => L.push({ cuenta: cfg.cuentas.ventas, monto: c.monto, centro: c.centro, ref: c.fila.consorcio, cliente: true }));
    L.push({ cuenta: cfg.cuentas.premios,      monto: r2(gen.calc.premios),       centro: '', ref: 'Pago de Premios' });
    L.push({ cuenta: cfg.cuentas.comision,     monto: r2(gen.calc.comision),      centro: '', ref: 'Comisión Banquera (0.5% Vta Bruta)' });
    L.push({ cuenta: cfg.cuentas.distribucion, monto: r2(gen.calc.distOperador),  centro: '', ref: 'Distribución de resultados · Operador' });
    const venta = r2(gen.calc.ventaBruta);

    // cuadre
    const sumaDeb = r2(L.reduce((s, l) => s + l.monto, 0));
    const residuo = r2(venta - sumaDeb);
    if(Math.abs(residuo) > TOLERANCIA){
      errores.push('El asiento no cuadra: débitos ' + money(sumaDeb) + ' contra Venta Bruta ' + money(venta) + ' (diferencia ' + money(residuo) + '). Revisa que las facturas del período estén completas y vigentes.');
    }else if(residuo !== 0){
      const mayor = L.filter(l => l.cliente).sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto))[0];
      if(mayor){
        mayor.monto = r2(mayor.monto + residuo);
        mayor.ajuste = residuo;
        avisos.push('Ajuste por redondeo de ' + (residuo > 0 ? '+' : '') + residuo.toFixed(2) + ' aplicado al renglón de ' + mayor.ref + ' para que el asiento cuadre al centavo.');
      }
    }

    const lineas = L.map(l => ({
      cuenta: l.cuenta, desc: cfg.descripcion,
      debito: l.monto >= 0 ? l.monto : '', credito: l.monto < 0 ? Math.abs(l.monto) : '',
      centro: l.centro, ref: l.ref, ajuste: l.ajuste || 0
    }));
    lineas.push({ cuenta: cfg.cuentas.ventas, desc: cfg.descripcion, debito: '', credito: venta, centro: '', ref: 'Venta Bruta general' });

    const totalD = r2(lineas.reduce((s, l) => s + (l.debito || 0), 0));
    const totalC = r2(lineas.reduce((s, l) => s + (l.credito || 0), 0));
    if(Math.abs(totalD - totalC) > 0.005 && !errores.length) errores.push('El asiento quedó descuadrado (' + money(totalD) + ' vs ' + money(totalC) + ').');
    return { lineas, totalD, totalC, errores, avisos, lote };
  }

  // ---------- archivos ----------
  const fnum = n => (n === '' || n == null) ? '' : Number(n).toFixed(2);

  function aTXT(res, delim, conEncabezado){
    const filas = res.lineas.map(l => [limpio(l.cuenta), limpio(l.desc), fnum(l.debito), fnum(l.credito), l.centro === '' ? '' : String(l.centro), '', '', '']);
    const todas = (conEncabezado ? [COLS] : []).concat(filas);
    return todas.map(r => r.join(delim)).join('\r\n') + '\r\n';
  }

  function nombreBase(){
    return 'EntradaDiario_' + _fac.numero + '_' + _fac.desde.replace(/-/g, '') + '-' + _fac.hasta.replace(/-/g, '');
  }

  function _opciones(){
    const d = document.getElementById('asDelim').value;
    return { delim: d === 'tab' ? '\t' : d, conEncabezado: document.getElementById('asEnc').checked };
  }

  function _audit(accion, extra){
    const u = (window.Auth && Auth.getUser && Auth.getUser()) || {};
    Storage.addAuditoria({ usuarioNombre: u.name || u.email || '—', accion, entidad: 'factura', entidadId: _fac.id,
      detalle: { numero: _fac.numero, desde: _fac.desde, hasta: _fac.hasta, ...extra } });
  }

  function descargarTXT(){
    if(!_res || _res.errores.length) return;
    const o = _opciones();
    const txt = aTXT(_res, o.delim, o.conEncabezado);
    Utils.download(nombreBase() + '.txt', new Blob([txt], { type: 'text/plain;charset=utf-8' }));
    _audit('generar_txt', { renglones: _res.lineas.length, totalDebito: _res.totalD, totalCredito: _res.totalC });
    UI.toast('TXT generado: ' + nombreBase() + '.txt', 'ok');
  }

  function descargarExcel(){
    if(!_res || _res.errores.length) return;
    const aoa = [COLS].concat(_res.lineas.map(l => [String(l.cuenta), l.desc, l.debito === '' ? '' : l.debito, l.credito === '' ? '' : l.credito, l.centro === '' ? '' : l.centro, '', '', '']));
    aoa.push([]);
    aoa.push(['', '', _res.totalD, _res.totalC]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 10 }, { wch: 48 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 16 }];
    const fmt = '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)';
    for(let r = 1; r < aoa.length; r++){
      ['C', 'D'].forEach(c => { const cell = ws[c + (r + 1)]; if(cell && typeof cell.v === 'number') cell.z = fmt; });
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ENTRADA DE DIARIO');
    XLSX.writeFile(wb, nombreBase() + '.xlsx');
    _audit('generar_excel_asiento', { renglones: _res.lineas.length });
    UI.toast('Excel del asiento exportado', 'ok');
  }

  // ---------- pantalla del asiento ----------
  function abrir(fac){
    if(!fac || !Storage.esGeneral(fac) || fac.estado === 'Anulada'){ UI.toast('El TXT se genera desde una factura GENERAL vigente', 'err'); return; }
    _fac = fac;
    document.getElementById('asTitulo').textContent = 'Entrada de diario · ' + fac.numero;
    _render();
    UI.openModal('modalAsiento');
  }

  function _render(){
    _res = construir(_fac);
    document.getElementById('asSub').textContent = 'Período ' + Utils.fmtDate(_fac.desde) + ' al ' + Utils.fmtDate(_fac.hasta) + ' · factura general ' + _fac.numero;
    const alertas = _res.errores.map(e => '<div class="cc-alert danger">' + esc(e) + '</div>')
      .concat(_res.avisos.map(a => '<div class="cc-alert warn">' + esc(a) + '</div>'));
    if(_res.errores.some(e => e.indexOf('Centro de Costo') !== -1)) alertas.push('<div style="margin-bottom:10px"><button class="btn btn-soft btn-sm" onclick="Asiento.abrirConfig()">Configurar centros de costo</button></div>');
    document.getElementById('asAlertas').innerHTML = alertas.join('');

    document.getElementById('asBody').innerHTML = _res.lineas.map(l =>
      '<tr><td>' + esc(l.cuenta) + '</td><td>' + esc(l.ref) + (l.ajuste ? ' <span class="pill warn">ajuste ' + (l.ajuste > 0 ? '+' : '') + l.ajuste.toFixed(2) + '</span>' : '') + '</td>'
      + '<td class="r">' + (l.debito === '' ? '' : money(l.debito)) + '</td><td class="r">' + (l.credito === '' ? '' : money(l.credito)) + '</td>'
      + '<td class="c">' + (l.centro === '' ? '' : esc(l.centro)) + '</td></tr>').join('')
      + '<tr style="font-weight:700"><td colspan="2">TOTAL</td><td class="r">' + money(_res.totalD || 0) + '</td><td class="r">' + money(_res.totalC || 0) + '</td><td></td></tr>';
    const cuadra = !_res.errores.length && Math.abs(_res.totalD - _res.totalC) < 0.005;
    document.getElementById('asEstado').innerHTML = cuadra
      ? '<span class="pill ok"><span class="pill-dot"></span>Asiento cuadrado</span>'
      : '<span class="pill red"><span class="pill-dot"></span>No se puede generar</span>';
    document.getElementById('asBtnTxt').disabled = !cuadra;
    document.getElementById('asBtnXlsx').disabled = !cuadra;
  }

  // ---------- configuración (centros de costo, cuentas, descripción) ----------
  function _consorciosConocidos(){
    const mapa = new Map();
    Storage.getLotes().forEach(l => l.filas.forEach(f => {
      const k = claveDe(f);
      if(k && !mapa.has(k)) mapa.set(k, { clave: k, codigo: f.codigo || '', nombre: f.nombre || f.consorcio });
    }));
    const centros = Storage.getSettings().centrosCosto || {};
    Object.keys(centros).forEach(k => { if(!mapa.has(k)) mapa.set(k, { clave: k, codigo: k, nombre: '(no aparece en los lotes cargados)' }); });
    return [...mapa.values()].sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'es', { numeric: true }));
  }

  function abrirConfig(){
    const s = Storage.getSettings();
    const centros = s.centrosCosto || {};
    const lista = _consorciosConocidos();
    document.getElementById('cfgCuentaVentas').value = s.cuentasAsiento.ventas;
    document.getElementById('cfgCuentaPremios').value = s.cuentasAsiento.premios;
    document.getElementById('cfgCuentaComision').value = s.cuentasAsiento.comision;
    document.getElementById('cfgCuentaDistrib').value = s.cuentasAsiento.distribucion;
    document.getElementById('cfgDescripcion').value = s.descripcionAsiento;
    document.getElementById('cfgCentrosBody').innerHTML = lista.length
      ? lista.map(c => '<tr><td>' + esc(c.codigo || '—') + '</td><td>' + esc(c.nombre) + '</td><td style="width:160px"><input type="number" min="1" step="1" class="input cfgCentro" data-clave="' + esc(c.clave) + '" value="' + (centros[c.clave] !== undefined ? esc(centros[c.clave]) : '') + '" placeholder="Id centro"></td></tr>').join('')
      : '<tr><td colspan="3" class="t-empty" style="text-align:center;padding:20px;color:var(--ink-faint)">Importa un lote en "Cargar" para ver los consorcios.</td></tr>';
    UI.openModal('modalConfigAsiento');
  }

  function guardarConfig(){
    const centros = {};
    let invalido = null;
    document.querySelectorAll('.cfgCentro').forEach(i => {
      const v = i.value.trim();
      if(v === '') return;
      const n = Number(v);
      if(!Number.isInteger(n) || n <= 0){ invalido = i.dataset.clave; return; }
      centros[i.dataset.clave] = n;
    });
    if(invalido){ UI.toast('El Id de Centro de Costo debe ser un número entero positivo (consorcio ' + invalido + ')', 'err'); return; }
    // se conservan los centros de consorcios que no aparecen en pantalla
    const previoCentros = Storage.getSettings().centrosCosto || {};
    const visibles = new Set([...document.querySelectorAll('.cfgCentro')].map(i => i.dataset.clave));
    Object.keys(previoCentros).forEach(k => { if(!visibles.has(k)) centros[k] = previoCentros[k]; });

    const cuentas = {
      ventas: document.getElementById('cfgCuentaVentas').value.trim(),
      premios: document.getElementById('cfgCuentaPremios').value.trim(),
      comision: document.getElementById('cfgCuentaComision').value.trim(),
      distribucion: document.getElementById('cfgCuentaDistrib').value.trim()
    };
    const descripcion = document.getElementById('cfgDescripcion').value.trim();
    if(Object.values(cuentas).some(v => !v) || !descripcion){ UI.toast('Las cuentas y la descripción son obligatorias', 'err'); return; }

    UI.requirePin(async () => {
      if(_busy) return;
      _busy = true;
      const s0 = Storage.getSettings();
      const previo = { centrosCosto: s0.centrosCosto, cuentasAsiento: s0.cuentasAsiento, descripcionAsiento: s0.descripcionAsiento };
      try{
        Storage.saveSettings({ centrosCosto: centros, cuentasAsiento: cuentas, descripcionAsiento: descripcion });
        const r = window.Sync ? await Sync.pushNow(Storage.KEYS.SETTINGS) : { ok: false, reason: 'no-sync' };
        if(!r.ok){
          Storage.saveSettings(previo);
          UI.toast('No se pudo guardar en Supabase (' + r.reason + '). No se guardó la configuración.', 'err');
          return;
        }
        const u = (window.Auth && Auth.getUser && Auth.getUser()) || {};
        Storage.addAuditoria({ usuarioNombre: u.name || u.email || '—', accion: 'config_asiento', entidad: 'configuracion', entidadId: 'asiento',
          detalle: { centros: Object.keys(centros).length, cuentas, descripcion } });
        UI.closeModal('modalConfigAsiento');
        UI.toast('Configuración del asiento guardada', 'ok');
        if(_fac && document.getElementById('modalAsiento').classList.contains('open')) _render();
      }finally{ _busy = false; }
    });
  }

  return { construir, aTXT, abrir, onOpcion: () => { /* las opciones se leen al descargar */ }, descargarTXT, descargarExcel, abrirConfig, guardarConfig };
})();
window.Asiento = Asiento;
