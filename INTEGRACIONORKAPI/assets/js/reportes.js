/* ============================================================
   Reportes — vistas individuales LOTO 5 · PRIMERITA · QUINIELÓN · QUINIELÓN FLASH
   (+ Exportar: botones de descarga a Excel)
   ============================================================ */
const Reportes = (() => {
  const S = SemanaORK, esc = H.esc;
  let _prod = 'LOTO5';
  const _f = { q: '', soloMov: false, k: 'consorcioId', dir: 1 };

  const COLS = [['consorcioId', 'ID', 'c'], ['nombre', 'Consorcio', ''], ['ventasC', 'Ventas jugadas', 'r'], ['comVentasC', 'Comisión ventas', 'r'], ['premiosC', 'Premios pagados', 'r'],
    ['comPremiosC', 'Comisión premios', 'r'], ['subtotalC', 'Subtotal', 'r'], ['ajusteC', 'Semana anterior', 'r'], ['totalC', 'Total a facturar', 'r']];

  function filtrar(filas){
    const q = Utils.normalize(_f.q || '');
    let r = filas.filter(f => (!_f.soloMov || f.conMovimiento || f.ajusteC) && (!q || Utils.normalize(f.nombre).indexOf(q) !== -1 || String(f.consorcioId) === _f.q.trim() || String(f.codigo) === _f.q.trim()));
    r = r.slice().sort((a, b) => { const x = a[_f.k], y = b[_f.k]; return (typeof x === 'string' ? x.localeCompare(y, 'es') : x - y) * _f.dir; });
    return r;
  }
  function ordenar(k){ if(_f.k === k) _f.dir = -_f.dir; else { _f.k = k; _f.dir = 1; } render(_prod); }
  function setQ(v){ _f.q = v; _tabla(); }
  function setSoloMov(v){ _f.soloMov = v; _tabla(); }

  function _tabla(){
    const sem = App.Ctx.sem, pr = sem.productos[_prod], filas = filtrar(pr.filas);
    const tot = C_sumar(filas);
    document.getElementById('prodTbody').innerHTML = filas.map(f => `<tr class="row-clickable" onclick="Reportes.detalle('${_prod}', ${f.consorcioId})">
      <td class="c">${f.consorcioId}</td><td>${esc(f.nombre)}${f.conMovimiento ? '' : ' <span class="muted" style="font-size:11px">sin movimiento</span>'}</td>
      ${H.tdm(f.ventasC)}${H.tdm(f.comVentasC)}${H.tdm(f.premiosC)}${H.tdm(f.comPremiosC)}${H.tdm(f.subtotalC)}${H.tdm(f.ajusteC)}<td class="r num"><b>${H.money(f.totalC)}</b></td></tr>`).join('')
      || '<tr><td colspan="9" class="t-empty">No hay consorcios con ese filtro.</td></tr>';
    document.getElementById('prodTfoot').innerHTML = `<tr style="font-weight:700"><td colspan="2">TOTAL ${filas.length === pr.filas.length ? 'GENERAL' : 'DEL FILTRO'} (${filas.length} consorcios)</td>${H.tdm(tot.ventasC)}${H.tdm(tot.comVentasC)}${H.tdm(tot.premiosC)}${H.tdm(tot.comPremiosC)}${H.tdm(tot.subtotalC)}${H.tdm(tot.ajusteC)}${H.tdm(tot.totalC)}</tr>`;
  }
  const C_sumar = filas => CalculoORK.sumar(filas);

  function render(p){
    if(p) _prod = p;
    const el = document.getElementById('prodBody'); if(!el) return;
    const sem = App.Ctx.sem, def = S.PRODUCTOS_DEF[_prod];
    document.getElementById('prodTitulo').textContent = def.nombre;
    if(!sem){ el.innerHTML = vacio('Aún no hay una semana seleccionada.'); return; }
    if(!sem.productos || !sem.productos[_prod]){ el.innerHTML = vacio('La semana ' + sem.semana + ' aún no tiene resultados de ' + def.nombre + '. Carga y procesa los cuatro reportes.'); return; }
    const pr = sem.productos[_prod], cfgAhora = Storage.getProductosCfg()[_prod];
    const dist = pr.tasas.ventasBp !== cfgAhora.tasaVentasBp || pr.tasas.premiosBp !== cfgAhora.tasaPremiosBp;
    el.innerHTML = `<div class="card"><div class="card-body">
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between">
        <div><b>Semana ${sem.semana}</b> · ${H.corte(sem)} · ${H.pillEstado(sem.estado)}<div class="sub" style="margin-top:4px">Tasas aplicadas en esta semana: comisión de ventas <b>${Dinero.bpATexto(pr.tasas.ventasBp)}</b> · comisión de premios <b>${Dinero.bpATexto(pr.tasas.premiosBp)}</b>${dist ? ' <span class="pill warn">distintas a las vigentes hoy; esta semana conserva las suyas</span>' : ''}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-soft" onclick="Reportes.archivoOriginal('${_prod}')">Consultar archivo original</button><button class="btn btn-soft" onclick="Exportar.hoja('${_prod}')">Exportar Excel</button><button class="btn btn-ghost" onclick="Exportar.completa()">Integración completa</button></div></div>
      <div class="filters" style="margin-top:14px;grid-template-columns:2fr 1fr 1fr"><div class="field" style="margin:0"><label class="f-label">Buscar consorcio (nombre, ID o código)</label><input class="input" value="${esc(_f.q)}" oninput="Reportes.setQ(this.value)" placeholder="Nombre, ID o código"></div>
        <div class="field" style="margin:0;align-self:end"><label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" class="chk" ${_f.soloMov ? 'checked' : ''} onchange="Reportes.setSoloMov(this.checked)"> Solo con movimientos</label></div></div></div></div>
      <div class="card" style="margin-top:14px"><div class="card-body pad-0"><div class="table-wrap" style="max-height:68vh;overflow:auto"><table class="t"><thead><tr>${COLS.map(([k, t, c]) => `<th class="${c}" style="cursor:pointer" onclick="Reportes.ordenar('${k}')">${t}${_f.k === k ? (_f.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody id="prodTbody"></tbody><tfoot id="prodTfoot"></tfoot></table></div></div></div>
      <p class="hint" style="margin-top:8px">Haz clic en un consorcio para ver el detalle de cómo se calculó cada valor. Los resultados negativos se muestran en rojo.</p>`;
    _tabla();
  }
  const vacio = m => `<div class="card"><div class="card-body"><div class="t-empty" style="padding:30px">${esc(m)}<div style="margin-top:12px"><button class="btn btn-primary" onclick="App.switchView('cargar')">Ir a Cargar reportes</button></div></div></div></div>`;

  // ---------- detalle del cálculo de un consorcio ----------
  function detalle(p, id){
    const sem = App.Ctx.sem, pr = sem.productos[p], f = pr.filas.find(x => x.consorcioId === id); if(!f) return;
    const m = Dinero.fmt, t = pr.tasas, a = sem.archivos[p];
    const origen = (f.origen || []).map(o => `<tr><td class="c">${o.linea}</td><td class="c">${esc(o.item)}</td><td>${esc(o.texto)}</td>${H.tdm(o.ventasC)}${H.tdm(o.premiosC)}</tr>`).join('');
    const aj = (sem.ajustes || []).filter(x => x.producto === p && x.consorcioId === id && x.estado !== 'anulado');
    UI.abrir({ titulo: f.nombre + ' · ' + S.PRODUCTOS_DEF[p].nombre, sub: 'Semana ' + sem.semana + ' · ' + H.corte(sem) + ' · consorcio ID ' + id + (f.codigo ? ' · código ORKAPI ' + f.codigo : ''), ancho: 720,
      cuerpo: `<div class="table-wrap"><table class="t"><thead><tr><th>Concepto</th><th>Cálculo</th><th class="r">Importe</th></tr></thead><tbody>
        <tr><td>Ventas jugadas</td><td class="sub">del reporte de ORKAPI</td>${H.tdm(f.ventasC)}</tr>
        <tr><td>(−) Comisión de ventas</td><td class="sub">${m(f.ventasC)} × ${Dinero.bpATexto(t.ventasBp)}</td>${H.tdm(f.comVentasC)}</tr>
        <tr><td>Premios pagados</td><td class="sub">del reporte de ORKAPI</td>${H.tdm(f.premiosC)}</tr>
        <tr><td>(−) Comisión de premios</td><td class="sub">${m(f.premiosC)} × ${Dinero.bpATexto(t.premiosBp)}</td>${H.tdm(f.comPremiosC)}</tr>
        <tr style="font-weight:700"><td>Subtotal</td><td class="sub">ventas − com. ventas − premios − com. premios</td>${H.tdm(f.subtotalC)}</tr>
        <tr><td>(+) Ajuste de semana anterior</td><td class="sub">${aj.length ? aj.length + ' ajuste(s) aprobado(s)' : 'sin ajustes'}</td>${H.tdm(f.ajusteC)}</tr>
        <tr style="font-weight:700"><td>Total a facturar</td><td class="sub">subtotal + ajuste</td>${H.tdm(f.totalC)}</tr></tbody></table></div>`
        + `<p class="hint">Redondeo: cada comisión se redondea a centavos (mitad hacia arriba) y los totales suman líneas ya redondeadas. Con importes en pesos enteros el resultado es exacto.</p>`
        + (origen ? '<h4 style="margin:14px 0 6px">Registros de origen en el reporte</h4><div class="table-wrap"><table class="t"><thead><tr><th class="c">Fila</th><th class="c">ITEM</th><th>Texto en el reporte</th><th class="r">Ventas</th><th class="r">Premios</th></tr></thead><tbody>' + origen + '</tbody></table></div><div class="hint">Archivo: ' + esc(a ? a.nombre : '') + '</div>' : '<p class="hint">Este consorcio no viene en el reporte de la semana: se registra con cero.</p>')
        + (aj.length ? '<h4 style="margin:14px 0 6px">Ajustes de semana anterior</h4><div class="table-wrap"><table class="t"><thead><tr><th>Fecha</th><th>Registró</th><th>Motivo</th><th class="r">Monto</th></tr></thead><tbody>' + aj.map(x => `<tr><td>${H.fecha((x.creadoEn || '').slice(0, 10))}</td><td>${esc(x.creadoPor)}</td><td>${esc(x.motivo)}</td>${H.tdm(x.montoC)}</tr>`).join('') + '</tbody></table></div>' : ''),
      botones: [{ t: 'Cerrar', c: 'btn-ghost', f: UI.cerrar }, { t: 'Historial del consorcio', c: 'btn-soft', f: () => { UI.cerrar(); Consorcio.abrir(id); } }, { t: 'Ajuste de semana anterior', c: 'btn-primary', f: () => { UI.cerrar(); ajuste(p, id); } }] });
  }

  // ---------- ajuste de semana anterior (Administrador + PIN, con motivo) ----------
  function ajuste(p, id){
    const sem = App.Ctx.sem;
    if(S.estaBloqueada(sem)){ UI.toast('La semana está ' + S.ESTADOS[sem.estado].toLowerCase() + ': reábrela para agregar ajustes.', 'err'); return; }
    App.protegida(() => UI.formulario({ titulo: 'Ajuste de semana anterior · ' + (sem.productos[p].filas.find(f => f.consorcioId === id) || {}).nombre, ancho: 520,
      info: 'El ajuste se suma al subtotal de ' + S.PRODUCTOS_DEF[p].nombre + ' (Total a facturar = subtotal + ajuste). Queda registrado con tu nombre y el motivo. Usa un monto negativo para restar.',
      campos: [{ id: 'monto', label: 'Monto del ajuste (RD$)', tipo: 'number', req: true }, { id: 'origen', label: 'Semana de origen (opcional)', tipo: 'text' }, { id: 'motivo', label: 'Motivo / sustento', tipo: 'textarea', req: true }],
      onOk: async v => {
        const c = Dinero.aCentavos(v.monto); if(c === null || c === 0){ UI.toast('El monto no es válido', 'err'); return false; }
        const r = await App.guardar(async () => {
          const f = Storage.getSemana(sem.id); if(S.estaBloqueada(f)) throw new Error('La semana está ' + S.ESTADOS[f.estado].toLowerCase() + '.');
          f.ajustes.push({ id: Utils.uid('aj'), producto: p, consorcioId: id, montoC: c, motivo: v.motivo, semanaOrigen: v.origen, estado: 'aprobado', creadoPor: Permisos.nombre(), creadoEn: new Date().toISOString(), aprobadoPor: Permisos.nombre() });
          S.recalcular(f, Storage.getCatalogo(), S.cfgConSnapshot(f, Storage.getProductosCfg()));
          S.evento(f, Permisos.nombre(), 'ajuste_semana_anterior', S.PRODUCTOS_DEF[p].nombre + ' · consorcio ' + id + ' · ' + Dinero.fmt(c) + ' · ' + v.motivo);
          Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'ajuste_semana_anterior', entidad: 'consorcio', entidadId: id, semanaId: f.id, detalle: S.PRODUCTOS_DEF[p].nombre + ' ' + Dinero.fmt(c) + ' · ' + v.motivo });
          return { claves: Storage.saveSemana(f).concat([Storage.KEYS.AUDIT]) };
        }, { semana: sem.id });
        App.recargarSemana(); App.refrescar(); if(r.ok) UI.toast('Ajuste registrado', 'ok');
        return r.ok;
      } }));
  }

  // ---------- archivo original ----------
  function archivoOriginal(p){
    const a = App.Ctx.sem.archivos[p]; if(!a || !a.cargado){ UI.toast('No hay archivo cargado', 'err'); return; }
    const e = a.encabezado || {};
    UI.abrir({ titulo: 'Archivo original · ' + S.PRODUCTOS_DEF[p].nombre, sub: a.nombre, ancho: 960,
      cuerpo: `<div class="slot-grid" style="margin-bottom:10px"><span>Tipo real</span><b>${esc(a.tipoArchivo)}</b><span>Tamaño</span><b>${Math.round(a.tamano / 1024)} KB</b><span>SHA-256</span><b class="mono" style="font-size:11px">${esc(a.hash)}</b><span>Cargado por</span><b>${esc(a.cargadoPor || '—')} · ${esc((a.cargadoEn || '').slice(0, 16).replace('T', ' '))}</b>
        <span>Reporte</span><b>${esc(e.titulo || '—')}</b><span>Grupo de juegos</span><b>${esc(e.grupoJuegos || '—')}</b><span>Lotería</span><b>${esc(e.loteria || '—')}</b><span>Período</span><b>${e.desde ? Utils.fmtDate(e.desde) + ' – ' + Utils.fmtDate(e.hasta) : '—'}</b></div>`
        + '<div class="table-wrap" style="max-height:52vh;overflow:auto"><table class="t"><thead><tr><th class="c">Fila</th><th class="c">ITEM</th><th>Consorcio (texto original)</th><th class="r">Venta jugadas</th><th class="r">Premios pagados</th><th class="r">Balance final</th></tr></thead><tbody>'
        + a.filas.map(f => `<tr><td class="c">${f.linea}</td><td class="c">${esc(f.item)}</td><td>${esc(f.textoConsorcio)}</td>${H.tdm(f.ventasC)}${H.tdm(f.premiosC)}${H.tdm(f.balanceC)}</tr>`).join('')
        + `</tbody><tfoot><tr style="font-weight:700"><td colspan="3">TOTAL GENERAL (del reporte)</td>${a.total ? H.tdm(a.total.ventasC) + H.tdm(a.total.premiosC) + H.tdm(a.total.balanceC) : '<td colspan="3"></td>'}</tr></tfoot></table></div>`,
      botones: [{ t: 'Cerrar', c: 'btn-ghost', f: UI.cerrar }, { t: 'Descargar el archivo original', c: 'btn-primary', f: () => descargarOriginal(p) }] });
  }
  function descargarOriginal(p){
    const a = App.Ctx.sem.archivos[p];
    if(a.original != null) Utils.download(a.nombre, new Blob([a.original], { type: 'text/plain;charset=utf-8' }));
    else if(a.aoa){ const ws = XLSX.utils.aoa_to_sheet(a.aoa), wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Original'); XLSX.writeFile(wb, a.nombre.replace(/\.[a-z]+$/i, '') + '_original.xlsx'); }
  }

  return { render, ordenar, setQ, setSoloMov, detalle, ajuste, archivoOriginal, descargarOriginal };
})();
window.Reportes = Reportes;

/* ---------- descargas a Excel ---------- */
const Exportar = (() => {
  function _sem(){ const s = App.Ctx.sem; if(!s || !s.productos){ UI.toast('La semana seleccionada aún no está procesada.', 'err'); return null; } return s; }
  function _audit(s, que){ Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'exportar_excel', entidad: 'semana', entidadId: s.id, semanaId: s.id, detalle: que + ' · estado ' + s.estado + ' · v' + s.version }); }
  function completa(){
    const s = _sem(); if(!s) return;
    try{ XLSX.writeFile(ExportadorORK.libroCompleto(XLSX, s), ExportadorORK.nombreArchivo(s)); _audit(s, 'integración completa'); UI.toast('Excel generado: ' + ExportadorORK.nombreArchivo(s), 'ok'); }
    catch(e){ UI.toast('No se pudo generar el Excel: ' + e.message, 'err'); }
  }
  function hoja(que){
    const s = _sem(); if(!s) return;
    try{ const n = ExportadorORK.nombreArchivo(s, que === 'TOTAL' ? 'TOTAL' : que === 'SALDO' ? 'TOTAL_CON_SALDO' : que); XLSX.writeFile(ExportadorORK.libroHoja(XLSX, s, que), n); _audit(s, 'hoja ' + que); UI.toast('Excel generado: ' + n, 'ok'); }
    catch(e){ UI.toast('No se pudo generar el Excel: ' + e.message, 'err'); }
  }
  return { completa, hoja };
})();
window.Exportar = Exportar;
