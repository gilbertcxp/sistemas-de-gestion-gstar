/* ============================================================
   Config — comisiones por producto, catálogo de consorcios, reglas, e importación/conciliación con el
   Excel de integración. Los cambios requieren Administrador + PIN y quedan en la bitácora.
   ============================================================ */
const Config = (() => {
  const S = SemanaORK, L = LibroORK, PK = ParserORK, esc = H.esc;
  let _tab = 'productos';
  const _fc = { q: '', tipo: '' };
  let _ref = null;                                   // último Excel de integración leído { ref, nombre }
  let _dif = null;                                   // último reporte de diferencias

  const tabBtn = (k, t) => `<button class="dtab-btn ${_tab === k ? 'active' : ''}" onclick="Config.tab('${k}')">${t}</button>`;
  function tab(k){ _tab = k; render(); }
  function setFc(k, v){ _fc[k] = v; render(); }

  function render(){
    const el = document.getElementById('cfgBody'); if(!el) return;
    el.innerHTML = `<div class="dtab-bar" style="margin-bottom:14px">${tabBtn('productos', 'Productos y comisiones')}${tabBtn('consorcios', 'Catálogo de consorcios')}${tabBtn('reglas', 'Reglas y seguridad')}${tabBtn('conciliar', 'Excel de integración')}</div><div id="cfgTab"></div>`;
    const c = document.getElementById('cfgTab');
    ({ productos: _productos, consorcios: _consorcios, reglas: _reglas, conciliar: _conciliar })[_tab](c);
  }

  // ---------- productos y comisiones ----------
  function _productos(el){
    const cfg = Storage.getConfig(), hist = (cfg.tasasHistorial || []).slice().reverse();
    el.innerHTML = `<div class="card"><div class="card-head"><div><h3>Comisiones por producto</h3><p class="sub">Tomadas del Excel de integración. Cada semana guarda la tasa con la que se calculó: cambiarlas aquí no altera semanas ya procesadas.</p></div></div>
      <div class="card-body pad-0"><div class="table-wrap"><table class="t"><thead><tr><th>Producto</th><th class="r">Comisión de ventas</th><th class="r">Comisión de premios</th><th>Cómo se reconoce el reporte (“Grupos de Juegos”)</th><th></th></tr></thead><tbody>`
      + S.IDS.map(p => { const d = cfg.productos[p]; return `<tr><td><b>${esc(d.nombre)}</b></td><td class="r num">${Dinero.bpATexto(d.tasaVentasBp)}</td><td class="r num">${Dinero.bpATexto(d.tasaPremiosBp)}</td><td>${(d.patrones || []).map(x => `<span class="pill gray">${esc(x)}</span>`).join(' ') || '<span class="muted">sin regla</span>'}</td><td class="c" style="white-space:nowrap"><button class="btn btn-ghost btn-sm" onclick="Config.editarTasas('${p}')">Cambiar tasas</button><button class="btn btn-ghost btn-sm" onclick="Config.editarPatrones('${p}')">Reconocimiento</button></td></tr>`; }).join('')
      + `</tbody></table></div></div></div>
      <div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Historial de cambios de tasas</h3></div></div><div class="card-body pad-0"><div class="table-wrap"><table class="t"><thead><tr><th>Fecha</th><th>Producto</th><th>Antes (ventas / premios)</th><th>Después</th><th>Usuario</th><th>Motivo</th></tr></thead><tbody>`
      + (hist.length ? hist.map(h => `<tr><td class="sub">${esc((h.en || '').slice(0, 16).replace('T', ' '))}</td><td>${esc(H.NOMBRES(h.producto))}</td><td>${Dinero.bpATexto(h.anteriorVentasBp)} / ${Dinero.bpATexto(h.anteriorPremiosBp)}</td><td><b>${Dinero.bpATexto(h.ventasBp)} / ${Dinero.bpATexto(h.premiosBp)}</b></td><td>${esc(h.por)}</td><td>${esc(h.motivo)}</td></tr>`).join('') : '<tr><td colspan="6" class="t-empty">Sin cambios: rigen las tasas del Excel de integración.</td></tr>') + '</tbody></table></div></div></div>';
  }
  function editarTasas(p){
    const d = Storage.getConfig().productos[p];
    App.protegida(() => UI.formulario({ titulo: 'Tasas de ' + d.nombre, info: 'Rigen para las semanas que se procesen desde ahora. Las semanas ya procesadas conservan la tasa con la que se calcularon.',
      campos: [{ id: 'v', label: 'Comisión de ventas (%)', tipo: 'number', req: true, valor: d.tasaVentasBp / 100 }, { id: 'p', label: 'Comisión de premios (%)', tipo: 'number', req: true, valor: d.tasaPremiosBp / 100 }, { id: 'motivo', label: 'Motivo del cambio', tipo: 'textarea', req: true }],
      onOk: async v => {
        const vb = Math.round(parseFloat(v.v) * 100), pb = Math.round(parseFloat(v.p) * 100);
        if(!(vb >= 0 && vb <= 10000 && pb >= 0 && pb <= 10000)){ UI.toast('Los porcentajes deben estar entre 0 y 100', 'err'); return false; }
        if(vb === d.tasaVentasBp && pb === d.tasaPremiosBp){ UI.toast('No hay cambios', 'err'); return false; }
        const r = await App.guardar(async () => {
          const cfg = Storage.getConfig(), x = cfg.productos[p];
          cfg.tasasHistorial = (cfg.tasasHistorial || []).concat([{ producto: p, ventasBp: vb, premiosBp: pb, anteriorVentasBp: x.tasaVentasBp, anteriorPremiosBp: x.tasaPremiosBp, por: Permisos.nombre(), en: new Date().toISOString(), motivo: v.motivo }]);
          x.tasaVentasBp = vb; x.tasaPremiosBp = pb; Storage.saveConfig(cfg);
          Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'cambiar_tasas', entidad: 'producto', entidadId: p, detalle: d.nombre + ': ' + Dinero.bpATexto(d.tasaVentasBp) + '/' + Dinero.bpATexto(d.tasaPremiosBp) + ' → ' + Dinero.bpATexto(vb) + '/' + Dinero.bpATexto(pb) + ' · ' + v.motivo });
          return { claves: [Storage.KEYS.CONFIG, Storage.KEYS.AUDIT] };
        }, {});
        App.refrescar(); if(r.ok) UI.toast('Tasas actualizadas', 'ok'); return r.ok;
      } }));
  }
  function editarPatrones(p){
    const d = Storage.getConfig().productos[p];
    App.protegida(() => UI.formulario({ titulo: 'Reconocimiento del reporte · ' + d.nombre, info: 'Textos del “Grupos de Juegos” del reporte de ORKAPI que identifican este producto (uno por línea). La comparación es exacta (sin importar mayúsculas ni tildes): “EL QUINIELON” no es “QUINIELON FLASH”.',
      campos: [{ id: 'pat', label: 'Textos reconocidos', tipo: 'textarea', req: true, valor: (d.patrones || []).join('\n') }],
      onOk: async v => {
        const pat = v.pat.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        const otros = S.IDS.filter(x => x !== p).flatMap(x => (Storage.getConfig().productos[x].patrones || []).map(t => [PK.norm(t), x]));
        const choque = pat.find(t => otros.some(o => o[0] === PK.norm(t)));
        if(choque){ UI.toast('"' + choque + '" ya identifica a otro producto', 'err'); return false; }
        const r = await App.guardar(async () => { const cfg = Storage.getConfig(); cfg.productos[p].patrones = pat; Storage.saveConfig(cfg); Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'cambiar_reconocimiento', entidad: 'producto', entidadId: p, detalle: pat.join(' | ') }); return { claves: [Storage.KEYS.CONFIG, Storage.KEYS.AUDIT] }; }, {});
        App.refrescar(); if(r.ok) UI.toast('Reconocimiento actualizado', 'ok'); return r.ok;
      } }));
  }

  // ---------- catálogo de consorcios ----------
  function _consorcios(el){
    const cat = Storage.getCatalogo(), q = Utils.normalize(_fc.q);
    const filas = cat.filter(c => (!_fc.tipo || (_fc.tipo === 'SIN' ? !c.tipo : c.tipo === _fc.tipo)) && (!q || Utils.normalize(c.nombre + ' ' + (c.alias || []).join(' ') + ' ' + c.codigo).indexOf(q) !== -1 || String(c.id) === _fc.q.trim()));
    const av = CatalogoORK.avisos(cat);
    el.innerHTML = `<div class="card"><div class="card-head"><div><h3>Catálogo de consorcios (${cat.length})</h3><p class="sub">Los reportes se vinculan por <b>código de ORKAPI</b>, no por nombre ni por orden. Un tipo vacío significa “sin clasificar”, no “no UD”.</p></div><div style="display:flex;gap:8px"><button class="btn btn-soft" onclick="Config.nuevoConsorcio()">+ Consorcio</button><label class="btn btn-primary" style="cursor:pointer">Importar catálogo<input type="file" accept=".xls,.xlsx,.html,.htm" style="display:none" onchange="Config.importarCatalogo(this)"></label></div></div>
      <div class="card-body">${av.map(a => `<div class="cc-alert warn">${esc(a)}</div>`).join('')}<div class="filters" style="grid-template-columns:2fr 1fr"><div class="field" style="margin:0"><label class="f-label">Buscar</label><input class="input" value="${esc(_fc.q)}" oninput="Config.setFc('q', this.value)" placeholder="Nombre, alias, código o ID"></div>
        <div class="field" style="margin:0"><label class="f-label">Tipo</label><select class="input" onchange="Config.setFc('tipo', this.value)"><option value="">Todos</option><option value="UD"${_fc.tipo === 'UD' ? ' selected' : ''}>UD</option><option value="NO_UD"${_fc.tipo === 'NO_UD' ? ' selected' : ''}>No UD</option><option value="SIN"${_fc.tipo === 'SIN' ? ' selected' : ''}>Sin clasificar</option></select></div></div></div>
      <div class="card-body pad-0"><div class="table-wrap" style="max-height:64vh;overflow:auto"><table class="t"><thead><tr><th class="c">ID</th><th>Código ORKAPI</th><th>Nombre</th><th>Alias</th><th>Tipo</th><th>Estado</th><th></th></tr></thead><tbody>`
      + (filas.length ? filas.map(c => `<tr><td class="c">${c.id}</td><td class="mono">${esc(c.codigo || '—')}</td><td>${esc(c.nombre)}</td><td class="sub">${esc((c.alias || []).join(', '))}</td><td>${c.tipo ? esc(c.tipo) + (c.tipoValidado ? ' <span class="pill ok">validado</span>' : ' <span class="pill warn">sin validar</span>') : '<span class="pill gray">sin clasificar</span>'}</td><td>${c.estado === 'inactivo' ? '<span class="pill gray">Inactivo</span>' : '<span class="pill ok">Activo</span>'}</td><td class="c"><button class="btn btn-ghost btn-sm" onclick="Config.editarConsorcio(${c.id})">Editar</button></td></tr>`).join('') : '<tr><td colspan="7" class="t-empty">No hay consorcios. Usa “Importar catálogo” con el Excel de integración o con un reporte de ORKAPI.</td></tr>')
      + '</tbody></table></div></div></div>';
  }

  // Guarda cambios del catálogo y, si la semana activa es editable, revalida sus archivos (los códigos pudieron cambiar)
  async function _guardarCatalogo(mutar, audit){
    const semId = App.Ctx.semanaId;
    const r = await App.guardar(async () => {
      const cat = Storage.getCatalogo(), res = mutar(cat); Storage.saveCatalogo(res || cat);
      const claves = [Storage.KEYS.CATALOGO, Storage.KEYS.AUDIT];
      if(semId){ const s = Storage.getSemana(semId); if(s && S.puedeEditar(s) && S.IDS.some(p => s.archivos[p] && s.archivos[p].cargado)){ Cargar._revalidarTodos(s); s.estado = s.productos ? 'en_validacion' : S.estadoPorArchivos(s); claves.push(...Storage.saveSemana(s)); } }
      Storage.addAuditoria({ usuario: Permisos.nombre(), ...audit });
      return { claves };
    }, { semana: semId || undefined });
    App.recargarSemana(); App.refrescar(); return r.ok;
  }
  function _formConsorcio(c){
    return [
      { id: 'codigo', label: 'Código externo de ORKAPI', tipo: 'text', valor: c ? c.codigo : '', ayuda: 'Es lo que vincula los reportes con este consorcio (ej. 06).' },
      { id: 'nombre', label: 'Nombre', tipo: 'text', req: true, valor: c ? c.nombre : '' },
      { id: 'alias', label: 'Alias o nombres equivalentes (separados por coma)', tipo: 'text', valor: c ? (c.alias || []).join(', ') : '' },
      { id: 'tipo', label: 'Tipo', tipo: 'select', valor: c ? c.tipo : '', opciones: [['', 'Sin clasificar'], ['UD', 'UD'], ['NO_UD', 'No UD']] },
      { id: 'tv', label: 'Tipo validado por el responsable del proceso', tipo: 'select', valor: c && c.tipoValidado ? '1' : '0', opciones: [['0', 'No'], ['1', 'Sí']] },
      { id: 'estado', label: 'Estado', tipo: 'select', valor: c ? c.estado : 'activo', opciones: [['activo', 'Activo'], ['inactivo', 'Inactivo (no entra en nuevas semanas)']] }];
  }
  function editarConsorcio(id){
    const c = Storage.getCatalogo().find(x => x.id === id); if(!c) return;
    App.protegida(() => UI.formulario({ titulo: 'Editar consorcio · ID ' + id, campos: _formConsorcio(c), onOk: async v => {
      const cod = v.codigo ? PK.claveCodigo(v.codigo) : '';
      if(v.codigo && cod === 'NaN'){ UI.toast('El código debe ser numérico', 'err'); return false; }
      if(cod && Storage.getCatalogo().some(x => x.id !== id && x.codigo !== '' && PK.claveCodigo(x.codigo) === cod)){ UI.toast('Ese código ya pertenece a otro consorcio', 'err'); return false; }
      const ok = await _guardarCatalogo(cat => { const x = cat.find(y => y.id === id); x.codigo = cod; x.nombre = v.nombre; x.alias = v.alias.split(',').map(a => a.trim()).filter(Boolean); x.tipo = v.tipo; x.tipoValidado = v.tv === '1'; x.estado = v.estado; x.actualizadoEn = new Date().toISOString(); x.actualizadoPor = Permisos.nombre(); },
        { accion: 'editar_consorcio', entidad: 'consorcio', entidadId: id, detalle: v.nombre + ' · código ' + (cod || '—') + ' · tipo ' + (v.tipo || 'sin clasificar') + ' · ' + v.estado });
      if(ok) UI.toast('Consorcio actualizado', 'ok'); return ok;
    } }));
  }
  function nuevoConsorcio(){
    App.protegida(() => UI.formulario({ titulo: 'Nuevo consorcio', campos: _formConsorcio(null), onOk: async v => {
      const cod = v.codigo ? PK.claveCodigo(v.codigo) : '';
      if(cod && Storage.getCatalogo().some(x => x.codigo !== '' && PK.claveCodigo(x.codigo) === cod)){ UI.toast('Ese código ya pertenece a otro consorcio', 'err'); return false; }
      const ok = await _guardarCatalogo(cat => { const id = cat.reduce((m, c) => Math.max(m, c.id), 0) + 1; cat.push({ id, codigo: cod, nombre: v.nombre, alias: v.alias.split(',').map(a => a.trim()).filter(Boolean), tipo: v.tipo, tipoValidado: v.tv === '1', estado: v.estado, origen: 'manual', creadoEn: new Date().toISOString(), creadoPor: Permisos.nombre() }); },
        { accion: 'crear_consorcio', entidad: 'consorcio', entidadId: v.nombre, detalle: v.nombre });
      if(ok) UI.toast('Consorcio creado', 'ok'); return ok;
    } }));
  }

  // ---------- leer archivos (Excel de integración / reporte ORKAPI) ----------
  async function _leerArchivo(file){
    const buf = await file.arrayBuffer(), bytes = new Uint8Array(buf), tipo = PK.detectarTipo(bytes);
    if(tipo === 'xlsx' || tipo === 'xls-binario'){ const wb = XLSX.read(bytes, { type: 'array' }); return { tipo, wb }; }
    if(tipo === 'html'){ return { tipo, rep: PK.leerReporte({ texto: new TextDecoder('utf-8').decode(bytes) }, 'html') }; }
    return { tipo };
  }
  async function importarCatalogo(input){
    const file = input.files && input.files[0]; input.value = ''; if(!file) return;
    let lec; try{ lec = await _leerArchivo(file); }catch(e){ UI.toast('No se pudo leer el archivo: ' + e.message, 'err'); return; }
    let entradas = [], origen = '';
    if(lec.wb){ const ref = ReferenciaORK.leer(lec.wb); if(!ref.catalogo.length){ UI.toast('No se encontró la hoja TOTAL con los consorcios en ese Excel.', 'err'); return; } _ref = { ref, nombre: file.name }; entradas = ref.catalogo.map(c => ({ id: c.id, nombre: c.nombre, tipo: c.tipo === 'UD' ? 'UD' : '' })); origen = 'excel-integracion'; }
    else if(lec.rep){ if(lec.rep.errores.length || !lec.rep.filas.length){ UI.toast('El reporte no se pudo leer: ' + (lec.rep.errores[0] || 'sin filas'), 'err'); return; } entradas = lec.rep.filas.filter(f => f.codigo).map(f => ({ codigo: f.codigo, nombre: f.nombre })); origen = 'orkapi'; }
    else { UI.toast('El archivo no es un Excel ni un reporte HTML de ORKAPI.', 'err'); return; }
    const f = CatalogoORK.fusionar(Storage.getCatalogo(), entradas, { origen, usuario: Permisos.nombre() });
    UI.abrir({ titulo: 'Importar catálogo', sub: file.name + ' · ' + (origen === 'orkapi' ? 'reporte de ORKAPI (códigos)' : 'Excel de integración (IDs, nombres y tipo)'), ancho: 700,
      cuerpo: `<div class="grid-kpi" style="grid-template-columns:repeat(4,1fr)">${Consolidado.kpi('Nuevos', String(f.agregados.length), 'ok')}${Consolidado.kpi('Actualizados', String(f.actualizados.length), 'blue')}${Consolidado.kpi('Sin cambio', String(f.sinCambio))}${Consolidado.kpi('Conflictos', String(f.conflictos.length), f.conflictos.length ? 'red' : '')}</div>`
        + (f.agregados.length ? '<h4 style="margin:12px 0 4px">Nuevos</h4><div class="sub">' + esc(f.agregados.slice(0, 12).map(c => '#' + c.id + ' ' + c.nombre).join(' · ')) + (f.agregados.length > 12 ? '…' : '') + '</div>' : '')
        + (f.actualizados.length ? '<h4 style="margin:12px 0 4px">Actualizados</h4><div class="sub">' + esc(f.actualizados.slice(0, 12).map(c => c.nombre + ' (' + c.cambios.join(', ') + ')').join(' · ')) + (f.actualizados.length > 12 ? '…' : '') + '</div>' : '')
        + f.conflictos.map(c => `<div class="cc-alert warn" style="margin-top:8px">${esc(c.nombre)}: ${esc(c.motivo)}</div>`).join('')
        + '<p class="hint" style="margin-top:12px">Solo se completan campos vacíos: nunca se pisa un código o tipo ya existente. Los tipos que vengan del Excel quedan <b>sin validar</b> hasta que un responsable los confirme.</p>',
      botones: [{ t: 'Cancelar', c: 'btn-ghost', f: UI.cerrar }, { t: 'Importar (PIN)', c: 'btn-primary', f: () => { UI.cerrar(); App.protegida(async () => {
        const ok = await _guardarCatalogo(cat => CatalogoORK.fusionar(cat, entradas, { origen, usuario: Permisos.nombre() }).catalogo, { accion: 'importar_catalogo', entidad: 'catalogo', entidadId: file.name, detalle: f.agregados.length + ' nuevos, ' + f.actualizados.length + ' actualizados (' + origen + ')' });
        if(ok) UI.toast('Catálogo importado', 'ok'); }); } }] });
  }

  // ---------- reglas y seguridad ----------
  function _reglas(el){
    const cfg = Storage.getConfig();
    el.innerHTML = `<div class="card"><div class="card-head"><div><h3>Reglas del proceso</h3></div></div><div class="card-body">
      <div class="field"><label class="f-label">Crédito a partir de resultados negativos</label><select class="input" style="max-width:420px" onchange="Config.cambiarRegla(this.value)"><option value="desactivado"${cfg.creditoDesdeNegativos === 'desactivado' ? ' selected' : ''}>Desactivado (recomendado hasta que lo apruebe el responsable financiero)</option><option value="propuesta"${cfg.creditoDesdeNegativos === 'propuesta' ? ' selected' : ''}>Solo propuesta: el sistema lista los negativos y un responsable registra cada crédito</option></select>
        <p class="hint">Ningún resultado negativo se convierte en saldo a favor de forma automática.</p></div>
      <div class="field"><label class="f-label">Lotería esperada en los reportes</label><input class="input" style="max-width:420px" value="${esc(cfg.loteria)}" readonly><p class="hint">Un reporte con otra lotería se rechaza al cargarlo.</p></div>
      <button class="btn btn-soft" onclick="Config.cambiarPin()">Cambiar PIN de administrador</button></div></div>
      <div class="card" style="margin-top:14px"><div class="card-head"><div><h3>Permisos</h3></div></div><div class="card-body"><ul style="margin-left:18px;font-size:13px;line-height:1.7"><li><b>Cualquier usuario con acceso al módulo:</b> consultar, cargar y validar reportes, procesar la semana, enviar a revisión y exportar a Excel.</li><li><b>Administrador + PIN:</b> aprobar, cerrar y reabrir semanas; cambiar tasas, catálogo y reglas; mover el libro de créditos (aplicar, registrar, revertir); ajustes de semana anterior y adicionales.</li></ul></div></div>`;
  }
  function cambiarRegla(v){
    App.protegida(async () => { const r = await App.guardar(async () => { const cfg = Storage.getConfig(); const antes = cfg.creditoDesdeNegativos; cfg.creditoDesdeNegativos = v; Storage.saveConfig(cfg); Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'cambiar_regla_creditos', entidad: 'config', entidadId: 'creditoDesdeNegativos', detalle: antes + ' → ' + v }); return { claves: [Storage.KEYS.CONFIG, Storage.KEYS.AUDIT] }; }, {}); App.refrescar(); if(r.ok) UI.toast('Regla actualizada', 'ok'); });
    render();
  }
  function cambiarPin(){
    App.protegida(() => UI.formulario({ titulo: 'Cambiar PIN de administrador', campos: [{ id: 'n', label: 'Nuevo PIN (4 a 8 dígitos)', tipo: 'password', req: true }, { id: 'c', label: 'Confirmar PIN', tipo: 'password', req: true }],
      onOk: async v => { if(!/^\d{4,8}$/.test(v.n) || v.n !== v.c){ UI.toast('El PIN debe tener 4 a 8 dígitos y coincidir', 'err'); return false; }
        const r = await App.guardar(async () => { const cfg = Storage.getConfig(); cfg.adminPin = v.n; Storage.saveConfig(cfg); Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'cambiar_pin', entidad: 'config', entidadId: 'adminPin' }); return { claves: [Storage.KEYS.CONFIG, Storage.KEYS.AUDIT] }; }, {});
        if(r.ok) UI.toast('PIN actualizado', 'ok'); return r.ok; } }));
  }

  // ---------- conciliación con el Excel de integración ----------
  function _conciliar(el){
    const sem = App.Ctx.sem;
    el.innerHTML = `<div class="card"><div class="card-head"><div><h3>Conciliar contra el Excel de integración</h3><p class="sub">Compara las cuatro hojas de producto, TOTAL y TOTAL CON SALDO A FAVOR del Excel contra lo calculado por el sistema para la semana seleccionada. No modifica ni corrige nada.</p></div>
      <label class="btn btn-primary" style="cursor:pointer">Subir Excel de integración<input type="file" accept=".xls,.xlsx" style="display:none" onchange="Config.conciliarArchivo(this)"></label></div>
      <div class="card-body">${sem && sem.productos ? `<div class="sub">Semana seleccionada: <b>${sem.semana} de ${sem.anio}</b> (${H.corte(sem)}) · ${H.pillEstado(sem.estado)}</div>` : '<div class="cc-alert warn">Selecciona y procesa una semana para poder conciliar.</div>'}
      <div id="cfgConc" style="margin-top:12px">${_dif ? _tablaDif(_dif) : ''}</div></div></div>`;
  }
  const motivoCorte = (ref, sem) => ref.corte && (ref.corte.desde !== sem.desde || ref.corte.hasta !== sem.hasta) ? 'El Excel corresponde al corte ' + ref.corte.desde + ' al ' + ref.corte.hasta + ' y la semana seleccionada es ' + sem.desde + ' al ' + sem.hasta + '.' : '';
  async function conciliarArchivo(input){
    const file = input.files && input.files[0]; input.value = ''; if(!file) return;
    const sem = App.Ctx.sem; if(!sem || !sem.productos){ UI.toast('Procesa primero la semana', 'err'); return; }
    let lec; try{ lec = await _leerArchivo(file); }catch(e){ UI.toast('No se pudo leer el archivo: ' + e.message, 'err'); return; }
    if(!lec.wb){ UI.toast('El archivo debe ser el Excel de integración (.xlsx / .xls).', 'err'); return; }
    const ref = ReferenciaORK.leer(lec.wb); _ref = { ref, nombre: file.name };
    const cmp = ReferenciaORK.comparar(sem, ref);
    _dif = { cmp, nombre: file.name, aviso: motivoCorte(ref, sem), ref, semId: sem.id, avisos: ref.avisos };
    Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'conciliar_excel', entidad: 'semana', entidadId: sem.id, semanaId: sem.id, detalle: file.name + ' · ' + cmp.comparados + ' valores · ' + cmp.diferencias.length + ' diferencias' });
    render();
  }
  function _tablaDif(d){
    const c = d.cmp, difs = c.diferencias;
    return (d.aviso ? `<div class="cc-alert warn">${esc(d.aviso)} Las diferencias pueden deberse a que es otra semana.</div>` : '') + (d.avisos || []).map(a => `<div class="cc-alert warn">${esc(a)}</div>`).join('')
      + `<div class="cc-alert ${c.ok ? '' : 'danger'}" style="${c.ok ? 'background:#E6F6EE;color:#15875A' : ''}">${esc(d.nombre)}: ${c.comparados} valores comparados · ${c.ok ? 'SIN DIFERENCIAS: el sistema reproduce el Excel.' : difs.length + ' diferencia(s)'}</div>`
      + (_ref && _ref.ref.saldos.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0"><button class="btn btn-soft" onclick="Config.importarSaldos()">Importar los ${_ref.ref.saldos.length} saldos a favor aplicados del Excel a esta semana</button>${difs.length ? '<button class="btn btn-ghost" onclick="Config.descargarDif()">Descargar reporte de diferencias</button>' : ''}</div>` : '')
      + (difs.length ? '<div class="table-wrap" style="max-height:52vh;overflow:auto"><table class="t"><thead><tr><th>Producto</th><th>Consorcio</th><th>Campo</th><th class="r">Valor de origen (Excel)</th><th class="r">Valor calculado</th><th class="r">Diferencia</th><th>Motivo probable</th></tr></thead><tbody>' + difs.slice(0, 300).map(x => `<tr><td>${esc(x.producto)}</td><td>${esc(x.consorcio)}</td><td>${esc(x.campo)}</td>${H.tdm(x.origenC)}${H.tdm(x.calculadoC)}${H.tdm(x.difC)}<td class="sub">${esc(x.motivo)}</td></tr>`).join('') + '</tbody></table></div>' : '');
  }
  function descargarDif(){
    if(!_dif) return;
    const aoa = [['Producto', 'Consorcio', 'Campo', 'Valor de origen (Excel)', 'Valor calculado', 'Diferencia', 'Motivo probable']].concat(_dif.cmp.diferencias.map(x => [x.producto, x.consorcio, x.campo, x.origenC / 100, x.calculadoC / 100, x.difC / 100, x.motivo]));
    const ws = XLSX.utils.aoa_to_sheet(aoa), wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Diferencias'); XLSX.writeFile(wb, 'Diferencias_conciliacion_' + (_dif.semId || '') + '.xlsx');
  }

  // Trae del Excel los saldos a favor aplicados (col. H) como: saldo inicial confirmado + crédito aplicado a la semana activa (pendiente de aprobar)
  function importarSaldos(){
    const sem = App.Ctx.sem; if(!sem || !sem.consolidado || !_ref){ UI.toast('Procesa la semana y sube el Excel primero', 'err'); return; }
    if(S.estaBloqueada(sem)){ UI.toast('La semana está ' + S.ESTADOS[sem.estado].toLowerCase() + ': reábrela para cambiar los créditos aplicados.', 'err'); return; }
    const cat = Storage.getCatalogo(), plan = [];
    _ref.ref.saldos.forEach(s => {
      const c = cat.find(x => PK.norm(x.nombre) === PK.norm(s.nombre));
      const ya = c && (sem.aplicaciones || []).some(a => a.consorcioId === c.id && a.estado !== 'revertido');
      plan.push({ s, c, ya, montoC: -s.valorC, motivo: !c ? 'No está en el catálogo' : ya ? 'Ya tiene crédito aplicado en esta semana' : '' });
    });
    UI.abrir({ titulo: 'Importar saldos a favor aplicados', sub: _ref.nombre + ' → semana ' + sem.semana, ancho: 720,
      cuerpo: '<div class="table-wrap"><table class="t"><thead><tr><th>Consorcio</th><th class="r">Saldo a favor (Excel)</th><th>Se importará</th></tr></thead><tbody>' + plan.map(p => `<tr><td>${esc(p.s.nombre)}</td>${H.tdm(p.s.valorC)}<td>${p.motivo ? '<span class="pill gray">' + esc(p.motivo) + '</span>' : '<span class="pill ok">Sí</span>'}</td></tr>`).join('') + '</tbody></table></div>'
        + '<p class="hint">Cada saldo se registra en el libro como <b>saldo inicial</b> (origen: “Excel de integración, semana ' + sem.semana + ' — origen por documentar”) y se aplica a esta semana como crédito utilizado (pendiente hasta aprobar la semana). El origen real de cada crédito (semana en que se generó) queda <b>pendiente de validar</b> por el responsable.</p>',
      botones: [{ t: 'Cancelar', c: 'btn-ghost', f: UI.cerrar }, { t: 'Importar (PIN)', c: 'btn-primary', f: () => { UI.cerrar(); App.protegida(async () => {
        const r = await App.guardar(async () => {
          const f = Storage.getSemana(sem.id), led = Storage.getCreditos(); let n = 0;
          S.puedeEditar(f) || (() => { throw new Error('La semana no es editable.'); })();
          plan.filter(p => p.c && !(f.aplicaciones || []).some(a => a.consorcioId === p.c.id && a.estado !== 'revertido')).forEach(p => {
            const ini = { id: Utils.uid('mv'), consorcioId: p.c.id, tipo: 'saldo_inicial', montoC: p.montoC, fecha: f.hasta, referencia: 'Excel de integración semana ' + f.semana + ' — origen por documentar', observaciones: 'Importado de ' + _ref.nombre, estado: 'confirmado', creadoPor: Permisos.nombre(), creadoEn: new Date().toISOString(), aprobadoPor: Permisos.nombre(), aprobadoEn: new Date().toISOString() };
            const e1 = L.validar(ini, led); if(e1.length) throw new Error(p.s.nombre + ': ' + e1[0]); led.push(ini);
            const uso = { id: Utils.uid('mv'), consorcioId: p.c.id, tipo: 'credito_utilizado', montoC: p.montoC, fecha: f.hasta, semanaAplicacion: f.id, referencia: 'Saldo a favor aplicado (Excel de integración)', estado: 'pendiente', creadoPor: Permisos.nombre(), creadoEn: new Date().toISOString() };
            const e2 = L.validar(uso, led); if(e2.length) throw new Error(p.s.nombre + ': ' + e2[0]); led.push(uso);
            f.aplicaciones.push({ id: Utils.uid('ap'), consorcioId: p.c.id, montoC: p.montoC, movimientoId: uso.id, estado: 'pendiente', creadoPor: Permisos.nombre(), creadoEn: uso.creadoEn }); n++;
          });
          if(!n) throw new Error('No hay saldos nuevos para importar.');
          Storage.saveCreditos(led); f.resumen = S.resumenSemana(f); S.evento(f, Permisos.nombre(), 'importar_saldos', n + ' saldo(s) del Excel');
          Storage.addAuditoria({ usuario: Permisos.nombre(), accion: 'importar_saldos_excel', entidad: 'semana', entidadId: f.id, semanaId: f.id, detalle: n + ' saldos · ' + _ref.nombre });
          return { claves: Storage.saveSemana(f).concat([Storage.KEYS.CREDITOS, Storage.KEYS.AUDIT]) };
        }, { semana: sem.id });
        App.recargarSemana(); App.refrescar(); if(r.ok) UI.toast('Saldos a favor importados y aplicados a la semana', 'ok'); }); } }] });
  }

  return { render, tab, setFc, editarTasas, editarPatrones, editarConsorcio, nuevoConsorcio, importarCatalogo, cambiarRegla, cambiarPin, conciliarArchivo, descargarDif, importarSaldos };
})();
window.Config = Config;
