/* ============================================================
   Control semanal · Historial de integraciones · Historial por consorcio
   ============================================================ */
const Control = (() => {
  const S = SemanaORK, L = LibroORK, esc = H.esc;

  const prevDe = idx => { const lista = Storage.getIndice(); const i = lista.findIndex(s => s.id === idx); return i > 0 ? lista[i - 1] : null; };

  function render(){
    const el = document.getElementById('controlBody'); if(!el) return;
    const anio = App.Ctx.anio || new Date().getFullYear(), idx = Storage.getIndice(), porId = new Map(idx.map(s => [s.id, s]));
    const nSem = S.semanasDelAnio(anio), hoy = S.semanaDeFecha(Utils.todayISO());
    const delAnio = idx.filter(s => s.anio === anio);
    const procesadas = delAnio.filter(s => s.procesada), cerradas = delAnio.filter(s => s.estado === 'aprobado' || s.estado === 'cerrado');
    const incompletas = delAnio.filter(s => !s.procesada && s.hasta < Utils.todayISO());
    const credAp = delAnio.reduce((t, s) => t + (s.saldoC || 0), 0);
    let filas = '';
    for(let n = 1; n <= nSem; n++){
      const id = S.idSemana(anio, n), s = porId.get(id), r = S.semanaISO(anio, n), futura = (anio > hoy.anio) || (anio === hoy.anio && n > hoy.semana);
      if(!s){
        filas += `<tr style="${futura ? 'opacity:.55' : ''}"><td><b>${n}</b></td><td>${Utils.fmtDate(r.desde)} – ${Utils.fmtDate(r.hasta)}</td><td class="r muted">${futura ? 'Automático' : '—'}</td><td class="r muted">${futura ? 'Automático' : '—'}</td><td class="r muted">${futura ? 'Automático' : '—'}</td><td>${futura ? H.pillEstado('borrador').replace('Borrador', 'Pendiente') : '<span class="pill red">Sin integración</span>'}</td><td class="c muted">0/4</td><td class="c">${futura ? '' : `<button class="btn btn-ghost btn-sm" onclick="Control.crear(${anio},${n})">Crear</button>`}</td></tr>`;
        continue;
      }
      const activa = App.Ctx.semanaId === id;
      filas += `<tr class="row-clickable" ${activa ? 'style="background:var(--canvas)"' : ''} onclick="App.setSemana('${id}')"><td><b>${n}</b>${s.version ? ` <span class="sub">v${s.version}</span>` : ''}</td><td>${Utils.fmtDate(s.desde)} – ${Utils.fmtDate(s.hasta)}</td>${H.tdm(s.consolidadoC)}${H.tdm(s.saldoC)}${H.tdm(s.ajustadoC)}<td>${H.pillEstado(s.estado)}${!s.procesada && s.hasta < Utils.todayISO() ? ' <span class="pill red">incompleto</span>' : ''}</td><td class="c">${s.archivos}/4</td>`
        + `<td class="c" style="white-space:nowrap" onclick="event.stopPropagation()"><button class="btn btn-ghost btn-sm" onclick="App.setSemana('${id}').then(()=>App.switchView('cargar'))">Abrir</button>${s.procesada ? `<button class="btn btn-ghost btn-sm" onclick="Control.comparar('${id}')">Comparar</button>` : ''}${s.procesada ? `<button class="btn btn-ghost btn-sm" onclick="Control.descargar('${id}')">Excel</button>` : ''}</td></tr>`;
    }
    const sem = App.Ctx.sem;
    el.innerHTML = `<div class="grid-kpi" style="grid-template-columns:repeat(4,1fr)">${Consolidado.kpi('Semanas procesadas ' + anio, procesadas.length + ' de ' + nSem, 'blue')}${Consolidado.kpi('Aprobadas o cerradas', String(cerradas.length), 'ok')}${Consolidado.kpi('Cortes incompletos', String(incompletas.length), incompletas.length ? 'red' : '', 'semanas pasadas sin procesar')}${Consolidado.kpi('Créditos aplicados ' + anio, H.money(credAp), '', 'suma de las semanas')}</div>`
      + (sem ? _panelSemana(sem) : '<div class="card" style="margin-top:14px"><div class="card-body"><div class="sub">Selecciona una semana de la tabla para ver su estado y las acciones de cierre.</div></div></div>')
      + `<div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Semanas de ${anio}</h3><p class="sub">Haz clic en una fila para seleccionarla. Las semanas anteriores se consultan sin modificar sus datos.</p></div></div><div class="card-body pad-0"><div class="table-wrap" style="max-height:60vh;overflow:auto"><table class="t"><thead><tr><th>Semana</th><th>Fecha del corte</th><th class="r">Consolidado</th><th class="r">Créditos aplicados</th><th class="r">Total ajustado</th><th>Estado</th><th class="c">Archivos</th><th></th></tr></thead><tbody>${filas}</tbody></table></div></div></div>`;
  }

  function _panelSemana(sem){
    const e = sem.estado, adm = Permisos.esAdmin();
    const btn = (t, f, c, dis) => `<button class="btn ${c || 'btn-soft'}" ${dis ? 'disabled' : ''} onclick="${f}">${t}</button>`;
    const acciones = [
      sem.productos && (e === 'procesado') ? btn('Enviar a revisión', "Control.cambiar('revision')") : '',
      sem.productos && (e === 'procesado' || e === 'en_revision') ? btn('Aprobar semana', "Control.cambiar('aprobar')", 'btn-primary') : '',
      e === 'en_revision' ? btn('Devolver a procesado', "Control.cambiar('devolver')", 'btn-ghost') : '',
      e === 'aprobado' ? btn('Cerrar semana', "Control.cambiar('cerrar')", 'btn-primary') : '',
      (e === 'aprobado' || e === 'cerrado') ? btn('Reabrir con autorización', "Control.cambiar('reabrir')", 'btn-ghost') : '',
      sem.productos ? btn('Ver conciliación', 'Control.conciliacion()', 'btn-soft') : '',
      sem.productos ? btn('Descargar cierre semanal', "Control.descargar('" + sem.id + "')", 'btn-soft') : ''
    ].join('');
    const hist = (sem.historial || []).slice().reverse().slice(0, 12).map(h => `<tr><td class="sub">${esc((h.en || '').slice(0, 16).replace('T', ' '))}</td><td>${esc(h.por)}</td><td>${esc(h.accion.replace(/_/g, ' '))}</td><td class="sub">${esc(h.detalle)}</td></tr>`).join('');
    return `<div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Semana ${sem.semana} de ${sem.anio} · ${H.corte(sem)}</h3><p class="sub">${H.pillEstado(sem.estado)} ${sem.aprobadoPor ? ' · aprobada por ' + esc(sem.aprobadoPor) : ''}${sem.cerradoPor ? ' · cerrada por ' + esc(sem.cerradoPor) : ''}</p></div></div>
      <div class="card-body"><div style="display:flex;gap:8px;flex-wrap:wrap">${acciones || '<span class="sub">Carga y procesa los cuatro reportes para habilitar la revisión y el cierre.</span>'}</div>
      ${!adm && (e === 'procesado' || e === 'en_revision' || e === 'aprobado') ? '<p class="hint" style="margin-top:8px">Aprobar, cerrar y reabrir requieren el rol Administrador y su PIN.</p>' : ''}
      <details style="margin-top:12px"><summary style="cursor:pointer;font-weight:700">Historial de la semana</summary><div class="table-wrap" style="margin-top:8px"><table class="t"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>${hist || '<tr><td colspan="4" class="t-empty">Sin eventos.</td></tr>'}</tbody></table></div></details></div></div>`;
  }

  async function crear(anio, n){
    const r = S.semanaISO(anio, n), id = S.idSemana(anio, n);
    const rr = await App.guardar(async () => {
      if(Storage.getSemana(id)) throw new Error('La semana ya existe.');
      const sem = S.nuevaSemana(anio, n, r.desde, r.hasta, Permisos.nombre());
      Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'crear_semana', entidad: 'semana', entidadId: id, semanaId: id });
      return { claves: Storage.saveSemana(sem).concat([Storage.KEYS.AUDIT]) };
    }, { semana: id });
    if(rr.ok){ await App.setSemana(id); App.switchView('cargar'); }
  }

  // ---------- conciliación ----------
  function _chequeos(sem){ return S.conciliar(sem, { productosCfg: Storage.getProductosCfg(), ledger: Storage.getCreditos() }); }
  function _tablaChequeos(c){
    return '<div class="table-wrap"><table class="t"><thead><tr><th></th><th>Verificación</th><th>Detalle</th></tr></thead><tbody>' + c.chequeos.map(x => `<tr><td class="c">${x.ok ? '<span class="pill ok">OK</span>' : '<span class="pill red">Diferencia</span>'}</td><td>${esc(x.nombre)}</td><td class="sub">${esc(x.detalle)}</td></tr>`).join('') + '</tbody></table></div>';
  }
  function conciliacion(){
    const sem = App.Ctx.sem, c = _chequeos(sem);
    UI.abrir({ titulo: 'Conciliación de la semana ' + sem.semana, sub: c.ok ? 'Todas las verificaciones obligatorias están correctas' : 'Hay diferencias sin resolver: no se puede aprobar', ancho: 820, cuerpo: _tablaChequeos(c) + '<p class="hint">“Todos los consorcios tienen tipo validado” es informativo: los consorcios sin tipo cuentan como no UD en los subtotales hasta que se clasifiquen en Configuración.</p>' });
  }

  // ---------- cambios de estado ----------
  async function _aplicar(accion, motivo){
    const sem = App.Ctx.sem;
    const r = await App.guardar(async () => {
      const f = Storage.getSemana(sem.id), led = Storage.getCreditos(), claves = [];
      const quien = Permisos.nombre(), ahora = new Date().toISOString();
      if(accion === 'revision'){ if(f.estado !== 'procesado') throw new Error('Solo una semana procesada pasa a revisión.'); f.estado = 'en_revision'; }
      else if(accion === 'devolver'){ if(f.estado !== 'en_revision') throw new Error('La semana no está en revisión.'); f.estado = 'procesado'; }
      else if(accion === 'aprobar'){
        if(f.estado !== 'procesado' && f.estado !== 'en_revision') throw new Error('La semana no se puede aprobar en su estado actual (' + S.ESTADOS[f.estado] + ').');
        const c = S.conciliar(f, { productosCfg: Storage.getProductosCfg(), ledger: led }); if(!c.ok) throw new Error('La conciliación tiene diferencias sin resolver: ' + c.chequeos.filter(x => !x.ok && x.nombre.indexOf('tipo validado') === -1).map(x => x.nombre).join('; '));
        led.forEach(m => { if(m.tipo === 'credito_utilizado' && m.semanaAplicacion === f.id && m.estado === 'pendiente'){ m.estado = 'confirmado'; m.aprobadoPor = quien; m.aprobadoEn = ahora; } });
        (f.aplicaciones || []).forEach(a => { if(a.estado === 'pendiente') a.estado = 'confirmado'; });
        Storage.saveCreditos(led); claves.push(Storage.KEYS.CREDITOS);
        f.estado = 'aprobado'; f.aprobadoPor = quien; f.aprobadoEn = ahora;
      }
      else if(accion === 'cerrar'){ if(f.estado !== 'aprobado') throw new Error('Solo una semana aprobada se cierra.'); f.estado = 'cerrado'; f.cerradoPor = quien; f.cerradoEn = ahora; }
      else if(accion === 'reabrir'){ if(f.estado !== 'aprobado' && f.estado !== 'cerrado') throw new Error('La semana no está aprobada ni cerrada.'); f.estado = 'reabierto'; f.reabiertoPor = quien; f.reabiertoEn = ahora; f.motivoReapertura = motivo; f.aprobadoPor = null; f.cerradoPor = null; }
      S.evento(f, quien, accion, motivo || '');
      Storage.addAuditoria({ usuario: quien, accion: 'semana_' + accion, entidad: 'semana', entidadId: f.id, semanaId: f.id, detalle: motivo || S.ESTADOS[f.estado] });
      return { claves: claves.concat(Storage.saveSemana(f), [Storage.KEYS.AUDIT]) };
    }, { semana: sem.id });
    App.recargarSemana(); App.refrescar();
    if(r.ok) UI.toast('Semana ' + sem.semana + ': ' + S.ESTADOS[App.Ctx.sem.estado].toLowerCase(), 'ok');
  }
  function cambiar(accion){
    const sem = App.Ctx.sem; if(!sem) return;
    if(accion === 'revision' || accion === 'devolver'){ _aplicar(accion); return; }
    if(accion === 'aprobar'){
      const c = _chequeos(sem);
      UI.abrir({ titulo: 'Aprobar semana ' + sem.semana, sub: c.ok ? 'Conciliación correcta' : 'No se puede aprobar: hay diferencias', ancho: 820,
        cuerpo: _tablaChequeos(c) + '<p class="hint">Al aprobar, los créditos aplicados a esta semana pasan de “pendiente” a “confirmado” en el libro auxiliar y la semana ya no se recalcula.</p>',
        botones: [{ t: 'Cancelar', c: 'btn-ghost', f: UI.cerrar }, { t: 'Aprobar (PIN)', c: 'btn-primary', id: 'btnAprobarOk', f: () => { UI.cerrar(); App.protegida(() => _aplicar('aprobar')); } }] });
      if(!c.ok) document.getElementById('btnAprobarOk').disabled = true;
      return;
    }
    if(accion === 'cerrar'){ UI.confirm('Cerrar la semana ' + sem.semana, 'Una semana cerrada solo puede modificarse reabriéndola con autorización. ¿Cerrar?', () => App.protegida(() => _aplicar('cerrar'))); return; }
    if(accion === 'reabrir'){
      App.protegida(() => UI.formulario({ titulo: 'Reabrir la semana ' + sem.semana, info: 'La semana volverá a ser editable y deberá aprobarse de nuevo. El motivo queda en el historial.', campos: [{ id: 'motivo', label: 'Motivo de la reapertura', tipo: 'textarea', req: true }], onOk: async v => { await _aplicar('reabrir', v.motivo); return true; } }));
    }
  }

  // ---------- comparar con la semana anterior ----------
  async function comparar(id){
    const prev = prevDe(id); if(!prev){ UI.toast('No hay una semana anterior registrada para comparar', 'err'); return; }
    const [a, b] = await Promise.all([Storage.cargarSemana(prev.id), Storage.cargarSemana(id)]);
    if(!a || !a.productos || !b || !b.productos){ UI.toast('Una de las dos semanas no está procesada', 'err'); return; }
    const d = S.diferencias(a, b), ga = a.consolidado.totales.general.totalC, gb = b.consolidado.totales.general.totalC;
    UI.abrir({ titulo: 'Semana ' + b.semana + ' vs semana ' + a.semana, sub: 'Comparación de resultados (sin modificar ninguna de las dos)', ancho: 900,
      cuerpo: '<div class="table-wrap"><table class="t"><thead><tr><th>Producto</th><th class="r">Semana ' + a.semana + '</th><th class="r">Semana ' + b.semana + '</th><th class="r">Diferencia</th></tr></thead><tbody>'
        + d.productos.map(x => `<tr><td>${esc(H.NOMBRES(x.producto))}</td>${H.tdm(x.antesC)}${H.tdm(x.despuesC)}${H.tdm(x.difC)}</tr>`).join('')
        + `<tr style="font-weight:700"><td>Consolidado general</td>${H.tdm(ga)}${H.tdm(gb)}${H.tdm(gb - ga)}</tr></tbody></table></div>`
        + '<h4 style="margin:14px 0 6px">Consorcios con mayor diferencia (' + d.consorcios.length + ' con cambios)</h4><div class="table-wrap" style="max-height:340px;overflow:auto"><table class="t"><thead><tr><th>Consorcio</th><th class="r">Semana ' + a.semana + '</th><th class="r">Semana ' + b.semana + '</th><th class="r">Diferencia</th></tr></thead><tbody>'
        + d.consorcios.slice(0, 30).map(x => `<tr><td><a href="javascript:void(0)" onclick="UI.cerrar();Consorcio.abrir(${x.consorcioId})">${esc(x.nombre)}</a></td>${H.tdm(x.antesC)}${H.tdm(x.despuesC)}${H.tdm(x.difC)}</tr>`).join('') + '</tbody></table></div>' });
  }

  async function descargar(id){
    const s = await Storage.cargarSemana(id);
    if(!s || !s.productos){ UI.toast('La semana no está procesada', 'err'); return; }
    try{ XLSX.writeFile(ExportadorORK.libroCompleto(XLSX, s), ExportadorORK.nombreArchivo(s, 'cierre')); Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'exportar_excel', entidad: 'semana', entidadId: id, semanaId: id, detalle: 'cierre semanal · ' + s.estado }); UI.toast('Cierre semanal descargado', 'ok'); }
    catch(e){ UI.toast('No se pudo generar el Excel: ' + e.message, 'err'); }
  }

  return { render, crear, cambiar, conciliacion, comparar, descargar };
})();
window.Control = Control;

/* ============================================================
   Historial de integraciones (bitácora)
   ============================================================ */
const Historial = (() => {
  const esc = H.esc;
  const _f = { q: '', semana: '', accion: '' };
  function setF(k, v){ _f[k] = v; render(); }
  function render(){
    const el = document.getElementById('histBody'); if(!el) return;
    const aud = Storage.getAuditoria().slice().reverse();
    const acciones = [...new Set(aud.map(a => a.accion))].sort();
    const q = Utils.normalize(_f.q);
    const filas = aud.filter(a => (!_f.semana || a.semanaId === _f.semana) && (!_f.accion || a.accion === _f.accion) && (!q || Utils.normalize([a.usuario, a.accion, a.detalle, a.entidad, a.entidadId].join(' ')).indexOf(q) !== -1)).slice(0, 400);
    const sems = Storage.getIndice().slice().reverse();
    el.innerHTML = `<div class="card"><div class="card-body"><div class="filters" style="grid-template-columns:2fr 1fr 1fr"><div class="field" style="margin:0"><label class="f-label">Buscar</label><input class="input" value="${esc(_f.q)}" oninput="Historial.setF('q', this.value)" placeholder="Usuario, acción o detalle"></div>
      <div class="field" style="margin:0"><label class="f-label">Semana</label><select class="input" onchange="Historial.setF('semana', this.value)"><option value="">Todas</option>${sems.map(s => `<option value="${s.id}"${_f.semana === s.id ? ' selected' : ''}>Semana ${s.semana} de ${s.anio}</option>`).join('')}</select></div>
      <div class="field" style="margin:0"><label class="f-label">Acción</label><select class="input" onchange="Historial.setF('accion', this.value)"><option value="">Todas</option>${acciones.map(a => `<option value="${esc(a)}"${_f.accion === a ? ' selected' : ''}>${esc(a.replace(/_/g, ' '))}</option>`).join('')}</select></div></div></div></div>
      <div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Historial de integraciones y cambios</h3><p class="sub">Quién hizo qué y cuándo (últimos ${filas.length}). Es de solo lectura.</p></div></div><div class="card-body pad-0"><div class="table-wrap" style="max-height:72vh;overflow:auto"><table class="t"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Semana</th><th>Detalle</th></tr></thead><tbody>`
      + (filas.length ? filas.map(a => `<tr><td class="sub" style="white-space:nowrap">${esc((a.createdAt || '').slice(0, 16).replace('T', ' '))}</td><td>${esc(a.usuario || '—')}</td><td>${esc((a.accion || '').replace(/_/g, ' '))}</td><td>${esc((a.semanaId || '').replace(/^(\d{4})-S/, 'S$1·') || '—')}</td><td class="sub">${esc(a.detalle || '')}</td></tr>`).join('') : '<tr><td colspan="5" class="t-empty">Sin registros.</td></tr>') + '</tbody></table></div></div></div>';
  }
  return { render, setF };
})();
window.Historial = Historial;

/* ============================================================
   Consorcio — historial individual de todas sus semanas
   ============================================================ */
const Consorcio = (() => {
  const S = SemanaORK, L = LibroORK, esc = H.esc;
  let _anio = '', _prod = '';

  async function abrir(id, anio, prod){
    if(anio !== undefined) _anio = anio; if(prod !== undefined) _prod = prod;
    const cat = Storage.getCatalogo().find(c => c.id === id); if(!cat) return;
    const idx = Storage.getIndice().filter(s => s.procesada && (!_anio || String(s.anio) === String(_anio)));
    UI.abrir({ titulo: cat.nombre, sub: 'Historial semanal · ID ' + id + (cat.codigo ? ' · código ORKAPI ' + cat.codigo : '') + ' · ' + (cat.tipo || 'sin tipo'), ancho: 1060, cuerpo: '<div class="t-empty">Cargando semanas…</div>', botones: [{ t: 'Cerrar', c: 'btn-ghost', f: UI.cerrar }] });
    const semanas = (await Promise.all(idx.map(s => Storage.cargarSemana(s.id)))).filter(s => s && s.productos);
    const ledger = Storage.getCreditos().filter(m => m.consorcioId === id);
    const prods = _prod ? [_prod] : S.IDS;
    const filas = semanas.map(s => {
      const r = { sem: s, ventasC: 0, premiosC: 0, comC: 0, subC: 0, ajC: 0, totC: 0, porProd: {} };
      prods.forEach(p => { const f = s.productos[p] && s.productos[p].filas.find(x => x.consorcioId === id); if(!f) return; r.ventasC += f.ventasC; r.premiosC += f.premiosC; r.comC += f.comVentasC + f.comPremiosC; r.subC += f.subtotalC; r.ajC += f.ajusteC; r.totC += f.totalC; r.porProd[p] = f.totalC; });
      r.genC = ledger.filter(m => m.semanaOrigen === s.id && m.tipo === 'credito_generado' && L.vigente(m)).reduce((t, m) => t + m.montoC, 0);
      r.usoC = ledger.filter(m => m.semanaAplicacion === s.id && m.tipo === 'credito_utilizado' && L.vigente(m)).reduce((t, m) => t + m.montoC, 0);
      return r;
    });
    const disp = L.saldo(Storage.getCreditos(), id);
    const anios = [...new Set(Storage.getIndice().map(s => s.anio))].sort((a, b) => b - a);
    const cuerpo = `<div class="filters" style="grid-template-columns:1fr 1.4fr 3fr"><div class="field" style="margin:0"><label class="f-label">Año</label><select class="input" onchange="Consorcio.abrir(${id}, this.value, undefined)"><option value="">Todos</option>${anios.map(a => `<option value="${a}"${String(_anio) === String(a) ? ' selected' : ''}>${a}</option>`).join('')}</select></div>
      <div class="field" style="margin:0"><label class="f-label">Lotería / producto</label><select class="input" onchange="Consorcio.abrir(${id}, undefined, this.value)"><option value="">Todos</option>${S.IDS.map(p => `<option value="${p}"${_prod === p ? ' selected' : ''}>${esc(H.NOMBRES(p))}</option>`).join('')}</select></div>
      <div style="align-self:end" class="sub">Crédito disponible hoy: <b>${H.money(disp)}</b></div></div>
      <div id="consGraf" style="margin:12px 0"></div>
      <div class="table-wrap" style="max-height:44vh;overflow:auto"><table class="t"><thead><tr><th>Semana</th><th>Corte</th><th class="r">Ventas</th><th class="r">Premios</th><th class="r">Comisiones</th><th class="r">Resultado semanal</th><th class="r">Ajuste sem. anterior</th><th class="r">Créd. generado</th><th class="r">Créd. utilizado</th><th class="r">Total facturable</th></tr></thead><tbody>`
      + (filas.length ? filas.map(r => `<tr><td><b>${r.sem.semana}</b> <span class="sub">${r.sem.anio}</span></td><td>${H.corte(r.sem)}</td>${H.tdm(r.ventasC)}${H.tdm(r.premiosC)}${H.tdm(r.comC)}${H.tdm(r.subC)}${H.tdm(r.ajC)}${H.tdm(r.genC)}${H.tdm(r.usoC ? -r.usoC : 0)}<td class="r num"><b>${H.money(r.totC - r.usoC)}</b></td></tr>`).join('') : '<tr><td colspan="10" class="t-empty">No hay semanas procesadas con ese filtro.</td></tr>') + '</tbody></table></div>';
    document.getElementById('genCuerpo').innerHTML = cuerpo;
    Graf.lineas(document.getElementById('consGraf'), filas.map(r => 'S' + r.sem.semana), prods.length === 1 ? [{ nombre: H.NOMBRES(prods[0]), valores: filas.map(r => r.totC) }]
      : [{ nombre: 'Total a facturar', valores: filas.map(r => r.totC), color: '#13141C' }].concat(S.IDS.map((p, i) => ({ nombre: H.NOMBRES(p), valores: filas.map(r => r.porProd[p] === undefined ? null : r.porProd[p]) }))), { alto: 230 });
  }
  return { abrir };
})();
window.Consorcio = Consorcio;
