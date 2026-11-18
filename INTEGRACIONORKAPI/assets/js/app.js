/* ============================================================
   UI · H (formato) · Permisos · App — arranque, navegación, contexto semanal y guardado seguro
   ============================================================ */
const UI = (() => {
  let confirmCallback = null, _pinCallback = null, _okGen = null;

  function openModal(id){ document.getElementById(id).classList.add('open'); }
  function closeModal(id){ document.getElementById(id).classList.remove('open'); }

  function toast(msg, type){
    const host = document.getElementById('toast-host');
    const el = document.createElement('div');
    el.className = 'toast' + (type==='ok' ? ' ok' : type==='err' ? ' err' : '');
    el.innerHTML = (type==='ok' ? '<b>✓</b>' : type==='err' ? '<b>✕</b>' : '') + `<span>${Utils.escapeHtml(msg)}</span>`;
    host.appendChild(el);
    setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .25s'; setTimeout(()=>el.remove(),250); }, type==='err' ? 6500 : 2800);
  }

  function confirm(title, msg, onOk){
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').innerHTML = msg;
    confirmCallback = onOk;
    openModal('modalConfirm');
  }
  function runConfirm(){ const cb = confirmCallback; confirmCallback = null; closeModal('modalConfirm'); if(cb) cb(); }

  function requirePin(callback){
    _pinCallback = callback;
    const input = document.getElementById('adminPinInput');
    if(input) input.value = '';
    openModal('modalAdminPin');
    setTimeout(()=>input&&input.focus(), 100);
  }
  function closeAdminPin(){ _pinCallback = null; closeModal('modalAdminPin'); }
  function confirmAdminPin(){
    const pin = (document.getElementById('adminPinInput')?.value || '').trim();
    if(pin !== String(Storage.getConfig().adminPin || '1234')){ toast('PIN incorrecto', 'err'); return; }
    const cb = _pinCallback;
    closeAdminPin();
    if(cb) cb();
  }

  // Modal genérico: titulo, cuerpo (HTML), ancho (px), botones [{t, c (clase), f (función)}]
  function abrir(o){
    document.getElementById('genTitulo').textContent = o.titulo || '';
    document.getElementById('genSub').textContent = o.sub || '';
    document.getElementById('genCuerpo').innerHTML = o.cuerpo || '';
    document.getElementById('genDialogo').style.maxWidth = (o.ancho || 640) + 'px';
    const pie = document.getElementById('genPie'); pie.innerHTML = '';
    (o.botones || [{ t:'Cerrar', c:'btn-ghost', f:cerrar }]).forEach(b => {
      const el = document.createElement('button'); el.className = 'btn ' + (b.c || 'btn-ghost'); el.textContent = b.t; if(b.id) el.id = b.id;
      el.addEventListener('click', () => b.f && b.f()); pie.appendChild(el);
    });
    openModal('modalGen');
  }
  function cerrar(){ closeModal('modalGen'); _okGen = null; }

  // Formulario: campos [{id,label,tipo:'text'|'number'|'date'|'select'|'textarea',valor,opciones:[[v,t]],ayuda,req,dis}]; onOk(vals) → true/Promise<true> para cerrar
  function formulario(o){
    const html = o.campos.map(c => {
      const base = `id="gf_${c.id}" class="input"${c.dis ? ' disabled' : ''}`;
      let ctl;
      if(c.tipo === 'select') ctl = `<select ${base}>` + c.opciones.map(op => `<option value="${Utils.escapeHtml(op[0])}"${String(op[0]) === String(c.valor) ? ' selected' : ''}>${Utils.escapeHtml(op[1])}</option>`).join('') + '</select>';
      else if(c.tipo === 'textarea') ctl = `<textarea ${base} rows="3">${Utils.escapeHtml(c.valor || '')}</textarea>`;
      else ctl = `<input ${base} type="${c.tipo || 'text'}"${c.tipo === 'number' ? ' step="0.01"' : ''} value="${Utils.escapeHtml(c.valor === null || c.valor === undefined ? '' : c.valor)}">`;
      return `<div class="field"><label class="f-label">${Utils.escapeHtml(c.label)}${c.req ? ' *' : ''}</label>${ctl}${c.ayuda ? `<p class="hint">${Utils.escapeHtml(c.ayuda)}</p>` : ''}</div>`;
    }).join('');
    _okGen = async () => {
      const vals = {};
      for(const c of o.campos){
        const el = document.getElementById('gf_' + c.id); const v = el ? el.value.trim() : '';
        if(c.req && v === ''){ toast('Completa el campo obligatorio: ' + c.label, 'err'); el && el.focus(); return; }
        vals[c.id] = v;
      }
      const cerrarOk = await o.onOk(vals);
      if(cerrarOk) cerrar();
    };
    abrir({ titulo:o.titulo, sub:o.sub, ancho:o.ancho || 520, cuerpo:(o.info ? `<p class="sub" style="margin-bottom:12px">${o.info}</p>` : '') + html,
      botones:[{ t:'Cancelar', c:'btn-ghost', f:cerrar }, { t:o.boton || 'Guardar', c:'btn-primary', f:() => _okGen && _okGen() }] });
  }

  return { openModal, closeModal, toast, confirm, runConfirm, requirePin, closeAdminPin, confirmAdminPin, abrir, cerrar, formulario };
})();
window.UI = UI;

/* ---------- formato ---------- */
const H = (() => {
  const esc = Utils.escapeHtml;
  const money = c => (c === null || c === undefined) ? '<span class="muted">—</span>' : `<span class="${c < 0 ? 'neg' : ''}">${Dinero.fmt(c)}</span>`;
  const tdm = (c, extra) => `<td class="r num${extra ? ' ' + extra : ''}">${money(c)}</td>`;
  const fecha = f => f ? Utils.fmtDate(f) : '—';
  const corte = s => s ? Utils.fmtDate(s.desde) + ' – ' + Utils.fmtDate(s.hasta) : '—';
  const PILL = { borrador:'gray', archivos_pendientes:'warn', en_validacion:'blue', procesado:'indigo', en_revision:'warn', aprobado:'ok', cerrado:'dark', reabierto:'red' };
  const pillEstado = e => `<span class="pill ${PILL[e] || 'gray'}"><span class="pill-dot"></span>${esc(SemanaORK.ESTADOS[e] || e)}</span>`;
  const NOMBRES = k => (SemanaORK.PRODUCTOS_DEF[k] || {}).nombre || k;
  return { esc, money, tdm, fecha, corte, pillEstado, NOMBRES };
})();
window.H = H;

const Permisos = (() => {
  const usuario = () => (window.Auth && Auth.getUser && Auth.getUser()) || {};
  // Aprobar, cerrar, reabrir, cambiar tasas/catálogo y mover el libro de créditos: Administrador + PIN
  function esAdmin(){ const u = usuario(); return String((u.role && u.role.label) || '').toLowerCase().indexOf('administrador') !== -1; }
  const nombre = () => { const u = usuario(); return u.name || u.email || '—'; };
  return { esAdmin, nombre, usuario };
})();
window.Permisos = Permisos;

const App = (() => {
  const Ctx = { anio: null, semanaId: null, sem: null };
  let _busy = false;

  // Acción protegida: exige rol Administrador y luego el PIN
  function protegida(fn){
    if(!Permisos.esAdmin()){ UI.toast('Esta acción requiere el rol Administrador', 'err'); return; }
    UI.requirePin(fn);
  }

  // Guardado seguro: trae lo último de Supabase, ejecuta fn (que escribe con Storage.*) y CONFIRMA que cada clave llegó
  // a Supabase; si algo falla revierte todo lo local y lo ya enviado. fn devuelve { claves:[...], valor } (o lanza Error para abortar).
  async function guardar(fn, opciones){
    const o = opciones || {};
    if(_busy){ UI.toast('Hay otra operación en curso; intenta de nuevo en un momento.', 'err'); return { ok:false, reason:'ocupado' }; }
    _busy = true;
    try{
      if(window.Sync){
        try{ await Sync.pull(); }catch(e){}
        if(o.semana){ try{ await Storage.cargarSemana(o.semana); }catch(e){} }
      }
      const universo = Storage.getBaseKeys().concat(o.semana ? [Storage.claveSemana(o.semana)] : []);
      const previos = {}; universo.forEach(k => { previos[k] = localStorage.getItem(k); });
      const restaurar = () => universo.forEach(k => { try{ if(previos[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, previos[k]); }catch(e){} });
      let r;
      try{ r = await fn(); }
      catch(e){ restaurar(); UI.toast(e.message || String(e), 'err'); return { ok:false, reason:'error', mensaje:e.message }; }
      const claves = (r && r.claves) || universo;
      for(const k of claves){
        const res = window.Sync ? await Sync.pushNow(k) : { ok:false, reason:'no-sync' };
        if(!res.ok){
          restaurar();
          for(const kk of claves){ if(window.Sync && previos[kk] !== null) await Sync.pushNow(kk); }
          UI.toast('No se pudo guardar en Supabase (' + res.reason + '). No se aplicó ningún cambio.', 'err');
          return { ok:false, reason:res.reason };
        }
      }
      return { ok:true, valor: r && r.valor };
    } finally { _busy = false; }
  }

  // ---------- contexto: año y semana activos (compartidos por todas las vistas) ----------
  async function setSemana(id){
    Ctx.semanaId = id || null;
    Ctx.sem = id ? await Storage.cargarSemana(id) : null;
    if(Ctx.sem) Ctx.anio = Ctx.sem.anio;
    try{ sessionStorage.setItem('orkCtx', JSON.stringify({ anio: Ctx.anio, semanaId: Ctx.semanaId })); }catch(e){}
    pintarContexto(); renderVista();
  }
  function recargarSemana(){ Ctx.sem = Ctx.semanaId ? Storage.getSemana(Ctx.semanaId) : null; }
  function setAnio(a){
    Ctx.anio = Number(a);
    const del = Storage.getIndice().filter(s => s.anio === Ctx.anio);
    setSemana(del.length ? del[del.length - 1].id : null);
  }

  function pintarContexto(){
    const idx = Storage.getIndice();
    const anios = [...new Set(idx.map(s => s.anio).concat([new Date().getFullYear(), Ctx.anio].filter(Boolean)))].sort((a, b) => b - a);
    const selA = document.getElementById('ctxAnio');
    selA.innerHTML = anios.map(a => `<option value="${a}"${a === Ctx.anio ? ' selected' : ''}>${a}</option>`).join('');
    const sems = idx.filter(s => s.anio === Ctx.anio);
    const selS = document.getElementById('ctxSemana');
    selS.innerHTML = (sems.length ? '' : '<option value="">(sin semanas procesadas)</option>')
      + sems.map(s => `<option value="${s.id}"${s.id === Ctx.semanaId ? ' selected' : ''}>Semana ${s.semana} · ${Utils.fmtDate(s.desde)} – ${Utils.fmtDate(s.hasta)}</option>`).join('');
    const st = document.getElementById('ctxEstado');
    st.innerHTML = Ctx.sem ? H.pillEstado(Ctx.sem.estado) + (Ctx.sem.version ? `<span class="sub" style="margin-left:6px">v${Ctx.sem.version}</span>` : '') : '<span class="sub">Sin semana seleccionada</span>';
  }

  // ---------- navegación ----------
  let _vista = 'dashboard', _arg = null;
  const VISTAS = {
    dashboard: () => Dashboard.render(), cargar: () => Cargar.render(), prod: a => Reportes.render(a), consolidado: () => Consolidado.render(),
    saldo: () => ConsolidadoSaldo.render(), control: () => Control.render(), historial: () => Historial.render(), config: () => Config.render()
  };
  function switchView(name, arg){
    _vista = name; _arg = arg || null;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + name)?.classList.add('active');
    document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name && (b.dataset.arg || null) === _arg));
    document.getElementById('ctxBar').style.display = (name === 'config') ? 'none' : '';
    renderVista();
    closeSidebar();
    window.scrollTo({ top:0 });
  }
  function renderVista(){ try{ VISTAS[_vista] && VISTAS[_vista](_arg); }catch(e){ console.error('render', _vista, e); UI.toast('Error al mostrar la pantalla: ' + e.message, 'err'); } }
  async function refrescar(){ recargarSemana(); pintarContexto(); renderVista(); }
  const vistaActual = () => _vista;

  function openSidebar(){ document.getElementById('sidebar')?.classList.add('open'); document.getElementById('scrim')?.classList.add('open'); }
  function closeSidebar(){ document.getElementById('sidebar')?.classList.remove('open'); document.getElementById('scrim')?.classList.remove('open'); }
  function toggleSidebarCollapse(){
    const sb = document.getElementById('sidebar'); if(!sb) return;
    const c = sb.classList.toggle('collapsed');
    try{ sessionStorage.setItem('orkSidebarCollapsed', c ? '1' : '0'); }catch(e){}
  }

  async function init(){
    Storage.init();
    try{ if(sessionStorage.getItem('orkSidebarCollapsed') === '1') document.getElementById('sidebar')?.classList.add('collapsed'); }catch(e){}
    document.getElementById('btnConfirmOk')?.addEventListener('click', UI.runConfirm);
    document.querySelectorAll('.modal-overlay').forEach(ov => ov.addEventListener('click', e => { if(e.target === ov && ov.id !== 'modalAdminPin' && ov.id !== 'modalGen') ov.classList.remove('open'); }));
    document.querySelectorAll('.nav-item[data-view]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view, b.dataset.arg)));
    document.querySelectorAll('[data-solo-admin]').forEach(el => { el.style.display = Permisos.esAdmin() ? '' : 'none'; });
    let guardado = {}; try{ guardado = JSON.parse(sessionStorage.getItem('orkCtx') || '{}'); }catch(e){}
    const idx0 = Storage.getIndice();
    Ctx.anio = guardado.anio || (idx0.length ? idx0[idx0.length - 1].anio : new Date().getFullYear());
    pintarContexto();
    switchView('dashboard');

    if(window.Sync){
      try{ await Sync.pull(); }catch(e){ console.warn('Sync.pull falló, se usa data local', e); }
      const idx = Storage.getIndice();
      const id = (guardado.semanaId && idx.some(s => s.id === guardado.semanaId)) ? guardado.semanaId : (idx.filter(s => s.anio === Ctx.anio).slice(-1)[0] || idx.slice(-1)[0] || {}).id;
      if(id && !Ctx.anio) Ctx.anio = idx.find(s => s.id === id).anio;
      await setSemana(id || null);
      Sync.subscribeRealtime(async key => { if(key === Storage.claveSemana(Ctx.semanaId) || Storage.getBaseKeys().indexOf(key) !== -1) await refrescar(); });
    }else{ const id = (idx0.slice(-1)[0] || {}).id; await setSemana(id || null); }
  }

  return { init, Ctx, protegida, guardar, setSemana, setAnio, recargarSemana, switchView, refrescar, renderVista, pintarContexto, vistaActual, openSidebar, closeSidebar, toggleSidebarCollapse };
})();
window.App = App;
document.addEventListener('DOMContentLoaded', App.init);
