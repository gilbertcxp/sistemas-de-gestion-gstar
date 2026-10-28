/* ============================================================
   AsientoAF — Entrada de Diario de la depreciación mensual (TXT / Excel)
   para carga masiva en el sistema contable (SJ).

   Formato (mismo del módulo Juegos Virtuales y del archivo de ejemplo
   "EJEMPLO DE ENTRADA DE DIARIO.xlsx"):
     Cuenta | Descripcion | Debito | Credito | IdCentroCosto | TipoMov. | Atrib.Ent.Per. 1 | Atrib.Ent.Per. N

   Cómo se arma (igual que el asiento que trae el propio Excel de activos):
     DÉBITO   cuenta de gasto de depreciación (p. ej. 600404): suma del
              "gasto del período" de los activos de esa cuenta.
     CRÉDITO  cuenta de depreciación acumulada pareja de ese gasto
              (p. ej. 110204), por el mismo importe.
   La cuenta pareja es la más usada por los activos de esa cuenta de gasto.
   Los activos cuya cuenta de depreciación acumulada es otra distinta se
   avisan (nunca se corrigen ni se ocultan).

   Reglas de seguridad:
     - Solo se usan importes REGISTRADOS en el corte importado (los activos
       creados a mano con importes calculados se excluyen salvo que se marque).
     - Retirados e inactivos no entran (mismo criterio que el indicador
       "Depreciación del período").
     - Si el asiento no cuadra, o falta una cuenta, NO se genera.
     - Un importe negativo se pasa a la columna contraria (sin montos negativos).
     - Se genera solo al pulsar el botón: el sistema no registra ningún asiento.
   ============================================================ */
(function (root) {
  'use strict';

  const COLS = ['Cuenta', 'Descripcion', 'Debito', 'Credito', 'IdCentroCosto', 'TipoMov.', 'Atrib.Ent.Per. 1', 'Atrib.Ent.Per. N'];
  const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const TOL = 0.005;

  // Redondeo a centavos (mitad hacia afuera, como Excel)
  const r2 = x => { const n = Number(x) || 0; return Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-9) / 100; };
  const fnum = n => (n === '' || n === null || n === undefined) ? '' : Number(n).toFixed(2);
  const fm = n => Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');   // 7,925.20 (para los mensajes)

  function descripcionBase(periodo) {
    const m = /^(\d{4})-(\d{2})$/.exec(periodo || '');
    return 'DEPRECIACIÓN ACTIVOS FIJOS' + (m ? ' ' + MESES[Number(m[2]) - 1] + ' ' + m[1] : '');
  }

  // Para el archivo: sin tildes ni caracteres que rompan el formato
  function limpio(s, delim) {
    let t = String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\t\r\n|;]+/g, ' ');
    if (delim && delim !== '\t') t = t.split(delim).join(' ');
    return t.trim();
  }

  // ---------- armado del asiento ----------
  // filas: [{ a, v, estado }] del período (Datos.todas)
  // opts:  { periodo, descripcion, centro, incluirCalculados, asientoArchivo }
  function construir(filas, opts) {
    const o = opts || {};
    const errores = [], avisos = [];
    const res = { lineas: [], totalD: 0, totalC: 0, errores, avisos, pares: [], desajustes: [], excluidos: { calculados: { n: 0, importe: 0 }, sinGasto: [] }, conciliacion: null };

    if (!o.periodo) { errores.push('No hay un período con datos importados.'); return res; }
    const centro = Number(o.centro);
    if (!Number.isInteger(centro) || centro <= 0) errores.push('El IdCentroCosto debe ser un número entero positivo.');
    const descripcion = String(o.descripcion || '').trim();
    if (!descripcion) errores.push('La descripción de los renglones es obligatoria.');

    // activos que cuentan (mismo criterio que el indicador "Depreciación del período")
    const vigentes = filas.filter(r => r.estado !== 'Retirado' && r.estado !== 'Inactivo');
    const usables = [];
    vigentes.forEach(r => {
      const g = r.v && typeof r.v.gastoPeriodo === 'number' ? r.v.gastoPeriodo : 0;
      if (!r.v || Math.abs(g) < 1e-9) return;
      if (r.v.tipo === 'calculado' && !o.incluirCalculados) { res.excluidos.calculados.n++; res.excluidos.calculados.importe = r2(res.excluidos.calculados.importe + g); return; }
      usables.push({ a: r.a, g });
    });
    if (res.excluidos.calculados.n) {
      avisos.push(res.excluidos.calculados.n + ' activo(s) con importes calculados (no vienen en el corte importado; RD$ ' + fm(res.excluidos.calculados.importe) + ') NO se incluyen en el asiento. Se incluirán cuando aparezcan en un corte importado, o márcalo en "Incluir activos con importes calculados".');
    }

    // cuentas obligatorias
    const sinCuenta = usables.filter(u => !u.a.cuentaGasto || !u.a.cuentaDepAcum);
    if (sinCuenta.length) errores.push('Falta la cuenta de gasto o de depreciación acumulada en el activo ' + sinCuenta.map(u => u.a.numero).join(', ') + '.');

    // gasto por cuenta de gasto y cuenta pareja (la más usada, por importe)
    const porGasto = {};
    usables.filter(u => u.a.cuentaGasto && u.a.cuentaDepAcum).forEach(u => {
      const gcta = String(u.a.cuentaGasto), dcta = String(u.a.cuentaDepAcum);
      const x = porGasto[gcta] = porGasto[gcta] || { gasto: 0, dep: {} };
      x.gasto += u.g;
      const d = x.dep[dcta] = x.dep[dcta] || { importe: 0, n: 0 };
      d.importe += Math.abs(u.g); d.n++;
    });
    const parDe = {};
    Object.keys(porGasto).forEach(gcta => {
      parDe[gcta] = Object.keys(porGasto[gcta].dep).sort((p, q) => {
        const a = porGasto[gcta].dep[p], b = porGasto[gcta].dep[q];
        return (b.importe - a.importe) || (b.n - a.n) || p.localeCompare(q);
      })[0];
    });
    usables.forEach(u => {
      const par = parDe[u.a.cuentaGasto];
      if (par && String(u.a.cuentaDepAcum) !== par) res.desajustes.push({ numero: u.a.numero, descripcion: u.a.descripcion || '', cuentaGasto: String(u.a.cuentaGasto), cuentaDepAcum: String(u.a.cuentaDepAcum), cuentaPar: par, importe: r2(u.g) });
    });
    if (res.desajustes.length) {
      avisos.push(res.desajustes.length + ' activo(s) tienen una cuenta de depreciación acumulada distinta a la pareja de su cuenta de gasto (RD$ ' + fm(r2(res.desajustes.reduce((s, d) => s + d.importe, 0))) + '). Se acreditan a la cuenta pareja del gasto, igual que el asiento del archivo. Revisa su clasificación.');
    }

    // renglones: débitos por gasto, créditos por pareja (monto con signo: + débito / − crédito)
    const gastos = Object.keys(porGasto).sort();
    const debitos = [], creditos = {};
    gastos.forEach(gcta => {
      const m = r2(porGasto[gcta].gasto);
      if (Math.abs(m) < TOL) { res.excluidos.sinGasto.push(gcta); return; }
      debitos.push({ cuenta: gcta, monto: m });
      res.pares.push({ gasto: gcta, depAcum: parDe[gcta], monto: m });
      creditos[parDe[gcta]] = r2((creditos[parDe[gcta]] || 0) + m);
    });
    if (res.excluidos.sinGasto.length) avisos.push('Sin gasto en el período (no se incluyen): ' + res.excluidos.sinGasto.join(', ') + '.');
    if (!debitos.length && !errores.length) errores.push('No hay gasto de depreciación registrado en este período.');

    const mk = (cuenta, monto) => ({ cuenta, desc: descripcion, debito: monto >= 0 ? monto : '', credito: monto < 0 ? Math.abs(monto) : '', centro: Number.isInteger(centro) && centro > 0 ? centro : '' });
    debitos.forEach(d => res.lineas.push(mk(d.cuenta, d.monto)));
    Object.keys(creditos).sort().forEach(c => { if (Math.abs(creditos[c]) >= TOL) res.lineas.push(mk(c, -creditos[c])); });

    res.totalD = r2(res.lineas.reduce((s, l) => s + (l.debito || 0), 0));
    res.totalC = r2(res.lineas.reduce((s, l) => s + (l.credito || 0), 0));
    if (res.lineas.length && Math.abs(res.totalD - res.totalC) > TOL) errores.push('El asiento quedó descuadrado (débitos ' + fm(res.totalD) + ' contra créditos ' + fm(res.totalC) + ').');

    // conciliación con el asiento que trae el propio archivo del corte (informativo)
    const af = o.asientoArchivo;
    if (af && af.filas && af.filas.length) {
      const filasC = af.filas.map(f => {
        const sis = (res.lineas.find(l => String(l.cuenta) === String(f.cuenta) && l.debito !== '') || {}).debito || 0;
        return { cuenta: f.cuenta, archivo: f.archivo, sistema: sis, diferencia: r2(f.archivo - sis) };
      });
      res.conciliacion = { filas: filasC, totalArchivo: af.totalArchivo, totalSistema: res.totalD, diferencia: af.totalArchivo === null || af.totalArchivo === undefined ? null : r2(af.totalArchivo - res.totalD) };
      if (res.conciliacion.diferencia !== null && Math.abs(res.conciliacion.diferencia) > 0.01) avisos.push('El total de este asiento difiere en RD$ ' + fm(res.conciliacion.diferencia) + ' del asiento que trae el archivo del corte (ver detalle).');
    }
    return res;
  }

  // ---------- archivos ----------
  function aTXT(res, delim, conEncabezado) {
    const d = delim || '\t';
    const filas = res.lineas.map(l => [limpio(l.cuenta, d), limpio(l.desc, d), fnum(l.debito), fnum(l.credito), l.centro === '' ? '' : String(l.centro), '', '', '']);
    return (conEncabezado ? [COLS] : []).concat(filas).map(r => r.join(d)).join('\r\n') + '\r\n';
  }
  function aFilasExcel(res) {
    const aoa = [COLS].concat(res.lineas.map(l => [String(l.cuenta), l.desc, l.debito === '' ? '' : l.debito, l.credito === '' ? '' : l.credito, l.centro === '' ? '' : l.centro, '', '', '']));
    aoa.push([]); aoa.push(['', '', res.totalD, res.totalC]);
    return aoa;
  }

  const api = { construir, aTXT, aFilasExcel, descripcionBase, COLS, limpio, r2 };
  root.AsientoAFCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // ============================================================
  // Pantalla (solo navegador)
  // ============================================================
  if (typeof document === 'undefined') return;

  let _res = null, _per = '';
  const esc = s => Utils.escapeHtml(s);
  const money = v => Utils.fmtNum(v);
  const LS = 'afAsientoOpc';

  function _guardadas() { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } }
  function _recordar(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { /* solo conveniencia */ } }

  function _opciones() {
    const d = document.getElementById('asfDelim').value;
    return {
      periodo: _per,
      descripcion: document.getElementById('asfDesc').value,
      centro: document.getElementById('asfCentro').value,
      incluirCalculados: document.getElementById('asfCalc').checked,
      delim: d === 'tab' ? '\t' : d,
      conEncabezado: document.getElementById('asfEnc').checked
    };
  }

  function abrir() {
    _per = Datos.periodo();
    if (!_per) { UI.toast('Primero importa un corte de activos', 'err'); return; }
    const g = _guardadas();
    document.getElementById('asfDesc').value = (g.descripcion && g.periodo === _per) ? g.descripcion : descripcionBase(_per);
    document.getElementById('asfCentro').value = g.centro || 1;
    document.getElementById('asfDelim').value = g.delim || 'tab';
    document.getElementById('asfEnc').checked = g.conEncabezado !== false;
    document.getElementById('asfCalc').checked = false;
    document.getElementById('asfTitulo').textContent = 'Entrada de diario · depreciación ' + Datos.etiquetaPeriodo(_per);
    render();
    UI.openModal('modalAsientoAF');
  }

  function render() {
    const o = _opciones();
    const imp = Datos.importacionDe(_per);
    _res = construir(Datos.todas(_per), { ...o, asientoArchivo: imp && imp.asiento ? imp.asiento : null });
    const corte = Datos.fechaCorte(_per);
    document.getElementById('asfSub').textContent = 'Período ' + Datos.etiquetaPeriodo(_per) + (corte ? ' · corte ' + Utils.fmtDate(corte) : '') + ' · débito a gasto de depreciación / crédito a depreciación acumulada';
    document.getElementById('asfAlertas').innerHTML = _res.errores.map(e => '<div class="cc-alert danger">' + esc(e) + '</div>').concat(_res.avisos.map(a => '<div class="cc-alert warn">' + esc(a) + '</div>')).join('');

    const nombres = Storage.getSettings().cuentasNombres || {};
    document.getElementById('asfBody').innerHTML = _res.lineas.map(l =>
      '<tr><td class="mono">' + esc(l.cuenta) + '</td><td>' + esc(nombres[l.cuenta] || '') + '</td><td>' + esc(l.desc) + '</td>'
      + '<td class="r mono">' + (l.debito === '' ? '' : money(l.debito)) + '</td><td class="r mono">' + (l.credito === '' ? '' : money(l.credito)) + '</td><td class="c">' + esc(l.centro) + '</td></tr>').join('')
      + (_res.lineas.length ? '<tr style="font-weight:700"><td colspan="3">TOTAL</td><td class="r mono">' + money(_res.totalD) + '</td><td class="r mono">' + money(_res.totalC) + '</td><td></td></tr>' : '<tr><td colspan="6" class="t-empty" style="text-align:center;padding:20px">Sin renglones.</td></tr>');

    const cuadra = !_res.errores.length && _res.lineas.length > 0 && Math.abs(_res.totalD - _res.totalC) <= TOL;
    document.getElementById('asfEstado').innerHTML = cuadra
      ? '<span class="pill ok"><span class="pill-dot"></span>Asiento cuadrado</span>'
      : '<span class="pill red"><span class="pill-dot"></span>No se puede generar</span>';
    document.getElementById('asfBtnTxt').disabled = !cuadra;
    document.getElementById('asfBtnXlsx').disabled = !cuadra;

    let extra = '';
    if (_res.conciliacion) {
      const c = _res.conciliacion;
      extra += '<details style="margin-top:10px"><summary style="font-weight:700;cursor:pointer">Conciliación con el asiento del archivo (' + esc(Datos.etiquetaPeriodo(_per)) + ')</summary><div class="table-wrap"><table class="t"><thead><tr><th>Cuenta</th><th class="r">Archivo</th><th class="r">Este asiento</th><th class="r">Diferencia</th></tr></thead><tbody>'
        + c.filas.map(f => '<tr><td class="mono">' + esc(f.cuenta) + '</td><td class="r mono">' + money(f.archivo) + '</td><td class="r mono">' + money(f.sistema) + '</td><td class="r mono" style="' + (Math.abs(f.diferencia) > 0.01 ? 'color:var(--danger);font-weight:700' : '') + '">' + money(f.diferencia) + '</td></tr>').join('')
        + '</tbody></table></div></details>';
    }
    if (_res.desajustes.length) {
      extra += '<details style="margin-top:10px"><summary style="font-weight:700;cursor:pointer">Activos con cuenta de depreciación acumulada distinta a la pareja (' + _res.desajustes.length + ')</summary><div class="table-wrap"><table class="t"><thead><tr><th>No.</th><th>Descripción</th><th>Cuenta gasto</th><th>Dep. acum. del activo</th><th>Se acredita a</th><th class="r">Gasto</th></tr></thead><tbody>'
        + _res.desajustes.map(d => '<tr><td>' + esc(d.numero) + '</td><td>' + esc(d.descripcion) + '</td><td class="mono">' + esc(d.cuentaGasto) + '</td><td class="mono">' + esc(d.cuentaDepAcum) + '</td><td class="mono">' + esc(d.cuentaPar) + '</td><td class="r mono">' + money(d.importe) + '</td></tr>').join('')
        + '</tbody></table></div></details>';
    }
    document.getElementById('asfExtra').innerHTML = extra;
  }

  function _nombreBase() { return 'EntradaDiario_Depreciacion_' + _per; }
  function _audit(accion, detalle) {
    Storage.addAuditoria({ usuarioNombre: Permisos.nombre(), accion, entidad: 'asiento', entidadId: _per, detalle });
  }
  function _puede() { return _res && !_res.errores.length && _res.lineas.length > 0; }

  function descargarTXT() {
    if (!_puede()) return;
    const o = _opciones();
    const txt = aTXT(_res, o.delim, o.conEncabezado);
    Utils.download(_nombreBase() + '.txt', new Blob([txt], { type: 'text/plain;charset=utf-8' }));
    _recordar({ periodo: _per, descripcion: o.descripcion, centro: o.centro, delim: document.getElementById('asfDelim').value, conEncabezado: o.conEncabezado });
    _audit('generar_txt_asiento', { renglones: _res.lineas.length, totalDebito: _res.totalD, totalCredito: _res.totalC, centro: Number(o.centro), descripcion: o.descripcion });
    UI.toast('TXT generado: ' + _nombreBase() + '.txt', 'ok');
  }

  function descargarExcel() {
    if (!_puede()) return;
    const aoa = aFilasExcel(_res);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 10 }, { wch: 48 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 16 }];
    const fmt = '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)';
    for (let r = 1; r < aoa.length; r++) ['C', 'D'].forEach(c => { const cell = ws[c + (r + 1)]; if (cell && typeof cell.v === 'number') cell.z = fmt; });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ENTRADA DE DIARIO');
    XLSX.writeFile(wb, _nombreBase() + '.xlsx');
    _audit('generar_excel_asiento', { renglones: _res.lineas.length, totalDebito: _res.totalD });
    UI.toast('Excel de la entrada de diario exportado', 'ok');
  }

  root.AsientoAF = { abrir, render, descargarTXT, descargarExcel, construir, aTXT };
})(typeof window !== 'undefined' ? window : globalThis);
