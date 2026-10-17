/* ============================================================
   Notificaciones — alertas de vencimiento de facturas de CxP

   Las alertas NO se guardan: se CALCULAN en cada momento a partir de los
   registros reales (cxp_rows) y de las solicitudes de pago (cxp_solicitudes),
   que son los mismos datos que ya se sincronizan con Supabase (app_state).
   No modifica ningún dato, cálculo contable ni reporte de CxP.

   Reglas
     - Hoy = fecha local de República Dominicana (America/Santo_Domingo), sin
       depender de la zona horaria del navegador. Los días se cuentan con
       aritmética de fechas (UTC) sobre cadenas YYYY-MM-DD: sin errores de huso.
     - Se excluyen: estado Pagada/Anulada/Cancelada, saldo pendiente <= 0 y las
       facturas que ya fueron pagadas en una Solicitud de Pago confirmada
       (confirmar un pago en la Solicitud no cambia el estado de la fila del
       Reporte, así que se detecta por el rowId de sus items).
     - Vencida:        vencimiento < hoy y saldo > 0.
     - Próxima:        0 <= (vencimiento - hoy) <= 5 días (incluye hoy).
     - Sin fecha:      sin fecha de vencimiento válida → se muestra aparte, nunca
                       como vencida.
     - Una factura cae en UNA sola categoría.
     - El saldo es el saldoPendiente real de la fila.
   ============================================================ */
const Notificaciones = (() => {

  const DIAS_AVISO = 5;
  const TZ = 'America/Santo_Domingo';
  const EXCLUIDOS = ['Pagada', 'Anulada', 'Cancelada'];
  const MAX_PANEL = 25;                 // tarjetas por sección en el panel (el resto, en "Ver todas")

  let _hoyForzado = null;               // solo pruebas
  let _hoy = '';
  let _datos = null;
  let _panelAbierto = false;
  let _bellAnclada = null;
  let _timer = null;
  let _pend = null;
  const _fm = { prov: '', q: '', cat: 'atencion' };   // filtros del modal "todas"

  const esc = s => Utils.escapeHtml(s);

  // ---------- fechas (hora de República Dominicana) ----------
  function hoyRD(){
    if(_hoyForzado) return _hoyForzado;
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function _iso(v){
    const s = String(v == null ? '' : v).trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }
  // días entre dos fechas ISO (b - a), exactos
  function diasEntre(aISO, bISO){
    const [ya, ma, da] = aISO.split('-').map(Number);
    const [yb, mb, db] = bISO.split('-').map(Number);
    return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
  }

  // ---------- cálculo (puro) ----------
  function calcular(rows, solicitudes, hoy){
    const pagadasRowIds = new Set();
    const enSolicitud = new Map();                         // rowId -> n° de solicitud pendiente
    (solicitudes || []).forEach(s => {
      const items = Array.isArray(s.items) ? s.items : [];
      if(s.estado === 'Pagada' || s.estado === 'Parcialmente Pagada'){
        items.forEach(i => { if(i && i.rowId) pagadasRowIds.add(i.rowId); });
      }else if(s.estado === 'Pendiente'){
        items.forEach(i => { if(i && i.rowId) enSolicitud.set(i.rowId, s.numero); });
      }
    });

    const vencidas = [], proximas = [], sinFecha = [], futuras = [];
    (rows || []).forEach(r => {
      if(!r || EXCLUIDOS.indexOf(r.estado) !== -1) return;
      if(pagadasRowIds.has(r.id)) return;
      const total = Number(r.montoTotal) || 0;
      const saldoRaw = Number(r.saldoPendiente);
      const saldo = Number.isFinite(saldoRaw) ? saldoRaw : (total - (Number(r.montoPagado) || 0));
      if(!(saldo > 0.005)) return;                         // pagada por completo / sin saldo

      const venc = _iso(r.fechaVencimiento);
      const dias = venc ? diasEntre(hoy, venc) : null;
      const it = {
        id: r.id, numero: String(r.numeroFactura || '').trim(), proveedor: r.proveedor || '—', concepto: String(r.detalle || '').trim(),
        emision: _iso(r.fecha), vence: venc, dias, total, pendiente: saldo,
        moneda: r.moneda || 'RD$', estado: r.estado || 'Pendiente', tipoPago: r.tipoPago || '',
        solicitud: enSolicitud.has(r.id) ? enSolicitud.get(r.id) : null
      };
      if(dias === null){ it.categoria = 'sinfecha'; sinFecha.push(it); }
      else if(dias < 0){ it.categoria = 'vencida'; vencidas.push(it); }
      else if(dias <= DIAS_AVISO){ it.categoria = 'proxima'; proximas.push(it); }
      else { it.categoria = 'futura'; futuras.push(it); }
    });

    vencidas.sort((a, b) => a.dias - b.dias || a.proveedor.localeCompare(b.proveedor));     // más días de atraso primero
    proximas.sort((a, b) => a.dias - b.dias || a.proveedor.localeCompare(b.proveedor));      // vence antes primero
    sinFecha.sort((a, b) => a.proveedor.localeCompare(b.proveedor));
    futuras.sort((a, b) => a.dias - b.dias);

    return { hoy, vencidas, proximas, sinFecha, futuras, resumen: {
      vencidas: _tot(vencidas), proximas: _tot(proximas), sinFecha: _tot(sinFecha),
      atencion: vencidas.length + proximas.length
    } };
  }
  // totales por moneda de una lista
  function _tot(list){
    const porMoneda = {};
    list.forEach(i => { porMoneda[i.moneda] = (porMoneda[i.moneda] || 0) + i.pendiente; });
    return { n: list.length, porMoneda };
  }

  // ---------- formato ----------
  function money(n, moneda){
    const m = (moneda || 'RD$');
    return m === 'RD$' ? Utils.fmtMoney(n) : m + ' ' + Utils.fmtNum(n);
  }
  // "RD$ 25,000.00" (+ otras monedas si las hay)
  function totalesTxt(t){
    const keys = Object.keys(t.porMoneda);
    if(!keys.length) return Utils.fmtMoney(0);
    keys.sort((a, b) => (a === 'RD$' ? -1 : b === 'RD$' ? 1 : a.localeCompare(b)));
    return keys.map(k => money(t.porMoneda[k], k)).join(' + ');
  }
  function etiqueta(it){
    if(it.categoria === 'vencida'){ const d = -it.dias; return { cls: 'red', txt: 'VENCIDA — ' + d + (d === 1 ? ' día' : ' días') + ' de atraso' }; }
    if(it.categoria === 'proxima'){
      if(it.dias === 0) return { cls: 'orange', txt: 'VENCE HOY' };
      return { cls: 'yellow', txt: 'VENCE EN ' + it.dias + (it.dias === 1 ? ' DÍA' : ' DÍAS') };
    }
    if(it.categoria === 'sinfecha') return { cls: 'gray', txt: 'SIN FECHA DE VENCIMIENTO' };
    return { cls: 'gray', txt: 'VENCE EN ' + it.dias + ' DÍAS' };
  }

  // ---------- estado ----------
  function refrescar(){
    _hoy = hoyRD();
    _datos = calcular(Storage.getRows(), Storage.getSolicitudes(), _hoy);
    _pintarCampanas();
    if(_panelAbierto) _renderPanel();
    const m = document.getElementById('ntModal');
    if(m && m.classList.contains('open')) _renderModal();
  }
  function _programar(){                // refresco con pequeño retardo (varios cambios seguidos = 1 cálculo)
    clearTimeout(_pend);
    _pend = setTimeout(refrescar, 120);
  }

  // ---------- campana ----------
  const SVG_CAMPANA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

  function _inyectarCampanas(){
    document.querySelectorAll('.view > .topbar').forEach(tb => {
      let act = tb.querySelector('.topbar-actions');
      if(!act){ act = document.createElement('div'); act.className = 'topbar-actions'; tb.appendChild(act); }
      if(act.querySelector('.nt-bell')) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-ghost btn-icon nt-bell';
      b.title = 'Notificaciones de vencimiento';
      b.setAttribute('aria-label', 'Notificaciones de vencimiento de facturas');
      b.innerHTML = SVG_CAMPANA + '<span class="nt-badge" hidden></span>';
      b.addEventListener('click', e => { e.stopPropagation(); _panelAbierto && _bellAnclada === b ? cerrarPanel() : abrirPanel(b); });
      act.insertBefore(b, act.firstChild);
    });
  }

  function _pintarCampanas(){
    if(!_datos) return;
    const venc = _datos.vencidas.length, prox = _datos.proximas.length, n = venc + prox;
    const nivel = venc > 0 ? 'red' : (prox > 0 ? 'amber' : '');
    document.querySelectorAll('.nt-bell').forEach(b => {
      b.classList.toggle('nt-red', nivel === 'red');
      b.classList.toggle('nt-amber', nivel === 'amber');
      const bd = b.querySelector('.nt-badge');
      if(n > 0){ bd.hidden = false; bd.textContent = n > 99 ? '99+' : String(n); } else { bd.hidden = true; }
      b.title = n > 0
        ? n + ' factura(s) requieren atención (' + venc + ' vencida(s), ' + prox + ' próxima(s))'
        : 'Sin facturas por vencer en los próximos ' + DIAS_AVISO + ' días';
    });
  }

  // ---------- panel ----------
  function _panelEl(){
    let p = document.getElementById('ntPanel');
    if(!p){
      p = document.createElement('div');
      p.id = 'ntPanel';
      p.className = 'nt-panel';
      p.setAttribute('role', 'dialog');
      p.setAttribute('aria-label', 'Notificaciones de CxP');
      p.hidden = true;
      p.addEventListener('click', e => e.stopPropagation());
      document.body.appendChild(p);
    }
    return p;
  }

  function abrirPanel(bell){
    _bellAnclada = bell;
    _panelAbierto = true;
    _renderPanel();
    _colocarPanel();
    _panelEl().hidden = false;
  }
  function cerrarPanel(){
    _panelAbierto = false;
    _bellAnclada = null;
    const p = document.getElementById('ntPanel');
    if(p) p.hidden = true;
  }
  function _colocarPanel(){
    const p = _panelEl();
    const b = _bellAnclada;
    if(!b) return;
    const r = b.getBoundingClientRect();
    // Se mide contra el ancho VISIBLE (clientWidth): en celular, si la página es más ancha
    // que la pantalla, innerWidth sería el ancho de la página y el panel quedaría cortado.
    const cw = document.documentElement.clientWidth;
    const w = Math.min(440, cw - 16);
    const left = Math.max(8, Math.min(r.right - w, cw - w - 8));       // alineado a la campana, sin salirse de la pantalla
    p.style.width = w + 'px'; p.style.left = left + 'px'; p.style.right = 'auto';
    p.style.top = Math.min(r.bottom + 8, window.innerHeight - 200) + 'px';
  }

  function _cardHTML(it){
    const e = etiqueta(it);
    const concepto = it.concepto ? '<div class="nt-concepto" title="' + esc(it.concepto) + '">' + esc(it.concepto) + '</div>' : '';
    const sol = it.solicitud != null ? ' <span class="pill indigo">En Solicitud #' + esc(it.solicitud) + '</span>' : '';
    return '<div class="nt-card nt-' + e.cls + '">'
      + '<div class="nt-card-top"><div class="nt-fac">Factura ' + esc(it.numero || '(sin número)') + '</div><span class="nt-tag nt-tag-' + e.cls + '">' + esc(e.txt) + '</span></div>'
      + '<div class="nt-prov">Proveedor: <b>' + esc(it.proveedor) + '</b></div>'
      + concepto
      + '<div class="nt-fechas">' + (it.emision ? 'Emitida ' + Utils.fmtDate(it.emision) + ' · ' : '') + (it.vence ? (it.categoria === 'vencida' ? 'Venció ' : 'Vence ') + Utils.fmtDate(it.vence) : 'Sin fecha de vencimiento') + '</div>'
      + '<div class="nt-montos"><div><span>Pendiente</span><b>' + money(it.pendiente, it.moneda) + '</b></div>'
      +   '<div><span>Total factura</span>' + money(it.total, it.moneda) + '</div></div>'
      + '<div class="nt-card-foot"><span class="pill ' + (it.estado === 'Pagar' ? 'blue' : 'warn') + '">' + esc(it.estado) + '</span>' + sol
      +   '<button type="button" class="btn btn-soft btn-sm nt-abrir" onclick="Notificaciones.abrir(\'' + Utils.jsAttr(it.id) + '\')">Abrir factura</button></div>'
      + '</div>';
  }

  function _seccion(titulo, cls, lista, vacio){
    const corto = lista.slice(0, MAX_PANEL);
    return '<div class="nt-sec nt-sec-' + cls + '"><div class="nt-sec-h"><span class="nt-dot"></span>' + titulo + ' <b>(' + lista.length + ')</b></div>'
      + (lista.length ? corto.map(_cardHTML).join('') : '<div class="nt-vacio">' + vacio + '</div>')
      + (lista.length > MAX_PANEL ? '<div class="nt-mas">y ' + (lista.length - MAX_PANEL) + ' más — <a href="#" onclick="Notificaciones.abrirTodas(\'' + (cls === 'red' ? 'vencidas' : cls === 'gray' ? 'sinfecha' : 'proximas') + '\');return false;">ver todas</a></div>' : '')
      + '</div>';
  }

  function _renderPanel(){
    const d = _datos; if(!d) return;
    const p = _panelEl();
    const r = d.resumen;
    const n = r.atencion;
    p.innerHTML =
      '<div class="nt-head"><div><div class="nt-title">Notificaciones de CxP</div><div class="nt-sub">Facturas pendientes de atención · hoy ' + Utils.fmtDate(d.hoy) + '</div></div>'
      + '<div class="nt-head-r"><span class="nt-count ' + (d.vencidas.length ? 'red' : (d.proximas.length ? 'amber' : '')) + '">' + n + (n === 1 ? ' alerta' : ' alertas') + '</span>'
      + '<button type="button" class="nt-x" onclick="Notificaciones.cerrarPanel()" aria-label="Cerrar">✕</button></div></div>'
      + '<div class="nt-resumen">'
      +   '<div class="nt-r nt-r-red"><div class="nt-r-l">Vencidas</div><div class="nt-r-n">' + r.vencidas.n + '</div><div class="nt-r-m">' + totalesTxt(r.vencidas) + '</div></div>'
      +   '<div class="nt-r nt-r-amber"><div class="nt-r-l">Próximas a vencer</div><div class="nt-r-n">' + r.proximas.n + '</div><div class="nt-r-m">' + totalesTxt(r.proximas) + '</div></div>'
      + '</div>'
      + '<div class="nt-body">'
      +   (n === 0 && !d.sinFecha.length ? '<div class="nt-todo-ok">✓ No hay facturas vencidas ni por vencer en los próximos ' + DIAS_AVISO + ' días.</div>' : '')
      +   (d.vencidas.length || n > 0 ? _seccion('Facturas vencidas', 'red', d.vencidas, 'No hay facturas vencidas.') : '')
      +   (d.proximas.length || n > 0 ? _seccion('Próximas a vencer', 'amber', d.proximas, 'No hay facturas por vencer en los próximos ' + DIAS_AVISO + ' días.') : '')
      +   (d.sinFecha.length ? _seccion('Pendientes de completar la fecha de vencimiento', 'gray', d.sinFecha, '') : '')
      + '</div>'
      + '<div class="nt-foot"><button type="button" class="btn btn-primary btn-sm" onclick="Notificaciones.abrirTodas()">Ver todas las facturas pendientes</button></div>';
  }

  // ---------- abrir el registro ----------
  function abrir(id){
    cerrarPanel();
    cerrarModal();
    // App y DataModule son "const" globales de CxP (no cuelgan de window): se comprueban por nombre
    if(typeof App !== 'undefined' && App.switchView) App.switchView('reporte');
    if(typeof DataModule !== 'undefined' && DataModule.focusRow) DataModule.focusRow(id);
  }

  // ---------- modal "todas las facturas pendientes" ----------
  function _modalEl(){
    let m = document.getElementById('ntModal');
    if(!m){
      m = document.createElement('div');
      m.id = 'ntModal';
      m.className = 'modal-overlay';
      m.addEventListener('click', e => { if(e.target === m) cerrarModal(); });
      document.body.appendChild(m);
    }
    return m;
  }

  function abrirTodas(cat){
    cerrarPanel();
    _fm.cat = cat || 'atencion'; _fm.prov = ''; _fm.q = '';
    refrescar();
    _modalEl().classList.add('open');
    _renderModal();
  }
  function cerrarModal(){ const m = document.getElementById('ntModal'); if(m) m.classList.remove('open'); }
  function setFiltro(k, v){ _fm[k] = v; _renderModal(); }

  function _universo(){
    const d = _datos;
    return { vencidas: d.vencidas, proximas: d.proximas, sinfecha: d.sinFecha, futuras: d.futuras,
             atencion: d.vencidas.concat(d.proximas, d.sinFecha), todas: d.vencidas.concat(d.proximas, d.sinFecha, d.futuras) };
  }

  function _renderModal(){
    const d = _datos; if(!d) return;
    const u = _universo();
    const base = u[_fm.cat] || u.atencion;
    const provs = [...new Set(u.todas.map(i => i.proveedor))].sort((a, b) => a.localeCompare(b));
    const q = Utils.normalize(_fm.q);
    const lista = base.filter(i => (!_fm.prov || i.proveedor === _fm.prov)
      && (!q || Utils.normalize(i.numero + ' ' + i.proveedor + ' ' + i.concepto).indexOf(q) !== -1));
    const venc = lista.filter(i => i.categoria === 'vencida');
    const prox = lista.filter(i => i.categoria === 'proxima');
    const tVenc = _tot(venc), tProx = _tot(prox), tAmbas = _tot(venc.concat(prox));

    const opt = (v, t) => '<option value="' + v + '"' + (_fm.cat === v ? ' selected' : '') + '>' + t + '</option>';
    const filas = lista.map(it => {
      const e = etiqueta(it);
      return '<tr><td class="mono" style="font-size:12px">' + esc(it.numero || '—') + '</td><td>' + esc(it.proveedor) + '</td>'
        + '<td class="nt-cell-c" title="' + esc(it.concepto) + '">' + esc(it.concepto || '—') + '</td>'
        + '<td>' + (it.emision ? Utils.fmtDate(it.emision) : '—') + '</td><td>' + (it.vence ? Utils.fmtDate(it.vence) : '—') + '</td>'
        + '<td><span class="nt-tag nt-tag-' + e.cls + '">' + esc(e.txt) + '</span></td>'
        + '<td class="r">' + money(it.total, it.moneda) + '</td><td class="r"><b>' + money(it.pendiente, it.moneda) + '</b></td>'
        + '<td class="c"><span class="pill ' + (it.estado === 'Pagar' ? 'blue' : 'warn') + '">' + esc(it.estado) + '</span></td>'
        + '<td class="c"><button type="button" class="btn btn-soft btn-sm" onclick="Notificaciones.abrir(\'' + Utils.jsAttr(it.id) + '\')">Abrir</button></td></tr>';
    }).join('');

    _modalEl().innerHTML =
      '<div class="modal xwide"><div class="modal-head"><div><h3>Facturas pendientes de pago</h3>'
      + '<p class="nt-sub" style="margin-top:3px">Hoy ' + Utils.fmtDate(d.hoy) + ' · filtra por proveedor para ver cuánto necesitas para cubrirlas</p></div>'
      + '<button type="button" class="btn btn-ghost btn-icon" onclick="Notificaciones.cerrarModal()">✕</button></div>'
      + '<div class="modal-body">'
      +   '<div class="nt-filtros">'
      +     '<div class="field"><label class="f-label">Mostrar</label><select class="input" onchange="Notificaciones.setFiltro(\'cat\', this.value)">'
      +       opt('atencion', 'Requieren atención (vencidas + próximas)') + opt('vencidas', 'Solo vencidas') + opt('proximas', 'Solo próximas a vencer')
      +       opt('sinfecha', 'Sin fecha de vencimiento') + opt('todas', 'Todas las pendientes') + '</select></div>'
      +     '<div class="field"><label class="f-label">Proveedor</label><select class="input" onchange="Notificaciones.setFiltro(\'prov\', this.value)"><option value="">Todos los proveedores</option>'
      +       provs.map(p => '<option value="' + esc(p) + '"' + (_fm.prov === p ? ' selected' : '') + '>' + esc(p) + '</option>').join('') + '</select></div>'
      +     '<div class="field"><label class="f-label">Buscar</label><input type="text" class="input" id="ntBuscar" placeholder="Factura, proveedor o concepto…" value="' + esc(_fm.q) + '" oninput="Notificaciones.setFiltro(\'q\', this.value)"></div>'
      +   '</div>'
      +   '<div class="nt-kpis">'
      +     '<div class="nt-kpi nt-kpi-red"><span>Vencidas (' + venc.length + ')</span><b>' + totalesTxt(tVenc) + '</b></div>'
      +     '<div class="nt-kpi nt-kpi-amber"><span>Próximas a vencer (' + prox.length + ')</span><b>' + totalesTxt(tProx) + '</b></div>'
      +     '<div class="nt-kpi nt-kpi-ink"><span>Necesario para cubrir vencidas + próximas</span><b>' + totalesTxt(tAmbas) + '</b></div>'
      +   '</div>'
      +   '<div class="table-wrap" style="max-height:46vh;overflow:auto;border:1px solid var(--line);border-radius:10px">'
      +     '<table class="t"><thead><tr><th>Factura</th><th>Proveedor</th><th>Concepto</th><th>Emisión</th><th>Vence</th><th>Situación</th><th class="r">Total</th><th class="r">Pendiente</th><th class="c">Estado</th><th></th></tr></thead>'
      +     '<tbody>' + (filas || '<tr><td colspan="10" class="t-empty">No hay facturas con esos filtros.</td></tr>') + '</tbody></table></div>'
      +   '<p class="nt-sub" style="margin-top:10px">' + lista.length + ' factura(s) mostrada(s)' + (d.sinFecha.length && _fm.cat !== 'sinfecha' && _fm.cat !== 'todas' ? ' · ' + d.sinFecha.length + ' sin fecha de vencimiento (no se cuentan como vencidas)' : '') + '</p>'
      + '</div></div>';
    const inp = document.getElementById('ntBuscar');
    if(inp && document.activeElement && document.activeElement.id === 'ntBuscar'){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }

  // ---------- inicio ----------
  function init(){
    _inyectarCampanas();
    refrescar();

    // Cambios en los datos (propios o de otros usuarios vía Supabase en tiempo real)
    if(Storage.onChange) Storage.onChange(key => { if(key === 'cxp_rows' || key === 'cxp_solicitudes') _programar(); });

    // Cambio de fecha del sistema (a medianoche de RD) y regreso a la pestaña
    clearInterval(_timer);
    _timer = setInterval(() => { if(hoyRD() !== _hoy) refrescar(); }, 60000);
    document.addEventListener('visibilitychange', () => { if(!document.hidden && hoyRD() !== _hoy) refrescar(); });
    window.addEventListener('focus', () => { if(hoyRD() !== _hoy) refrescar(); });

    document.addEventListener('click', () => { if(_panelAbierto) cerrarPanel(); });
    document.addEventListener('keydown', e => { if(e.key === 'Escape'){ cerrarPanel(); cerrarModal(); } });
    window.addEventListener('resize', () => { if(_panelAbierto) _colocarPanel(); });
  }

  return { init, refrescar, calcular, diasEntre, hoyRD, abrir, abrirPanel, cerrarPanel, abrirTodas, cerrarModal, setFiltro,
           _forzarHoy: iso => { _hoyForzado = iso || null; refrescar(); }, _datos: () => _datos };
})();
window.Notificaciones = Notificaciones;
