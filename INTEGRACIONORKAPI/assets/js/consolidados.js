/* ============================================================
   Consolidado general (hoja TOTAL) · Consolidado con saldo a favor (hoja TOTAL CON SALDO A FAVOR)
   · Libro auxiliar de créditos
   ============================================================ */
const Consolidado = (() => {
  const S = SemanaORK, esc = H.esc;
  const _f = { q: '', soloMov: false, tipo: '' };
  const PCOLS = [['LOTO5', 'LOTO 5'], ['PRIMERITA', 'PRIMERITA'], ['QUINIELON_FLASH', 'QUINIELÓN FLASH'], ['QUINIELON', 'QUINIELÓN']];

  const vacio = m => `<div class="card"><div class="card-body"><div class="t-empty" style="padding:30px">${esc(m)}<div style="margin-top:12px"><button class="btn btn-primary" onclick="App.switchView('cargar')">Ir a Cargar reportes</button></div></div></div></div>`;
  function filtro(filas){
    const q = Utils.normalize(_f.q || '');
    return filas.filter(f => (!_f.soloMov || f.conMovimiento || f.totalC) && (!_f.tipo || (_f.tipo === 'SIN' ? !f.tipo : f.tipo === _f.tipo)) && (!q || Utils.normalize(f.nombre).indexOf(q) !== -1 || String(f.consorcioId) === _f.q.trim()));
  }
  const barra = (idn) => `<div class="filters" style="grid-template-columns:2fr 1fr 1fr"><div class="field" style="margin:0"><label class="f-label">Buscar consorcio</label><input class="input" value="${esc(_f.q)}" oninput="${idn}.setF('q', this.value)" placeholder="Nombre o ID"></div>
    <div class="field" style="margin:0"><label class="f-label">Tipo</label><select class="input" onchange="${idn}.setF('tipo', this.value)"><option value="">Todos</option><option value="UD"${_f.tipo === 'UD' ? ' selected' : ''}>UD</option><option value="NO_UD"${_f.tipo === 'NO_UD' ? ' selected' : ''}>No UD</option><option value="SIN"${_f.tipo === 'SIN' ? ' selected' : ''}>Sin clasificar</option></select></div>
    <div class="field" style="margin:0;align-self:end"><label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" class="chk" ${_f.soloMov ? 'checked' : ''} onchange="${idn}.setF('soloMov', this.checked)"> Solo con movimientos</label></div></div>`;
  const kpi = (t, v, cls, sub) => `<div class="kpi ${cls || ''}"><div class="lbl">${t}</div><div class="val" style="font-size:20px">${v}</div>${sub ? `<div class="sub" style="font-size:11px;margin-top:3px">${sub}</div>` : ''}</div>`;

  function setF(k, v){ _f[k] = v; _pintar(); }

  function _filaTotales(etq, t, cols, extra){
    return `<tr style="font-weight:700"><td colspan="3">${etq}</td>${cols.map(c => H.tdm(t[c])).join('')}${extra || ''}</tr>`;
  }

  // ---------- consolidado general ----------
  function render(){
    const el = document.getElementById('consBody'); if(!el) return;
    const sem = App.Ctx.sem;
    if(!sem){ el.innerHTML = vacio('Aún no hay una semana seleccionada.'); return; }
    if(!sem.consolidado){ el.innerHTML = vacio('La semana ' + sem.semana + ' aún no está procesada.'); return; }
    const t = sem.consolidado.totales;
    el.innerHTML = `<div class="grid-kpi" style="grid-template-columns:repeat(4,1fr)">${PCOLS.map(([k, n]) => kpi(n, H.money(t.general[k]))).join('')}</div>
      <div class="grid-kpi" style="grid-template-columns:repeat(4,1fr);margin-top:12px">${kpi('Consolidado general', H.money(t.general.totalC), 'blue')}${kpi('Total grupo UD', H.money(t.ud.totalC), '', 'por tipo de consorcio')}${kpi('Total consorcios no UD', H.money(t.noUd.totalC), '', t.sinClasificar + ' sin clasificar incluidos')}${kpi('Con movimientos', t.consorciosConMovimiento + ' de ' + t.consorcios, '')}</div>
      <div class="card" style="margin-top:14px"><div class="card-body"><div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:space-between;align-items:center;margin-bottom:12px"><div><b>Semana ${sem.semana}</b> · ${H.corte(sem)} · ${H.pillEstado(sem.estado)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-soft" onclick="Exportar.hoja('TOTAL')">Exportar hoja TOTAL</button><button class="btn btn-ghost" onclick="Exportar.completa()">Integración completa</button></div></div>${barra('Consolidado')}</div></div>
      <div class="card" style="margin-top:14px"><div class="card-body pad-0"><div class="table-wrap" style="max-height:66vh;overflow:auto"><table class="t"><thead><tr><th class="c">ID</th><th>Consorcio</th><th>Tipo</th>${PCOLS.map(([, n]) => `<th class="r">${n}</th>`).join('')}<th class="r">Saldo a favor / ajuste</th><th class="r">Total</th><th></th></tr></thead><tbody id="consTbody"></tbody><tfoot id="consTfoot"></tfoot></table></div></div></div>
      <p class="hint" style="margin-top:8px">El total de cada consorcio es la suma de los cuatro productos (Total a facturar de cada hoja) más los ajustes que correspondan. Aquí los ajustes permanecen en cero salvo que se registre uno con justificación; los saldos a favor históricos se aplican en la otra pantalla.</p>`;
    _pintar();
  }
  function _pintar(){
    const sem = App.Ctx.sem; if(!sem || !sem.consolidado || !document.getElementById('consTbody')) return;
    const filas = filtro(sem.consolidado.filas);
    document.getElementById('consTbody').innerHTML = filas.map(f => `<tr><td class="c">${f.consorcioId}</td><td><a href="javascript:void(0)" onclick="Consorcio.abrir(${f.consorcioId})">${esc(f.nombre)}</a></td><td>${f.tipo ? esc(f.tipo) : '<span class="muted">sin tipo</span>'}</td>`
      + PCOLS.map(([k]) => H.tdm(f[k])).join('') + `${H.tdm(f.ajusteC)}<td class="r num"><b>${H.money(f.totalC)}</b></td><td class="c"><button class="btn btn-ghost btn-sm" title="Ajuste adicional (con justificación)" onclick="Consolidado.ajusteAdicional(${f.consorcioId})">±</button></td></tr>`).join('') || '<tr><td colspan="10" class="t-empty">Sin resultados.</td></tr>';
    const t = sem.consolidado.totales, cols = ['LOTO5', 'PRIMERITA', 'QUINIELON_FLASH', 'QUINIELON', 'ajusteC', 'totalC'];
    document.getElementById('consTfoot').innerHTML = _filaTotales('TOTAL GENERAL', t.general, cols, '<td></td>') + _filaTotales('TOTAL UD', t.ud, cols, '<td></td>') + _filaTotales('TOTAL NO UD', t.noUd, cols, '<td></td>');
  }

  function ajusteAdicional(id){
    const sem = App.Ctx.sem;
    if(S.estaBloqueada(sem)){ UI.toast('La semana está ' + S.ESTADOS[sem.estado].toLowerCase() + ': reábrela para registrar ajustes.', 'err'); return; }
    const f = sem.consolidado.filas.find(x => x.consorcioId === id);
    App.protegida(() => UI.formulario({ titulo: 'Ajuste adicional · ' + f.nombre, info: 'Se suma al total del consorcio en el consolidado general. No es un saldo a favor histórico (esos se aplican en “Consolidado con saldo a favor”). Requiere justificación.',
      campos: [{ id: 'monto', label: 'Monto (RD$, negativo resta)', tipo: 'number', req: true }, { id: 'motivo', label: 'Justificación', tipo: 'textarea', req: true }],
      onOk: async v => {
        const c = Dinero.aCentavos(v.monto); if(c === null || c === 0){ UI.toast('El monto no es válido', 'err'); return false; }
        const r = await App.guardar(async () => {
          const s = Storage.getSemana(sem.id); if(S.estaBloqueada(s)) throw new Error('La semana está ' + S.ESTADOS[s.estado].toLowerCase() + '.');
          s.ajustesAdicionales.push({ id: Utils.uid('aa'), consorcioId: id, montoC: c, motivo: v.motivo, estado: 'aprobado', creadoPor: Permisos.nombre(), creadoEn: new Date().toISOString() });
          S.recalcular(s, Storage.getCatalogo(), S.cfgConSnapshot(s, Storage.getProductosCfg()));
          S.evento(s, Permisos.nombre(), 'ajuste_adicional', f.nombre + ' · ' + Dinero.fmt(c) + ' · ' + v.motivo);
          Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'ajuste_adicional', entidad: 'consorcio', entidadId: id, semanaId: s.id, detalle: Dinero.fmt(c) + ' · ' + v.motivo });
          return { claves: Storage.saveSemana(s).concat([Storage.KEYS.AUDIT]) };
        }, { semana: sem.id });
        App.recargarSemana(); App.refrescar(); if(r.ok) UI.toast('Ajuste registrado', 'ok'); return r.ok;
      } }));
  }

  return { render, setF, ajusteAdicional, PCOLS, filtro, barra, kpi, vacio };
})();
window.Consolidado = Consolidado;

/* ============================================================
   Consolidado con saldo a favor + libro auxiliar de créditos
   ============================================================ */
const ConsolidadoSaldo = (() => {
  const S = SemanaORK, L = LibroORK, esc = H.esc;
  const _f = { q: '', soloMov: false, tipo: '' };
  let _tab = 'ajustado';
  const _lf = { consorcio: '', tipo: '', semana: '' };
  const catNombre = id => { const c = Storage.getCatalogo().find(x => x.id === id); return c ? c.nombre : ('#' + id); };

  function setF(k, v){ _f[k] = v; _pintar(); }
  function tab(t){ _tab = t; render(); }

  function render(){
    const el = document.getElementById('saldoBody'); if(!el) return;
    const sem = App.Ctx.sem;
    const tabs = `<div class="dtab-bar" style="margin-bottom:14px"><button class="dtab-btn ${_tab === 'ajustado' ? 'active' : ''}" onclick="ConsolidadoSaldo.tab('ajustado')">Consolidado ajustado</button><button class="dtab-btn ${_tab === 'libro' ? 'active' : ''}" onclick="ConsolidadoSaldo.tab('libro')">Libro auxiliar de créditos</button></div>`;
    if(_tab === 'libro'){ el.innerHTML = tabs + '<div id="libroBody"></div>'; Creditos.renderLibro(document.getElementById('libroBody')); return; }
    if(!sem){ el.innerHTML = tabs + Consolidado.vacio('Aún no hay una semana seleccionada.'); return; }
    if(!sem.consolidado){ el.innerHTML = tabs + Consolidado.vacio('La semana ' + sem.semana + ' aún no está procesada.'); return; }
    const aj = S.consolidadoAjustado(sem), g = aj.totales.general, ledger = Storage.getCreditos();
    const disponibleTotal = L.resumen(ledger).reduce((s, r) => s + r.disponibleC, 0);
    el.innerHTML = tabs + `<div class="grid-kpi" style="grid-template-columns:repeat(4,1fr)">${Consolidado.kpi('Consolidado antes de ajustes', H.money(g.antesC), 'blue')}${Consolidado.kpi('Saldo a favor aplicado', H.money(g.saldoC), 'red', 'importe negativo (convención del Excel)')}${Consolidado.kpi('Total ajustado', H.money(g.totalAjustadoC), 'ok')}${Consolidado.kpi('Créditos disponibles', H.money(disponibleTotal), '', 'en el libro auxiliar, todos los consorcios')}</div>
      <div class="card" style="margin-top:14px"><div class="card-body"><div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:space-between;align-items:center;margin-bottom:12px"><div><b>Semana ${sem.semana}</b> · ${H.corte(sem)} · ${H.pillEstado(sem.estado)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-soft" onclick="Exportar.hoja('SALDO')">Exportar hoja TOTAL CON SALDO A FAVOR</button><button class="btn btn-ghost" onclick="Exportar.completa()">Integración completa</button></div></div>${Consolidado.barra('ConsolidadoSaldo')}</div></div>
      <div class="card" style="margin-top:14px"><div class="card-body pad-0"><div class="table-wrap" style="max-height:66vh;overflow:auto"><table class="t"><thead><tr><th class="c">ID</th><th>Consorcio</th>${Consolidado.PCOLS.map(([, n]) => `<th class="r">${n}</th>`).join('')}<th class="r">Saldo a favor aplicado</th><th class="r">Total ajustado</th><th>Tipo</th><th class="r">Crédito disponible</th><th></th></tr></thead><tbody id="saldoTbody"></tbody><tfoot id="saldoTfoot"></tfoot></table></div></div></div>
      <p class="hint" style="margin-top:8px">Total ajustado = total de los cuatro productos + saldo a favor aplicado (negativo). Un resultado negativo de una lotería en la semana NO es un saldo a favor: ambos conceptos se guardan por separado, y un crédito solo se registra en el libro con aprobación.</p>`;
    _pintar();
  }
  function _pintar(){
    const sem = App.Ctx.sem; if(!sem || !sem.consolidado || !document.getElementById('saldoTbody')) return;
    const aj = S.consolidadoAjustado(sem), ledger = Storage.getCreditos();
    const filas = Consolidado.filtro(aj.filas);
    document.getElementById('saldoTbody').innerHTML = filas.map(f => {
      const disp = L.saldo(ledger, f.consorcioId);
      return `<tr><td class="c">${f.consorcioId}</td><td><a href="javascript:void(0)" onclick="Consorcio.abrir(${f.consorcioId})">${esc(f.nombre)}</a></td>${Consolidado.PCOLS.map(([k]) => H.tdm(f[k])).join('')}${H.tdm(f.saldoC)}<td class="r num"><b>${H.money(f.totalAjustadoC)}</b></td><td>${f.tipo ? esc(f.tipo) : '<span class="muted">—</span>'}</td>${H.tdm(disp)}<td class="c"><button class="btn btn-ghost btn-sm" onclick="Creditos.aplicar(${f.consorcioId})">${f.saldoC ? 'Cambiar' : 'Aplicar'}</button></td></tr>`;
    }).join('') || '<tr><td colspan="11" class="t-empty">Sin resultados.</td></tr>';
    const t = aj.totales, cols = ['LOTO5', 'PRIMERITA', 'QUINIELON_FLASH', 'QUINIELON', 'saldoC', 'totalAjustadoC'];
    const fila = (etq, x) => `<tr style="font-weight:700"><td colspan="2">${etq}</td>${cols.map(c => H.tdm(x[c])).join('')}<td colspan="3"></td></tr>`;
    document.getElementById('saldoTfoot').innerHTML = fila('TOTALES', t.general) + fila('TOTAL UD', t.ud) + fila('TOTAL NO UD', t.noUd);
  }

  return { render, setF, tab, _lf };
})();
window.ConsolidadoSaldo = ConsolidadoSaldo;

/* ============================================================
   Creditos — libro auxiliar: aplicar crédito a la semana, registrar, revertir, consultar
   ============================================================ */
const Creditos = (() => {
  const S = SemanaORK, L = LibroORK, esc = H.esc;
  const nombre = id => { const c = Storage.getCatalogo().find(x => x.id === id); return c ? c.nombre : ('#' + id); };
  const semOpc = () => [['', '(sin semana)']].concat(Storage.getIndice().slice().reverse().map(s => [s.id, 'Semana ' + s.semana + ' de ' + s.anio]));

  // Aplica (o cambia) el crédito de un consorcio en la semana activa
  function aplicar(id){
    const sem = App.Ctx.sem;
    if(!sem || !sem.consolidado){ UI.toast('Procesa la semana primero', 'err'); return; }
    if(S.estaBloqueada(sem)){ UI.toast('La semana está ' + S.ESTADOS[sem.estado].toLowerCase() + ': reábrela para cambiar los créditos aplicados.', 'err'); return; }
    const ledger = Storage.getCreditos(), previo = (sem.aplicaciones || []).find(a => a.consorcioId === id && a.estado !== 'revertido');
    const disp = L.saldo(ledger, id) + (previo ? previo.montoC : 0);
    const f = sem.consolidado.filas.find(x => x.consorcioId === id);
    App.protegida(() => UI.formulario({ titulo: 'Saldo a favor aplicado · ' + f.nombre, ancho: 540,
      info: `Crédito disponible: <b>${Dinero.fmt(L.saldo(ledger, id))}</b>${previo ? ` (ya aplicado en esta semana: ${Dinero.fmt(previo.montoC)}; se sustituye)` : ''}. Total del consorcio antes de ajustes: <b>${Dinero.fmt(f.totalC)}</b>. El crédito aplicado se descuenta del libro y queda negativo en el consolidado.`,
      campos: [{ id: 'monto', label: 'Crédito a aplicar (RD$, positivo)', tipo: 'number', req: true, valor: previo ? (previo.montoC / 100).toFixed(2) : '' }, { id: 'referencia', label: 'Referencia', tipo: 'text', valor: previo ? '' : '' }, { id: 'obs', label: 'Observaciones', tipo: 'textarea' }],
      onOk: async v => {
        const c = Dinero.aCentavos(v.monto); if(c === null || c <= 0){ UI.toast('El monto debe ser mayor que cero', 'err'); return false; }
        const r = await App.guardar(async () => {
          const s = Storage.getSemana(sem.id); if(S.estaBloqueada(s)) throw new Error('La semana está ' + S.ESTADOS[s.estado].toLowerCase() + '.');
          let led = Storage.getCreditos(); const claves = [];
          const ant = (s.aplicaciones || []).find(a => a.consorcioId === id && a.estado !== 'revertido');
          if(ant){ const orig = led.find(m => m.id === ant.movimientoId); if(orig){ led.push(L.reversion(orig, 'Sustituido por una nueva aplicación', Permisos.nombre(), Utils.todayISO(), Utils.uid('mv'))); orig.revertidoPor = led[led.length - 1].id; } ant.estado = 'revertido'; }
          const mov = { id: Utils.uid('mv'), consorcioId: id, tipo: 'credito_utilizado', montoC: c, fecha: Utils.todayISO(), semanaAplicacion: s.id, referencia: v.referencia, observaciones: v.obs, estado: 'pendiente', creadoPor: Permisos.nombre(), creadoEn: new Date().toISOString() };
          const err = L.validar(mov, led); if(err.length) throw new Error(err[0]);
          led.push(mov); Storage.saveCreditos(led);
          s.aplicaciones.push({ id: Utils.uid('ap'), consorcioId: id, montoC: c, movimientoId: mov.id, estado: 'pendiente', creadoPor: Permisos.nombre(), creadoEn: mov.creadoEn });
          s.resumen = S.resumenSemana(s);
          S.evento(s, Permisos.nombre(), 'aplicar_credito', nombre(id) + ' · ' + Dinero.fmt(c));
          Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'aplicar_credito', entidad: 'consorcio', entidadId: id, semanaId: s.id, detalle: Dinero.fmt(c) + (ant ? ' (sustituye ' + Dinero.fmt(ant.montoC) + ')' : '') });
          return { claves: Storage.saveSemana(s).concat([Storage.KEYS.CREDITOS, Storage.KEYS.AUDIT]) };
        }, { semana: sem.id });
        App.recargarSemana(); App.refrescar(); if(r.ok) UI.toast('Crédito aplicado', 'ok'); return r.ok;
      } }));
  }

  // Registra saldo inicial / crédito generado / ajuste administrativo
  function registrar(prefijo){
    const p = prefijo || {};
    const cat = Storage.getCatalogoActivo();
    App.protegida(() => UI.formulario({ titulo: 'Registrar movimiento en el libro de créditos', ancho: 560,
      info: 'Un crédito generado nunca se crea automáticamente: lo registra un responsable con su semana de origen. Los movimientos confirmados no se editan; se corrigen con una reversión.',
      campos: [
        { id: 'consorcio', label: 'Consorcio', tipo: 'select', req: true, valor: p.consorcioId || '', opciones: [['', '— elegir —']].concat(cat.map(c => [c.id, c.nombre])) },
        { id: 'tipo', label: 'Tipo de movimiento', tipo: 'select', req: true, valor: p.tipo || 'credito_generado', opciones: [['credito_generado', 'Crédito generado'], ['saldo_inicial', 'Saldo inicial'], ['ajuste_administrativo', 'Ajuste administrativo']] },
        { id: 'signo', label: 'Solo ajuste administrativo: ¿suma o resta?', tipo: 'select', valor: '1', opciones: [['1', 'Suma al saldo'], ['-1', 'Resta del saldo']] },
        { id: 'monto', label: 'Monto (RD$, positivo)', tipo: 'number', req: true, valor: p.monto || '' },
        { id: 'fecha', label: 'Fecha del movimiento', tipo: 'date', req: true, valor: Utils.todayISO() },
        { id: 'origen', label: 'Semana de origen (obligatoria para crédito generado)', tipo: 'select', valor: p.semanaOrigen || (App.Ctx.sem ? App.Ctx.sem.id : ''), opciones: semOpc() },
        { id: 'referencia', label: 'Referencia', tipo: 'text' }, { id: 'obs', label: 'Observaciones / justificación', tipo: 'textarea' }],
      onOk: async v => {
        const c = Dinero.aCentavos(v.monto), id = Number(v.consorcio);
        const mov = { id: Utils.uid('mv'), consorcioId: id, tipo: v.tipo, montoC: c, signo: Number(v.signo), fecha: v.fecha, semanaOrigen: v.tipo === 'credito_generado' ? v.origen : (v.origen || ''), referencia: v.referencia, observaciones: v.obs, estado: 'confirmado', creadoPor: Permisos.nombre(), creadoEn: new Date().toISOString(), aprobadoPor: Permisos.nombre(), aprobadoEn: new Date().toISOString() };
        const err = L.validar(mov, Storage.getCreditos()); if(err.length){ UI.toast(err[0], 'err'); return false; }
        const r = await App.guardar(async () => {
          const led = Storage.getCreditos(); const e2 = L.validar(mov, led); if(e2.length) throw new Error(e2[0]);
          led.push(mov); Storage.saveCreditos(led);
          Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'registrar_' + v.tipo, entidad: 'consorcio', entidadId: id, detalle: nombre(id) + ' · ' + Dinero.fmt(c) + ' · ' + (v.obs || v.referencia || '') });
          return { claves: [Storage.KEYS.CREDITOS, Storage.KEYS.AUDIT] };
        }, {});
        App.refrescar(); if(r.ok) UI.toast('Movimiento registrado', 'ok'); return r.ok;
      } }));
  }

  // Reversión auditada de un movimiento confirmado
  function revertir(movId){
    const led = Storage.getCreditos(), m = led.find(x => x.id === movId); if(!m) return;
    const motivoNo = L.puedeRevertir(m, led); if(motivoNo){ UI.toast(motivoNo, 'err'); return; }
    if(m.tipo === 'credito_utilizado' && m.semanaAplicacion){ const sx = Storage.getIndice().find(s => s.id === m.semanaAplicacion); if(sx && (sx.estado === 'aprobado' || sx.estado === 'cerrado')){ UI.toast('La semana ' + sx.semana + ' está ' + S.ESTADOS[sx.estado].toLowerCase() + ': reábrela (Control semanal) antes de revertir su crédito.', 'err'); return; } }
    App.protegida(() => UI.formulario({ titulo: 'Revertir movimiento', info: `Se registrará un contra-asiento de <b>${esc(L.TIPOS[m.tipo].nombre)}</b> por ${Dinero.fmt(m.montoC)} de ${esc(nombre(m.consorcioId))}. El movimiento original se conserva.`,
      campos: [{ id: 'motivo', label: 'Motivo de la reversión', tipo: 'textarea', req: true }],
      onOk: async v => {
        const r = await App.guardar(async () => {
          const led2 = Storage.getCreditos(), orig = led2.find(x => x.id === movId); const no = L.puedeRevertir(orig, led2); if(no) throw new Error(no);
          const rev = L.reversion(orig, v.motivo, Permisos.nombre(), Utils.todayISO(), Utils.uid('mv')); led2.push(rev); orig.revertidoPor = rev.id; Storage.saveCreditos(led2);
          const claves = [Storage.KEYS.CREDITOS, Storage.KEYS.AUDIT];
          if(orig.tipo === 'credito_utilizado' && orig.semanaAplicacion){
            const s = await Storage.cargarSemana(orig.semanaAplicacion);
            if(s){ if(S.estaBloqueada(s)) throw new Error('La semana de aplicación está ' + S.ESTADOS[s.estado].toLowerCase() + '.'); const ap = (s.aplicaciones || []).find(a => a.movimientoId === orig.id); if(ap) ap.estado = 'revertido'; s.resumen = S.resumenSemana(s); S.evento(s, Permisos.nombre(), 'revertir_credito', nombre(orig.consorcioId) + ' · ' + v.motivo); claves.push(...Storage.saveSemana(s)); }
          }
          Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'revertir_movimiento', entidad: 'movimiento', entidadId: movId, detalle: L.TIPOS[orig.tipo].nombre + ' ' + Dinero.fmt(orig.montoC) + ' · ' + v.motivo });
          return { claves };
        }, {});
        App.recargarSemana(); App.refrescar(); if(r.ok) UI.toast('Movimiento revertido', 'ok'); return r.ok;
      } }));
  }

  // ---------- pantalla del libro ----------
  function renderLibro(el){
    const ledger = Storage.getCreditos(), cat = Storage.getCatalogo(), f = ConsolidadoSaldo._lf;
    const res = L.resumen(ledger).sort((a, b) => nombre(a.consorcioId).localeCompare(nombre(b.consorcioId), 'es'));
    const movs = ledger.slice().reverse().filter(m => (!f.consorcio || String(m.consorcioId) === f.consorcio) && (!f.tipo || m.tipo === f.tipo) && (!f.semana || m.semanaOrigen === f.semana || m.semanaAplicacion === f.semana));
    const cfg = Storage.getConfig(), sem = App.Ctx.sem;
    let props = '';
    if(sem && sem.consolidado){
      if(cfg.creditoDesdeNegativos === 'propuesta'){
        const neg = sem.consolidado.filas.filter(x => x.totalC < 0 && !ledger.some(m => m.consorcioId === x.consorcioId && m.tipo === 'credito_generado' && m.semanaOrigen === sem.id && !m.revertidoPor));
        props = `<div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Propuestas de crédito (semana ${sem.semana})</h3><p class="sub">Consorcios con total negativo. Es solo una propuesta: un responsable decide si se convierte en crédito.</p></div></div><div class="card-body pad-0"><div class="table-wrap"><table class="t"><thead><tr><th>Consorcio</th><th class="r">Total de la semana</th><th></th></tr></thead><tbody>`
          + (neg.length ? neg.map(x => `<tr><td>${esc(x.nombre)}</td>${H.tdm(x.totalC)}<td class="c"><button class="btn btn-soft btn-sm" onclick="Creditos.registrar({consorcioId:${x.consorcioId},tipo:'credito_generado',monto:'${(-x.totalC / 100).toFixed(2)}',semanaOrigen:'${sem.id}'})">Registrar crédito</button></td></tr>`).join('') : '<tr><td colspan="3" class="t-empty">No hay propuestas pendientes.</td></tr>') + '</tbody></table></div></div></div>';
      }else props = '<p class="hint" style="margin-top:10px">Regla “crédito desde resultados negativos”: <b>desactivada</b>. Ningún resultado negativo se convierte en crédito sin decisión de un responsable (se puede habilitar el modo “propuesta” en Configuración).</p>';
    }
    el.innerHTML = `<div class="card"><div class="card-head"><div><h3>Saldos por consorcio</h3><p class="sub">Disponible = Σ movimientos confirmados y pendientes</p></div><button class="btn btn-primary" onclick="Creditos.registrar()">+ Registrar movimiento</button></div>
      <div class="card-body pad-0"><div class="table-wrap" style="max-height:44vh;overflow:auto"><table class="t"><thead><tr><th>Consorcio</th><th class="r">Saldo inicial</th><th class="r">Créditos generados</th><th class="r">Créditos utilizados</th><th class="r">Ajustes</th><th class="r">Pendiente de aprobar</th><th class="r">Saldo final disponible</th></tr></thead><tbody>`
      + (res.length ? res.map(r => `<tr><td><a href="javascript:void(0)" onclick="Consorcio.abrir(${r.consorcioId})">${esc(nombre(r.consorcioId))}</a></td>${H.tdm(r.saldoInicialC)}${H.tdm(r.generadosC)}${H.tdm(r.utilizadosC)}${H.tdm(r.ajustesC + r.reversionesC)}${H.tdm(r.pendienteC)}<td class="r num"><b>${H.money(r.disponibleC)}</b></td></tr>`).join('') : '<tr><td colspan="7" class="t-empty">Aún no hay movimientos en el libro.</td></tr>')
      + `</tbody></table></div></div></div>${props}
      <div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Movimientos</h3><p class="sub">El libro solo crece: nada se borra ni se edita; se corrige con reversiones auditadas.</p></div></div><div class="card-body">
        <div class="filters" style="grid-template-columns:1.5fr 1fr 1fr"><div class="field" style="margin:0"><label class="f-label">Consorcio</label><select class="input" onchange="ConsolidadoSaldo._lf.consorcio=this.value;ConsolidadoSaldo.render()"><option value="">Todos</option>${cat.map(c => `<option value="${c.id}"${f.consorcio === String(c.id) ? ' selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></div>
        <div class="field" style="margin:0"><label class="f-label">Tipo</label><select class="input" onchange="ConsolidadoSaldo._lf.tipo=this.value;ConsolidadoSaldo.render()"><option value="">Todos</option>${Object.keys(L.TIPOS).map(k => `<option value="${k}"${f.tipo === k ? ' selected' : ''}>${L.TIPOS[k].nombre}</option>`).join('')}</select></div>
        <div class="field" style="margin:0"><label class="f-label">Semana</label><select class="input" onchange="ConsolidadoSaldo._lf.semana=this.value;ConsolidadoSaldo.render()">${semOpc().map(o => `<option value="${o[0]}"${f.semana === o[0] ? ' selected' : ''}>${o[0] ? o[1] : 'Todas'}</option>`).join('')}</select></div></div></div>
        <div class="card-body pad-0"><div class="table-wrap" style="max-height:50vh;overflow:auto"><table class="t"><thead><tr><th>Fecha</th><th>Consorcio</th><th>Tipo</th><th class="r">Efecto</th><th>Origen</th><th>Aplicación</th><th>Referencia / observaciones</th><th>Estado</th><th>Registró / aprobó</th><th></th></tr></thead><tbody>`
      + (movs.length ? movs.map(m => `<tr><td>${H.fecha(m.fecha)}</td><td>${esc(nombre(m.consorcioId))}</td><td>${esc(L.TIPOS[m.tipo].nombre)}${m.revertidoPor ? ' <span class="pill gray">revertido</span>' : ''}</td>${H.tdm(L.efecto(m))}<td>${esc((m.semanaOrigen || '').replace(/^\d{4}-S/, 'S') || '—')}</td><td>${esc((m.semanaAplicacion || '').replace(/^\d{4}-S/, 'S') || '—')}</td><td>${esc([m.referencia, m.observaciones].filter(Boolean).join(' · ')) || '—'}</td><td>${m.estado === 'pendiente' ? '<span class="pill warn">Pendiente</span>' : m.estado === 'anulado' ? '<span class="pill gray">Anulado</span>' : '<span class="pill ok">Confirmado</span>'}</td><td class="sub" style="font-size:11.5px">${esc(m.creadoPor || '—')}<br>${esc(m.aprobadoPor || '—')}</td><td class="c">${m.tipo === 'reversion' || m.revertidoPor ? '' : `<button class="btn btn-ghost btn-sm" onclick="Creditos.revertir('${m.id}')">Revertir</button>`}</td></tr>`).join('') : '<tr><td colspan="10" class="t-empty">Sin movimientos.</td></tr>')
      + '</tbody></table></div></div></div>';
  }

  return { aplicar, registrar, revertir, renderLibro };
})();
window.Creditos = Creditos;
