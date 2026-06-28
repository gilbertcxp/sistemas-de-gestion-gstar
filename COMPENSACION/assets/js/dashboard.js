/* ============================================================
   Dashboard — Centro de Gestión del Proyecto
   Acceso restringido: Gilbert, Anthony Santos
   ============================================================ */
const Dashboard = (() => {

  const ALLOWED   = ['gilbert', 'anthony santos'];
  const K_USER    = 'fc_dash_user';
  const KEYS = {
    features: 'fc_dash_features',
    bugs:     'fc_dash_bugs',
    ideas:    'fc_dash_ideas',
    notes:    'fc_dash_notes',
    feedback: 'fc_dash_feedback',
    versions: 'fc_dash_versions',
    config:   'fc_dash_config'
  };
  const MODULOS    = ['Banco','Compensación','CXC','CXP','Reportes','Dashboard Ejecutivo','Seguridad','Producción'];
  const PRIOS      = ['Alta','Media','Baja'];
  const F_ESTADOS  = ['Pendiente','En desarrollo','En pruebas','Finalizado'];
  const B_ESTADOS  = ['Abierto','En revisión','Solucionado'];
  const I_ESTADOS  = ['Pendiente','Evaluando','Aprobada','Implementada','Rechazada'];
  const FB_ESTADOS = ['Pendiente','En revisión','Procesado'];

  let _tab  = 'resumen';
  let _edit = null;

  // ---- Storage helpers ----
  function _get(key, def) {
    try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : def; }
    catch { return def; }
  }
  function _set(key, val)    { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
  function _list(key)        { return _get(key, []); }
  function _save(key, arr)   { _set(key, arr); }
  function _byId(key, id)    { return _list(key).find(r => r.id === id) || null; }
  function _del(key, id)     { _save(key, _list(key).filter(r => r.id !== id)); }
  function _upsert(key, item) {
    const arr = _list(key);
    const i = arr.findIndex(r => r.id === item.id);
    if (i >= 0) arr[i] = item; else arr.push(item);
    _save(key, arr);
  }
  function _uid()   { return 'dp' + Date.now() + Math.random().toString(36).slice(2, 6); }
  function _today() { return Utils.toISODate(new Date()); }
  function _el(id)  { return document.getElementById(id); }

  // ---- Auth ----
  function _authed() {
    const u = sessionStorage.getItem(K_USER) || '';
    return ALLOWED.includes(u.toLowerCase().trim());
  }
  function _user() { return sessionStorage.getItem(K_USER) || ''; }

  function auth() {
    const inp  = _el('dashUser');
    const name = (inp?.value || '').trim();
    if (!name) { _authErr('Ingresa tu nombre.'); return; }
    if (!ALLOWED.includes(name.toLowerCase())) {
      _authErr('Acceso denegado. No estás autorizado para ver este panel.');
      return;
    }
    sessionStorage.setItem(K_USER, name);
    _boot();
  }

  function logout() { sessionStorage.removeItem(K_USER); render(); }

  function _authErr(msg) {
    const el = _el('dashAuthErr');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  // ---- Entry points ----
  function render()    { if (!_authed()) { _showGate(); } else { _boot(); } }
  function renderAll() {
    // Keep the invoice badge in sync regardless of which view is active
    const badge = _el('navInvCount');
    if (badge && Storage.getInvoices) badge.textContent = Storage.getInvoices().length;
    render();
  }

  function _showGate() {
    _el('dashGate').style.display = 'flex';
    _el('dashMain').style.display = 'none';
    const inp = _el('dashUser'); if (inp) inp.value = '';
    const err = _el('dashAuthErr'); if (err) err.style.display = 'none';
  }

  function _boot() {
    _el('dashGate').style.display = 'none';
    _el('dashMain').style.display = 'block';
    const u = _el('dashWho'); if (u) u.textContent = _user();
    _go(_tab || 'resumen');
  }

  // ---- Tab routing ----
  function tab(name) { _tab = name; _go(name); }

  function _go(name) {
    document.querySelectorAll('.dtab-panel').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.dtab-btn').forEach(b => b.classList.remove('active'));
    const panel = _el('dp-' + name); if (panel) panel.style.display = 'block';
    const btn   = document.querySelector(`.dtab-btn[data-t="${name}"]`); if (btn) btn.classList.add('active');
    const map   = { resumen: _rResumen, features: _rFeatures, bugs: _rBugs, ideas: _rIdeas,
                    notas: _rNotas, feedback: _rFeedback, roadmap: _rRoadmap, versiones: _rVersiones };
    if (map[name]) map[name]();
  }

  // ---- Render helpers ----
  function _esc(s)         { return Utils.escapeHtml(String(s ?? '')); }
  function _opts(arr, sel) { return arr.map(v => `<option${v === sel ? ' selected' : ''}>${_esc(v)}</option>`).join(''); }
  function _pill(lbl, cls) { return `<span class="pill ${cls}" style="font-size:10px"><span class="pill-dot"></span>${_esc(lbl)}</span>`; }
  function _fmt(d)         { return d ? Utils.fmtDate(d) : '—'; }

  const PRIO_CLS  = { Alta: 'red', Media: 'warn', Baja: 'blue' };
  const F_CLS     = { Finalizado: 'ok', 'En desarrollo': 'warn', 'En pruebas': 'blue', Pendiente: 'gray' };
  const B_CLS     = { Abierto: 'red', 'En revisión': 'warn', Solucionado: 'ok' };
  const I_CLS     = { Pendiente: 'gray', Evaluando: 'warn', Aprobada: 'blue', Implementada: 'ok', Rechazada: 'red' };
  const FB_CLS    = { Pendiente: 'gray', 'En revisión': 'warn', Procesado: 'ok' };

  // ============================================================
  // SECTION 1 — RESUMEN
  // ============================================================
  function _rResumen() {
    const feats    = _list(KEYS.features);
    const bugs     = _list(KEYS.bugs);
    const ideas    = _list(KEYS.ideas);
    const vers     = _list(KEYS.versions);
    const cfg      = _get(KEYS.config, {});
    const total    = feats.length;
    const done     = feats.filter(f => f.estado === 'Finalizado').length;
    const inDev    = feats.filter(f => f.estado === 'En desarrollo').length;
    const pend     = feats.filter(f => f.estado === 'Pendiente').length;
    const pct      = total ? Math.round(done / total * 100) : 0;
    const openBugs = bugs.filter(b => b.estado !== 'Solucionado').length;
    const solBugs  = bugs.filter(b => b.estado === 'Solucionado').length;
    const mods     = [...new Set(feats.map(f => f.modulo).filter(Boolean))].length;
    const lastVer  = vers.length ? vers.slice().sort((a, b) => b.fecha.localeCompare(a.fecha))[0] : null;

    _el('dp-resumen').innerHTML = `
      <div class="d-head">
        <div>
          <h2 class="d-h2">Centro de Gestión del Proyecto</h2>
          <p class="d-sub">Panel privado · Usuario: <b>${_esc(_user())}</b></p>
        </div>
        <div class="d-meta-row">
          <div class="d-meta-chip"><span>Versión</span><b>${_esc(cfg.version || '—')}</b></div>
          <div class="d-meta-chip"><span>Actualización</span><b>${cfg.ultimaActualizacion ? _fmt(cfg.ultimaActualizacion) : '—'}</b></div>
          <div class="d-meta-chip"><span>Próximo objetivo</span><b>${_esc(cfg.proximoObjetivo || '—')}</b></div>
          ${lastVer ? `<div class="d-meta-chip"><span>Última versión</span><b>v${_esc(lastVer.version)}</b></div>` : ''}
        </div>
      </div>

      <div class="d-progress-card">
        <div class="d-progress-top">
          <span>Avance General del Proyecto</span>
          <b style="font-size:22px;color:#2563eb">${pct}%</b>
        </div>
        <div class="d-pbar"><div class="d-pfill" style="width:${pct}%"></div></div>
        <div style="font-size:12px;color:#64748b;margin-top:6px">${done} de ${total} funcionalidades completadas</div>
      </div>

      <div class="d-kpi-grid">
        ${_kpi('Módulos', mods, '#4f46e5', '#eef2ff')}
        ${_kpi('Funcionalidades', total, '#2563eb', '#eff6ff')}
        ${_kpi('Finalizadas', done, '#15803d', '#f0fdf4')}
        ${_kpi('En desarrollo', inDev, '#b45309', '#fffbeb')}
        ${_kpi('Pendientes', pend, '#6b7280', '#f9fafb')}
        ${_kpi('Errores abiertos', openBugs, openBugs > 0 ? '#dc2626' : '#15803d', openBugs > 0 ? '#fef2f2' : '#f0fdf4')}
        ${_kpi('Errores resueltos', solBugs, '#15803d', '#f0fdf4')}
        ${_kpi('Ideas pendientes', ideas.filter(i => i.estado === 'Pendiente').length, '#7c3aed', '#faf5ff')}
      </div>

      <div class="card" style="margin-top:20px">
        <div class="card-head"><h3>Configuración del proyecto</h3></div>
        <div class="card-body">
          <div class="field-row3">
            <div class="field">
              <label class="f-label">Versión actual</label>
              <input class="input" id="cfgVer" value="${_esc(cfg.version || '')}">
            </div>
            <div class="field">
              <label class="f-label">Última actualización</label>
              <input class="input" type="date" id="cfgDate" value="${cfg.ultimaActualizacion || ''}">
            </div>
            <div class="field">
              <label class="f-label">Próximo objetivo</label>
              <input class="input" id="cfgObj" value="${_esc(cfg.proximoObjetivo || '')}">
            </div>
          </div>
          <button class="btn btn-accent" style="margin-top:12px" onclick="Dashboard.saveConfig()">Guardar configuración</button>
        </div>
      </div>`;
  }

  function _kpi(label, val, color, bg) {
    return `<div class="d-kpi" style="background:${bg}">
      <div class="d-kpi-val" style="color:${color}">${val}</div>
      <div class="d-kpi-lbl">${label}</div>
    </div>`;
  }

  function saveConfig() {
    _set(KEYS.config, {
      version:             (_el('cfgVer')?.value || '').trim(),
      ultimaActualizacion: _el('cfgDate')?.value || '',
      proximoObjetivo:     (_el('cfgObj')?.value || '').trim(),
    });
    UI.toast('Configuración guardada', 'ok');
    _rResumen();
  }

  // ---- Generic modal helper ----
  function _openModal(title, body, onSave) {
    _el('dashModalTitle').textContent = title;
    _el('dashModalBody').innerHTML    = body;
    _el('dashModalSave').onclick      = onSave;
    UI.openModal('dashModal');
  }

  // ============================================================
  // SECTION 2 — FUNCIONALIDADES
  // ============================================================
  function _rFeatures() {
    const list = _list(KEYS.features);
    const rows = list.length
      ? list.map(f => `<tr>
          <td>${_pill(f.prioridad, PRIO_CLS[f.prioridad] || 'gray')}</td>
          <td>${_esc(f.modulo || '—')}</td>
          <td><b>${_esc(f.funcionalidad)}</b>${f.descripcion ? `<br><span class="muted" style="font-size:11px">${_esc(f.descripcion)}</span>` : ''}</td>
          <td>${_pill(f.estado, F_CLS[f.estado] || 'gray')}</td>
          <td>${_esc(f.responsable || '—')}</td>
          <td style="white-space:nowrap">${_fmt(f.fechaEstimada)}</td>
          <td style="white-space:nowrap">${_fmt(f.fechaFinal)}</td>
          <td class="d-actions">
            <button class="btn btn-ghost btn-sm" onclick="Dashboard.editFeature('${f.id}')">Editar</button>
            <button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="Dashboard.delFeature('${f.id}')">✕</button>
          </td>
        </tr>`).join('')
      : `<tr><td colspan="8"><div class="t-empty">Sin funcionalidades registradas.</div></td></tr>`;

    _el('dp-features').innerHTML = `
      <div class="d-head">
        <div><h2 class="d-h2">Funcionalidades</h2><p class="d-sub">${list.length} total · ${list.filter(f => f.estado === 'Finalizado').length} finalizadas</p></div>
        <button class="btn btn-accent" onclick="Dashboard.newFeature()">+ Nueva</button>
      </div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Prio</th><th>Módulo</th><th>Funcionalidad</th><th>Estado</th><th>Responsable</th><th>Est. fin</th><th>Fin real</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function _featForm(f) {
    return `
      <div class="field-row3">
        <div class="field"><label class="f-label">Módulo</label>
          <select class="input" id="fMod"><option value="">—</option>${_opts(MODULOS, f?.modulo)}</select></div>
        <div class="field"><label class="f-label">Estado</label>
          <select class="input" id="fEst">${_opts(F_ESTADOS, f?.estado || 'Pendiente')}</select></div>
        <div class="field"><label class="f-label">Prioridad</label>
          <select class="input" id="fPrio">${_opts(PRIOS, f?.prioridad || 'Media')}</select></div>
      </div>
      <div class="field"><label class="f-label">Funcionalidad *</label>
        <input class="input" id="fNom" value="${_esc(f?.funcionalidad || '')}"></div>
      <div class="field"><label class="f-label">Descripción</label>
        <textarea class="input" id="fDesc" rows="2">${_esc(f?.descripcion || '')}</textarea></div>
      <div class="field-row3">
        <div class="field"><label class="f-label">Responsable</label>
          <input class="input" id="fResp" value="${_esc(f?.responsable || '')}"></div>
        <div class="field"><label class="f-label">Fecha estimada</label>
          <input class="input" type="date" id="fFEst" value="${f?.fechaEstimada || ''}"></div>
        <div class="field"><label class="f-label">Fecha real</label>
          <input class="input" type="date" id="fFFin" value="${f?.fechaFinal || ''}"></div>
      </div>
      <div class="field"><label class="f-label">Observaciones</label>
        <textarea class="input" id="fObs" rows="2">${_esc(f?.observaciones || '')}</textarea></div>`;
  }

  function newFeature()    { _edit = { key: KEYS.features, id: null }; _openModal('Nueva funcionalidad', _featForm(null), _saveFeature); }
  function editFeature(id) { _edit = { key: KEYS.features, id };       _openModal('Editar funcionalidad', _featForm(_byId(KEYS.features, id)), _saveFeature); }

  function _saveFeature() {
    const existing = _edit?.id ? _byId(KEYS.features, _edit.id) : null;
    const item = {
      id:            _edit?.id || _uid(),
      modulo:        _el('fMod').value,
      funcionalidad: _el('fNom').value.trim(),
      descripcion:   _el('fDesc').value.trim(),
      prioridad:     _el('fPrio').value,
      estado:        _el('fEst').value,
      responsable:   _el('fResp').value.trim(),
      fechaCreacion: existing?.fechaCreacion || _today(),
      fechaEstimada: _el('fFEst').value,
      fechaFinal:    _el('fFFin').value,
      observaciones: _el('fObs').value.trim(),
    };
    if (!item.funcionalidad) { UI.toast('Nombre requerido', 'err'); return; }
    _upsert(KEYS.features, item);
    UI.closeModal('dashModal');
    UI.toast('Guardado', 'ok');
    _rFeatures();
  }

  function delFeature(id) {
    UI.confirm('Eliminar funcionalidad', '¿Confirmar?', () => { _del(KEYS.features, id); _rFeatures(); UI.toast('Eliminado', 'ok'); });
  }

  // ============================================================
  // SECTION 3 — ERRORES
  // ============================================================
  function _rBugs() {
    const list = _list(KEYS.bugs);
    const rows = list.length
      ? list.map(b => `<tr>
          <td style="white-space:nowrap">${_fmt(b.fecha)}</td>
          <td>${_esc(b.modulo || '—')}</td>
          <td>${_esc(b.descripcion || '')}</td>
          <td>${_pill(b.prioridad, PRIO_CLS[b.prioridad] || 'gray')}</td>
          <td>${_pill(b.estado, B_CLS[b.estado] || 'gray')}</td>
          <td>${_esc(b.responsable || '—')}</td>
          <td class="d-actions">
            <button class="btn btn-ghost btn-sm" onclick="Dashboard.editBug('${b.id}')">Editar</button>
            <button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="Dashboard.delBug('${b.id}')">✕</button>
          </td>
        </tr>`).join('')
      : `<tr><td colspan="7"><div class="t-empty">Sin errores registrados.</div></td></tr>`;

    _el('dp-bugs').innerHTML = `
      <div class="d-head">
        <div><h2 class="d-h2">Registro de Errores</h2><p class="d-sub">${list.filter(b => b.estado !== 'Solucionado').length} abiertos · ${list.filter(b => b.estado === 'Solucionado').length} resueltos</p></div>
        <button class="btn btn-accent" onclick="Dashboard.newBug()">+ Nuevo error</button>
      </div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Fecha</th><th>Módulo</th><th>Descripción</th><th>Prioridad</th><th>Estado</th><th>Responsable</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function _bugForm(b) {
    return `
      <div class="field-row3">
        <div class="field"><label class="f-label">Módulo</label>
          <select class="input" id="bMod"><option value="">—</option>${_opts(MODULOS, b?.modulo)}</select></div>
        <div class="field"><label class="f-label">Estado</label>
          <select class="input" id="bEst">${_opts(B_ESTADOS, b?.estado || 'Abierto')}</select></div>
        <div class="field"><label class="f-label">Prioridad</label>
          <select class="input" id="bPrio">${_opts(PRIOS, b?.prioridad || 'Media')}</select></div>
      </div>
      <div class="field"><label class="f-label">Descripción *</label>
        <textarea class="input" id="bDesc" rows="3">${_esc(b?.descripcion || '')}</textarea></div>
      <div class="field-row3">
        <div class="field"><label class="f-label">Responsable</label>
          <input class="input" id="bResp" value="${_esc(b?.responsable || '')}"></div>
        <div class="field"><label class="f-label">Fecha</label>
          <input class="input" type="date" id="bFecha" value="${b?.fecha || _today()}"></div>
        <div class="field"><label class="f-label">Fecha solución</label>
          <input class="input" type="date" id="bFSol" value="${b?.fechaSolucion || ''}"></div>
      </div>
      <div class="field"><label class="f-label">Solución aplicada</label>
        <textarea class="input" id="bSol" rows="2">${_esc(b?.solucion || '')}</textarea></div>`;
  }

  function newBug()    { _edit = { key: KEYS.bugs, id: null }; _openModal('Nuevo error', _bugForm(null), _saveBug); }
  function editBug(id) { _edit = { key: KEYS.bugs, id };       _openModal('Editar error', _bugForm(_byId(KEYS.bugs, id)), _saveBug); }

  function _saveBug() {
    const item = {
      id:            _edit?.id || _uid(),
      fecha:         _el('bFecha').value || _today(),
      modulo:        _el('bMod').value,
      descripcion:   _el('bDesc').value.trim(),
      prioridad:     _el('bPrio').value,
      estado:        _el('bEst').value,
      responsable:   _el('bResp').value.trim(),
      solucion:      _el('bSol').value.trim(),
      fechaSolucion: _el('bFSol').value,
    };
    if (!item.descripcion) { UI.toast('Descripción requerida', 'err'); return; }
    _upsert(KEYS.bugs, item);
    UI.closeModal('dashModal');
    UI.toast('Guardado', 'ok');
    _rBugs();
  }

  function delBug(id) {
    UI.confirm('Eliminar error', '¿Confirmar?', () => { _del(KEYS.bugs, id); _rBugs(); UI.toast('Eliminado', 'ok'); });
  }

  // ============================================================
  // SECTION 4 — IDEAS
  // ============================================================
  function _rIdeas() {
    const list = _list(KEYS.ideas);
    const rows = list.length
      ? list.map(i => `<tr>
          <td><b>${_esc(i.titulo || '')}</b>${i.descripcion ? `<br><span class="muted" style="font-size:11px">${_esc(i.descripcion)}</span>` : ''}</td>
          <td>${_pill(i.prioridad, PRIO_CLS[i.prioridad] || 'gray')}</td>
          <td>${_pill(i.estado, I_CLS[i.estado] || 'gray')}</td>
          <td style="white-space:nowrap">${_fmt(i.fecha)}</td>
          <td>${_esc(i.responsable || '—')}</td>
          <td class="d-actions">
            <button class="btn btn-ghost btn-sm" onclick="Dashboard.editIdea('${i.id}')">Editar</button>
            <button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="Dashboard.delIdea('${i.id}')">✕</button>
          </td>
        </tr>`).join('')
      : `<tr><td colspan="6"><div class="t-empty">Sin ideas registradas.</div></td></tr>`;

    _el('dp-ideas').innerHTML = `
      <div class="d-head">
        <div><h2 class="d-h2">Ideas y Mejoras</h2><p class="d-sub">${list.length} ideas · ${list.filter(i => i.estado === 'Pendiente').length} pendientes</p></div>
        <button class="btn btn-accent" onclick="Dashboard.newIdea()">+ Nueva idea</button>
      </div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Título / Descripción</th><th>Prioridad</th><th>Estado</th><th>Fecha</th><th>Responsable</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function _ideaForm(i) {
    return `
      <div class="field"><label class="f-label">Título *</label>
        <input class="input" id="iTitle" value="${_esc(i?.titulo || '')}"></div>
      <div class="field"><label class="f-label">Descripción</label>
        <textarea class="input" id="iDesc" rows="3">${_esc(i?.descripcion || '')}</textarea></div>
      <div class="field-row3">
        <div class="field"><label class="f-label">Estado</label>
          <select class="input" id="iEst">${_opts(I_ESTADOS, i?.estado || 'Pendiente')}</select></div>
        <div class="field"><label class="f-label">Prioridad</label>
          <select class="input" id="iPrio">${_opts(PRIOS, i?.prioridad || 'Media')}</select></div>
        <div class="field"><label class="f-label">Responsable</label>
          <input class="input" id="iResp" value="${_esc(i?.responsable || '')}"></div>
      </div>
      <div class="field"><label class="f-label">Comentarios</label>
        <textarea class="input" id="iComm" rows="2">${_esc(i?.comentarios || '')}</textarea></div>`;
  }

  function newIdea()    { _edit = { key: KEYS.ideas, id: null }; _openModal('Nueva idea', _ideaForm(null), _saveIdea); }
  function editIdea(id) { _edit = { key: KEYS.ideas, id };       _openModal('Editar idea', _ideaForm(_byId(KEYS.ideas, id)), _saveIdea); }

  function _saveIdea() {
    const existing = _edit?.id ? _byId(KEYS.ideas, _edit.id) : null;
    const item = {
      id:          _edit?.id || _uid(),
      titulo:      _el('iTitle').value.trim(),
      descripcion: _el('iDesc').value.trim(),
      prioridad:   _el('iPrio').value,
      estado:      _el('iEst').value,
      fecha:       existing?.fecha || _today(),
      responsable: _el('iResp').value.trim(),
      comentarios: _el('iComm').value.trim(),
    };
    if (!item.titulo) { UI.toast('Título requerido', 'err'); return; }
    _upsert(KEYS.ideas, item);
    UI.closeModal('dashModal');
    UI.toast('Guardado', 'ok');
    _rIdeas();
  }

  function delIdea(id) {
    UI.confirm('Eliminar idea', '¿Confirmar?', () => { _del(KEYS.ideas, id); _rIdeas(); UI.toast('Eliminado', 'ok'); });
  }

  // ============================================================
  // SECTION 5 — NOTAS
  // ============================================================
  function _rNotas() {
    const list = _list(KEYS.notes).slice().sort((a, b) => (b.fechaMod || '').localeCompare(a.fechaMod || ''));
    const cards = list.length
      ? list.map(n => `<div class="d-note">
          <div class="d-note-head">
            <b>${_esc(n.titulo || 'Sin título')}</b>
            <span class="muted" style="font-size:11px;white-space:nowrap">${_fmt(n.fechaMod)}</span>
          </div>
          <div class="d-note-body">${_esc(n.contenido || '')}</div>
          <div class="d-actions" style="margin-top:10px">
            <button class="btn btn-ghost btn-sm" onclick="Dashboard.editNota('${n.id}')">Editar</button>
            <button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="Dashboard.delNota('${n.id}')">Eliminar</button>
          </div>
        </div>`).join('')
      : `<div class="t-empty">Sin notas registradas.</div>`;

    _el('dp-notas').innerHTML = `
      <div class="d-head">
        <div><h2 class="d-h2">Notas del Proyecto</h2><p class="d-sub">${list.length} notas</p></div>
        <button class="btn btn-accent" onclick="Dashboard.newNota()">+ Nueva nota</button>
      </div>
      <div class="d-notes-grid">${cards}</div>`;
  }

  function _notaForm(n) {
    return `
      <div class="field"><label class="f-label">Título</label>
        <input class="input" id="nTitle" value="${_esc(n?.titulo || '')}"></div>
      <div class="field"><label class="f-label">Contenido</label>
        <textarea class="input" id="nCont" rows="7">${_esc(n?.contenido || '')}</textarea></div>`;
  }

  function newNota()    { _edit = { key: KEYS.notes, id: null }; _openModal('Nueva nota', _notaForm(null), _saveNota); }
  function editNota(id) { _edit = { key: KEYS.notes, id };       _openModal('Editar nota', _notaForm(_byId(KEYS.notes, id)), _saveNota); }

  function _saveNota() {
    const existing = _edit?.id ? _byId(KEYS.notes, _edit.id) : null;
    const item = {
      id:       _edit?.id || _uid(),
      titulo:   _el('nTitle').value.trim(),
      contenido: _el('nCont').value.trim(),
      fechaCre: existing?.fechaCre || _today(),
      fechaMod: _today(),
    };
    _upsert(KEYS.notes, item);
    UI.closeModal('dashModal');
    UI.toast('Nota guardada', 'ok');
    _rNotas();
  }

  function delNota(id) {
    UI.confirm('Eliminar nota', '¿Confirmar?', () => { _del(KEYS.notes, id); _rNotas(); UI.toast('Eliminada', 'ok'); });
  }

  // ============================================================
  // SECTION 6 — FEEDBACK / OPINIONES
  // ============================================================
  function _rFeedback() {
    const list = _list(KEYS.feedback);
    const rows = list.length
      ? list.map(f => `<tr>
          <td>${_esc(f.usuario || '—')}</td>
          <td>${_esc(f.modulo || '—')}</td>
          <td>${_esc(f.comentario || '')}</td>
          <td style="white-space:nowrap">${_fmt(f.fecha)}</td>
          <td>${_pill(f.prioridad, PRIO_CLS[f.prioridad] || 'gray')}</td>
          <td>${_pill(f.estado, FB_CLS[f.estado] || 'gray')}</td>
          <td class="d-actions">
            <button class="btn btn-ghost btn-sm" onclick="Dashboard.editFeedback('${f.id}')">Editar</button>
            <button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="Dashboard.delFeedback('${f.id}')">✕</button>
          </td>
        </tr>`).join('')
      : `<tr><td colspan="7"><div class="t-empty">Sin opiniones registradas.</div></td></tr>`;

    _el('dp-feedback').innerHTML = `
      <div class="d-head">
        <div><h2 class="d-h2">Opiniones de Usuarios</h2><p class="d-sub">${list.length} opiniones</p></div>
        <button class="btn btn-accent" onclick="Dashboard.newFeedback()">+ Nueva opinión</button>
      </div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th>Usuario</th><th>Módulo</th><th>Comentario</th><th>Fecha</th><th>Prioridad</th><th>Estado</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function _fbForm(f) {
    return `
      <div class="field-row3">
        <div class="field"><label class="f-label">Usuario</label>
          <input class="input" id="fbUser" value="${_esc(f?.usuario || '')}"></div>
        <div class="field"><label class="f-label">Módulo</label>
          <select class="input" id="fbMod"><option value="">—</option>${_opts(MODULOS, f?.modulo)}</select></div>
        <div class="field"><label class="f-label">Fecha</label>
          <input class="input" type="date" id="fbFecha" value="${f?.fecha || _today()}"></div>
      </div>
      <div class="field"><label class="f-label">Comentario *</label>
        <textarea class="input" id="fbComm" rows="3">${_esc(f?.comentario || '')}</textarea></div>
      <div class="field-row3">
        <div class="field"><label class="f-label">Prioridad</label>
          <select class="input" id="fbPrio">${_opts(PRIOS, f?.prioridad || 'Media')}</select></div>
        <div class="field"><label class="f-label">Estado</label>
          <select class="input" id="fbEst">${_opts(FB_ESTADOS, f?.estado || 'Pendiente')}</select></div>
      </div>`;
  }

  function newFeedback()    { _edit = { key: KEYS.feedback, id: null }; _openModal('Nueva opinión', _fbForm(null), _saveFeedback); }
  function editFeedback(id) { _edit = { key: KEYS.feedback, id };       _openModal('Editar opinión', _fbForm(_byId(KEYS.feedback, id)), _saveFeedback); }

  function _saveFeedback() {
    const item = {
      id:         _edit?.id || _uid(),
      usuario:    _el('fbUser').value.trim(),
      modulo:     _el('fbMod').value,
      comentario: _el('fbComm').value.trim(),
      fecha:      _el('fbFecha').value || _today(),
      prioridad:  _el('fbPrio').value,
      estado:     _el('fbEst').value,
    };
    if (!item.comentario) { UI.toast('Comentario requerido', 'err'); return; }
    _upsert(KEYS.feedback, item);
    UI.closeModal('dashModal');
    UI.toast('Guardado', 'ok');
    _rFeedback();
  }

  function delFeedback(id) {
    UI.confirm('Eliminar opinión', '¿Confirmar?', () => { _del(KEYS.feedback, id); _rFeedback(); UI.toast('Eliminado', 'ok'); });
  }

  // ============================================================
  // SECTION 7 — ROADMAP
  // ============================================================
  function _rRoadmap() {
    const feats = _list(KEYS.features);
    const cards = MODULOS.map(phase => {
      const pf     = feats.filter(f => f.modulo === phase);
      const total  = pf.length;
      const done   = pf.filter(f => f.estado === 'Finalizado').length;
      const inDev  = pf.filter(f => f.estado === 'En desarrollo').length;
      const pct    = total ? Math.round(done / total * 100) : 0;
      const status = total === 0 ? 'Sin planificar' : pct === 100 ? 'Completado' : inDev > 0 ? 'En desarrollo' : 'Pendiente';
      const sCls   = { 'Sin planificar': 'gray', Completado: 'ok', 'En desarrollo': 'warn', Pendiente: 'blue' }[status];
      return `<div class="d-rm-card">
        <div class="d-rm-top">
          <div>
            <div class="d-rm-name">${_esc(phase)}</div>
            ${_pill(status, sCls)}
          </div>
          <div class="d-rm-pct">${pct}%</div>
        </div>
        <div class="d-pbar" style="margin-top:10px"><div class="d-pfill" style="width:${pct}%"></div></div>
        <div style="font-size:11.5px;color:#64748b;margin-top:6px">${done}/${total} funcionalidades · ${inDev} en desarrollo</div>
      </div>`;
    }).join('');

    _el('dp-roadmap').innerHTML = `
      <div class="d-head">
        <div><h2 class="d-h2">Roadmap del Proyecto</h2><p class="d-sub">Avance calculado automáticamente desde las funcionalidades</p></div>
      </div>
      <div class="d-rm-grid">${cards}</div>`;
  }

  // ============================================================
  // SECTION 8 — VERSIONES
  // ============================================================
  function _rVersiones() {
    const list = _list(KEYS.versions).slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
    const cards = list.length
      ? list.map(v => `<div class="d-ver-card">
          <div class="d-ver-head">
            <span class="d-ver-tag">v${_esc(v.version)}</span>
            <span class="muted" style="font-size:12px">${_fmt(v.fecha)} · ${_esc(v.responsable || '')}</span>
            <div class="d-actions" style="margin-left:auto">
              <button class="btn btn-ghost btn-sm" onclick="Dashboard.editVersion('${v.id}')">Editar</button>
              <button class="btn btn-ghost btn-sm" style="color:#ef4444" onclick="Dashboard.delVersion('${v.id}')">✕</button>
            </div>
          </div>
          ${v.funcionalidades ? `<div class="d-ver-row"><b>Funcionalidades:</b> ${_esc(v.funcionalidades)}</div>` : ''}
          ${v.errores  ? `<div class="d-ver-row"><b>Errores corregidos:</b> ${_esc(v.errores)}</div>` : ''}
          ${v.cambios  ? `<div class="d-ver-row"><b>Cambios:</b> ${_esc(v.cambios)}</div>` : ''}
        </div>`).join('')
      : `<div class="t-empty">Sin versiones registradas.</div>`;

    _el('dp-versiones').innerHTML = `
      <div class="d-head">
        <div><h2 class="d-h2">Historial de Versiones</h2><p class="d-sub">${list.length} versiones registradas</p></div>
        <button class="btn btn-accent" onclick="Dashboard.newVersion()">+ Nueva versión</button>
      </div>
      <div class="d-ver-list">${cards}</div>`;
  }

  function _verForm(v) {
    return `
      <div class="field-row3">
        <div class="field"><label class="f-label">Número de versión *</label>
          <input class="input" id="vNum" placeholder="1.0.0" value="${_esc(v?.version || '')}"></div>
        <div class="field"><label class="f-label">Fecha</label>
          <input class="input" type="date" id="vFecha" value="${v?.fecha || _today()}"></div>
        <div class="field"><label class="f-label">Responsable</label>
          <input class="input" id="vResp" value="${_esc(v?.responsable || '')}"></div>
      </div>
      <div class="field"><label class="f-label">Funcionalidades agregadas</label>
        <textarea class="input" id="vFuncs" rows="2">${_esc(v?.funcionalidades || '')}</textarea></div>
      <div class="field"><label class="f-label">Errores corregidos</label>
        <textarea class="input" id="vErrs" rows="2">${_esc(v?.errores || '')}</textarea></div>
      <div class="field"><label class="f-label">Otros cambios</label>
        <textarea class="input" id="vCambios" rows="2">${_esc(v?.cambios || '')}</textarea></div>`;
  }

  function newVersion()    { _edit = { key: KEYS.versions, id: null }; _openModal('Nueva versión', _verForm(null), _saveVersion); }
  function editVersion(id) { _edit = { key: KEYS.versions, id };       _openModal('Editar versión', _verForm(_byId(KEYS.versions, id)), _saveVersion); }

  function _saveVersion() {
    const item = {
      id:              _edit?.id || _uid(),
      version:         _el('vNum').value.trim(),
      fecha:           _el('vFecha').value || _today(),
      responsable:     _el('vResp').value.trim(),
      funcionalidades: _el('vFuncs').value.trim(),
      errores:         _el('vErrs').value.trim(),
      cambios:         _el('vCambios').value.trim(),
    };
    if (!item.version) { UI.toast('Número de versión requerido', 'err'); return; }
    _upsert(KEYS.versions, item);
    UI.closeModal('dashModal');
    UI.toast('Guardado', 'ok');
    _rVersiones();
  }

  function delVersion(id) {
    UI.confirm('Eliminar versión', '¿Confirmar?', () => { _del(KEYS.versions, id); _rVersiones(); UI.toast('Eliminada', 'ok'); });
  }

  // ---- Keep renderPulse for sidebar (unchanged) ----
  function renderPulse() {
    const staged = Invoices.getStaged();
    const neg    = staged.filter(r => r.status === 'neg').length;
    const pos    = staged.filter(r => r.status === 'pos').length;
    const total  = neg + pos;
    const pct    = total ? (neg / total * 100) : 50;
    document.getElementById('balancePulse').style.setProperty('--neg-pct', pct.toFixed(0) + '%');
    document.getElementById('pulseNeg').textContent = neg;
    document.getElementById('pulsePos').textContent = pos;
  }

  return {
    render, renderAll, renderPulse, tab,
    auth, logout, saveConfig,
    newFeature, editFeature, delFeature,
    newBug,      editBug,     delBug,
    newIdea,     editIdea,    delIdea,
    newNota,     editNota,    delNota,
    newFeedback, editFeedback, delFeedback,
    newVersion,  editVersion,  delVersion,
  };
})();
