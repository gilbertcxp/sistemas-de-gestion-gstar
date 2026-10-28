/* ============================================================
   Ficha — detalle de un activo + acciones autorizadas.

   Reglas:
     - Consultar e imprimir: cualquier usuario del módulo.
     - Crear, editar, retiro, ajuste, inactivar, marcar revisado: Administrador + PIN.
     - Los importes del corte importado NO se editan: para corregirlos se registra un
       AJUSTE posterior (queda aparte, con motivo, usuario y fecha).
     - Nunca se elimina un activo: se inactiva.
     - Todo cambio queda en la bitácora (campo, valor anterior, valor nuevo, usuario, fecha).
   ============================================================ */
const Ficha = (() => {

  const esc = Utils.escapeHtml;
  const money = v => (v === null || v === undefined) ? '—' : Utils.fmtMoney(v);
  const fecha = v => v ? Utils.fmtDate(v) : '—';
  const dato = v => (v === null || v === undefined || v === '') ? '<span class="af-nulo">—</span>' : esc(v);
  let _id = null;
  let _busy = false;

  const ETQ = { descripcion:'Descripción', proveedor:'Proveedor', referencia:'Referencia/serial', ubicacion:'Ubicación', notas:'Notas', numero:'No. de activo',
    valorAdquisicion:'Valor de adquisición', fechaAdquisicion:'Fecha de adquisición', inicioDepreciacion:'Inicio de depreciación', cuentaActivo:'Cuenta del activo',
    cuentaDepAcum:'Cuenta de depreciación acumulada', cuentaGasto:'Cuenta del gasto de depreciación', fechaRetiro:'Fecha de retiro', importeRetiro:'Importe de retiro',
    estadoRegistro:'Estado del registro', amAcumulada:'Depreciación acumulada', pendiente:'Importe pendiente' };

  const IMPORTES = ['valorAdquisicion', 'amAcumulada', 'pendiente'];   // campos de ajuste que son importes (el resto son cuentas)
  const valAjuste = (campo, x) => (x === null || x === undefined) ? '—' : (IMPORTES.indexOf(campo) !== -1 ? money(x) : esc(x));

  // ---------- persistencia segura con bitácora ----------
  async function _persistir(mutar, auditoria, mensajeOk){
    if(_busy) return false;
    _busy = true;
    const K = Storage.KEYS;
    const previos = { [K.ACTIVOS]: Storage.getActivos(), [K.AUDIT]: Storage.getAuditoria() };
    try{
      if(window.Sync){ try{ await Sync.pull(); }catch(e){} }                 // versión más reciente
      previos[K.ACTIVOS] = Storage.getActivos(); previos[K.AUDIT] = Storage.getAuditoria();
      const nueva = mutar(previos[K.ACTIVOS].map(a => ({ ...a })));
      if(!nueva) return false;
      Storage.saveActivos(nueva);
      auditoria.forEach(a => Storage.addAuditoria({ usuarioNombre: Permisos.nombre(), ...a }));
      const r = await App.guardarSeguro(previos, [K.ACTIVOS, K.AUDIT]);
      if(!r.ok){ UI.toast('No se pudo guardar en Supabase (' + r.reason + '). No se aplicó ningún cambio.', 'err'); Inventario.render(); return false; }
      UI.toast(mensajeOk, 'ok');
      Inventario.render();
      refrescar();
      return true;
    }catch(e){
      console.error(e);
      Object.keys(previos).forEach(k => { try{ localStorage.setItem(k, JSON.stringify(previos[k])); }catch(_){} });
      UI.toast('Error: ' + e.message, 'err'); Inventario.render(); return false;
    }finally{ _busy = false; }
  }

  // ---------- ficha ----------
  function abrir(id){ _id = id; refrescar(); document.getElementById('fichaPanel').classList.add('open'); document.getElementById('fichaScrim').classList.add('open'); }
  function cerrar(){ _id = null; document.getElementById('fichaPanel').classList.remove('open'); document.getElementById('fichaScrim').classList.remove('open'); }

  const fila = (l, v) => '<div class="af-row"><span>' + l + '</span><b>' + v + '</b></div>';
  const seccion = (t, body) => '<div class="af-sec"><h4>' + t + '</h4>' + body + '</div>';

  function refrescar(){
    if(!_id) return;
    const a = Storage.getActivo(_id);
    const body = document.getElementById('fichaBody');
    if(!a){ body.innerHTML = '<p class="sub">El activo ya no existe.</p>'; return; }
    const per = Datos.periodo(), r = Datos.fila(a, per), v = r.v, admin = Permisos.esAdmin();
    const nombres = Storage.getSettings().cuentasNombres || {};
    const cuenta = c => c ? esc(c) + (nombres[c] ? ' <span class="sub">· ' + esc(nombres[c]) + '</span>' : '') : '<span class="af-nulo">—</span>';
    document.getElementById('fichaTitulo').innerHTML = 'Activo No. ' + esc(a.numero) + ' ' + Inventario.pillEstado(r.estado);
    document.getElementById('fichaSub').textContent = a.descripcion || '(sin descripción)';

    const origenV = v ? (v.tipo === 'registrado' ? '<span class="pill ok">Registrado en el corte ' + esc(Datos.etiquetaPeriodo(per)) + '</span>' : '<span class="pill warn">Calculado (no está en un corte importado)</span>') : '<span class="pill gray">Sin importes para este período</span>';
    const revisiones = (a.revision && a.revision.pendiente) ? '<div class="cc-alert warn">Pendiente de revisión: ' + esc((a.revision.motivos || []).join('; ')) + '</div>' : '';
    const avisos = (a.avisos && a.avisos.length) ? '<ul class="af-avisos">' + a.avisos.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '';
    const periodos = Object.keys(a.valores || {}).sort().reverse();

    body.innerHTML = revisiones
      + seccion('A · Identificación',
          fila('No. de activo', esc(a.numero) + (a.numeroOrigen === 'asignado' ? ' <span class="pill gray" title="No existe en el Excel">asignado por el sistema</span>' : ''))
          + fila('Descripción', dato(a.descripcion)) + fila('Proveedor', dato(a.proveedor)) + fila('Referencia / serial', dato(a.referencia))
          + fila('Ubicación', dato(a.ubicacion)) + fila('Categoría', dato(r.categoria)))
      + seccion('B · Adquisición',
          fila('Fecha de adquisición', fecha(a.fechaAdquisicion)) + fila('Inicio de depreciación', fecha(a.inicioDepreciacion))
          + fila('Valor de adquisición', money(a.valorAdquisicion))
          + fila('Fin de depreciación <span class="sub">(calculado: inicio + 60 meses)</span>', fecha(a.finDepreciacion))
          + fila('Fecha de retiro', a.fechaRetiro ? '<span style="color:var(--danger)">' + fecha(a.fechaRetiro) + '</span>' : '<span class="af-nulo">No retirado</span>')
          + (a.fechaRetiro ? fila('Importe de retiro', money(a.importeRetiro)) + fila('Motivo del retiro', dato(a.motivoRetiro)) : '')
          + fila('Origen del registro', a.origen === 'manual' ? 'Creado manualmente' : 'Importado (primer corte ' + esc(Datos.etiquetaPeriodo(a.primerPeriodo)) + ')')
          + (a.notas ? fila('Notas', esc(a.notas)) : ''))
      + seccion('C · Depreciación <span class="sub">período ' + esc(Datos.etiquetaPeriodo(per)) + '</span> ' + origenV,
          fila('Vida útil', esc(a.vidaUtilMeses || 60) + ' meses <span class="sub">(según fórmulas del archivo)</span>')
          + fila('Depreciación mensual', money(v && v.depMensual)) + fila('Meses depreciados', v && v.mesesDepreciados !== null && v.mesesDepreciados !== undefined ? (Math.round(v.mesesDepreciados * 10) / 10) : '—')
          + fila('Depreciación acumulada', money(v && v.amAcumulada)) + fila('Importe pendiente de depreciar', money(v && v.pendiente))
          + fila('Gasto de depreciación del período', money(v && v.gastoPeriodo)) + fila('Estado de depreciación', Inventario.pillEstado(r.estado)))
      + seccion('D · Información contable',
          fila('Cuenta del activo', cuenta(a.cuentaActivo)) + fila('Cuenta de depreciación acumulada', cuenta(a.cuentaDepAcum)) + fila('Cuenta del gasto de depreciación', cuenta(a.cuentaGasto)))
      + (periodos.length ? seccion('Valores registrados por período', '<div class="table-wrap"><table class="t"><thead><tr><th>Período</th><th class="r">Meses</th><th class="r">Acumulada</th><th class="r">Pendiente</th><th class="r">Gasto</th></tr></thead><tbody>'
          + periodos.map(p => { const x = a.valores[p]; return '<tr><td>' + esc(Datos.etiquetaPeriodo(p)) + '<div class="sub" style="font-size:11px">hoja ' + esc(x.hoja || '') + ' · fila ' + esc(x.fila || '') + '</div></td><td class="r">' + (x.mesesDepreciados === null ? '—' : Math.round(x.mesesDepreciados * 10) / 10) + '</td><td class="r mono">' + money(x.amAcumulada) + '</td><td class="r mono">' + money(x.pendiente) + '</td><td class="r mono">' + money(x.gastoPeriodo) + '</td></tr>'; }).join('')
          + '</tbody></table></div><p class="sub" style="font-size:11.5px">Importes tal como vienen del archivo en cada corte. No se recalculan.</p>') : '')
      + ((a.ajustes && a.ajustes.length) ? seccion('Ajustes posteriores', '<div class="table-wrap"><table class="t"><thead><tr><th>Fecha</th><th>Campo</th><th class="r">Registrado</th><th class="r">Ajuste</th><th>Motivo</th></tr></thead><tbody>'
          + a.ajustes.map(j => '<tr><td>' + fecha(j.fecha) + '<div class="sub" style="font-size:11px">' + esc(j.usuario) + '</div></td><td>' + esc(ETQ[j.campo] || j.campo) + '</td><td class="r">' + valAjuste(j.campo, j.anterior) + '</td><td class="r"><b>' + valAjuste(j.campo, j.nuevo) + '</b></td><td>' + esc(j.motivo) + '</td></tr>').join('')
          + '</tbody></table></div><p class="sub" style="font-size:11.5px">Los ajustes se muestran aparte: no modifican los importes del corte ni los indicadores.</p>') : '')
      + (avisos ? seccion('Advertencias de la importación', avisos) : '')
      + _historial(a.id);

    // botones
    const bot = [];
    bot.push('<button class="btn btn-soft btn-sm" onclick="Ficha.imprimir()">Imprimir ficha</button>');
    if(admin){
      bot.push('<button class="btn btn-soft btn-sm" onclick="Ficha.editar()">Editar</button>');
      bot.push(a.fechaRetiro ? '<button class="btn btn-ghost btn-sm" onclick="Ficha.anularRetiro()">Anular retiro</button>' : '<button class="btn btn-ghost btn-sm" onclick="Ficha.retiro()">Registrar retiro</button>');
      bot.push('<button class="btn btn-ghost btn-sm" onclick="Ficha.ajuste()">Registrar ajuste</button>');
      if(a.revision && a.revision.pendiente) bot.push('<button class="btn btn-ghost btn-sm" onclick="Ficha.revisado()">Marcar como revisado</button>');
      bot.push(a.estadoRegistro === 'inactivo' ? '<button class="btn btn-ghost btn-sm" onclick="Ficha.reactivar()">Reactivar</button>' : '<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="Ficha.inactivar()">Inactivar</button>');
    }
    document.getElementById('fichaAcciones').innerHTML = bot.join('');
  }

  function _historial(id){
    const h = Storage.getAuditoria().filter(x => x.entidadId === id).slice(-15).reverse();
    if(!h.length) return '';
    const vh = v => (v === null || v === undefined || v === '') ? '—' : (typeof v === 'number' && !Number.isInteger(v) ? Utils.fmtNum(v) : esc(v));
    return seccion('Historial de cambios', '<ul class="af-hist">' + h.map(x => '<li><b>' + esc(x.accion.replace(/_/g, ' ')) + '</b>' + (x.campo ? ' · ' + esc(ETQ[x.campo] || x.campo) + ': <span class="sub">' + vh(x.anterior) + '</span> → <b>' + vh(x.nuevo) + '</b>' : '')
      + (x.motivo ? ' · ' + esc(x.motivo) : '') + '<div class="sub" style="font-size:11px">' + new Date(x.createdAt).toLocaleString('es-DO') + ' · ' + esc(x.usuarioNombre || '—') + '</div></li>').join('') + '</ul>');
  }

  // ---------- formulario genérico para acciones con motivo ----------
  let _cfg = null;
  function _formulario(cfg){
    _cfg = cfg;
    document.getElementById('accTitulo').textContent = cfg.titulo;
    document.getElementById('accInfo').innerHTML = cfg.info || '';
    document.getElementById('accCampos').innerHTML = cfg.campos.map(c => {
      const base = 'id="acc_' + c.id + '" class="input"' + (c.req ? ' required' : '');
      let ctl;
      if(c.tipo === 'select') ctl = '<select ' + base + '>' + c.opciones.map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === c.valor ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
      else if(c.tipo === 'textarea') ctl = '<textarea ' + base + ' rows="3">' + esc(c.valor || '') + '</textarea>';
      else ctl = '<input ' + base + ' type="' + (c.tipo || 'text') + '"' + (c.tipo === 'number' ? ' step="0.01"' : '') + ' value="' + esc(c.valor === null || c.valor === undefined ? '' : c.valor) + '"' + (c.dis ? ' disabled' : '') + '>';
      return '<div class="field"><label class="f-label">' + esc(c.label) + (c.req ? ' *' : '') + '</label>' + ctl + (c.ayuda ? '<p class="hint">' + esc(c.ayuda) + '</p>' : '') + '</div>';
    }).join('');
    document.getElementById('accBtn').textContent = cfg.boton || 'Guardar';
    UI.openModal('modalAccion');
  }
  function accionOk(){
    const vals = {};
    for(const c of _cfg.campos){
      const el = document.getElementById('acc_' + c.id); let v = el ? el.value.trim() : '';
      if(c.req && v === ''){ UI.toast('Completa el campo obligatorio: ' + c.label, 'err'); el && el.focus(); return; }
      if(c.tipo === 'number' && v !== ''){ v = Number(v); if(!isFinite(v)){ UI.toast(c.label + ' debe ser un número', 'err'); return; } }
      vals[c.id] = v === '' ? null : v;
    }
    const msg = _cfg.validar ? _cfg.validar(vals) : null;
    if(msg){ UI.toast(msg, 'err'); return; }
    const cfg = _cfg;
    App.protegida(async () => { const ok = await cfg.onOk(vals); if(ok) UI.closeModal('modalAccion'); });
  }

  const hoy = () => Utils.todayISO();

  function retiro(){
    const a = Storage.getActivo(_id); if(!a) return;
    _formulario({ titulo:'Registrar retiro · activo ' + a.numero, boton:'Registrar retiro',
      info:'El retiro es una <b>fecha real</b> registrada por un administrador. Un activo NO se considera retirado solo porque terminó de depreciarse. El activo sale de los indicadores de costo y depreciación, pero permanece en el historial.',
      campos:[{ id:'fecha', label:'Fecha de retiro', tipo:'date', req:true, valor:hoy() }, { id:'importe', label:'Importe de retiro (opcional)', tipo:'number' }, { id:'motivo', label:'Motivo', tipo:'textarea', req:true }],
      validar: v => v.fecha > hoy() ? 'La fecha de retiro no puede ser futura' : (a.fechaAdquisicion && v.fecha < a.fechaAdquisicion ? 'La fecha de retiro no puede ser anterior a la adquisición' : null),
      onOk: v => _persistir(l => { const x = l.find(z => z.id === a.id); x.fechaRetiro = v.fecha; x.importeRetiro = v.importe; x.motivoRetiro = v.motivo; x.actualizadoEn = new Date().toISOString(); return l; },
        [{ accion:'registrar_retiro', entidad:'activo', entidadId:a.id, campo:'fechaRetiro', anterior:null, nuevo:v.fecha, motivo:v.motivo }], 'Retiro registrado') });
  }
  function anularRetiro(){
    const a = Storage.getActivo(_id); if(!a) return;
    _formulario({ titulo:'Anular retiro · activo ' + a.numero, boton:'Anular retiro', info:'El activo volverá a contarse en los indicadores.',
      campos:[{ id:'motivo', label:'Motivo', tipo:'textarea', req:true }],
      onOk: v => _persistir(l => { const x = l.find(z => z.id === a.id); x.fechaRetiro = null; x.importeRetiro = null; x.motivoRetiro = null; return l; },
        [{ accion:'anular_retiro', entidad:'activo', entidadId:a.id, campo:'fechaRetiro', anterior:a.fechaRetiro, nuevo:null, motivo:v.motivo }], 'Retiro anulado') });
  }

  function ajuste(){
    const a = Storage.getActivo(_id); if(!a) return;
    const v = Datos.valores(a) || {};
    const CAMPOS = { valorAdquisicion:a.valorAdquisicion, amAcumulada:v.amAcumulada, pendiente:v.pendiente, cuentaActivo:a.cuentaActivo, cuentaDepAcum:a.cuentaDepAcum, cuentaGasto:a.cuentaGasto };
    const anterior = k => CAMPOS[k] === undefined ? null : CAMPOS[k];
    _formulario({ titulo:'Registrar ajuste · activo ' + a.numero, boton:'Registrar ajuste',
      info:'Un ajuste es un registro <b>posterior</b> al corte: queda aparte, con su motivo, usuario y fecha. <b>No modifica</b> los importes registrados en el corte importado ni los indicadores.',
      campos:[{ id:'campo', label:'Campo a ajustar', tipo:'select', req:true, valor:'valorAdquisicion', opciones:Object.keys(CAMPOS).map(k => [k, ETQ[k]]) },
        { id:'nuevo', label:'Valor correcto (ajustado)', tipo:'text', req:true, ayuda:'Importes sin separador de miles (ej. 125000.50). Cuentas: el código.' },
        { id:'fecha', label:'Fecha del ajuste', tipo:'date', req:true, valor:hoy() }, { id:'motivo', label:'Motivo / sustento', tipo:'textarea', req:true }],
      validar: x => (IMPORTES.indexOf(x.campo) !== -1 && !isFinite(Number(String(x.nuevo).replace(/,/g, '')))) ? 'El valor ajustado debe ser un número' : (x.fecha > hoy() ? 'La fecha del ajuste no puede ser futura' : null),
      onOk: x => { const nuevo = IMPORTES.indexOf(x.campo) !== -1 ? Number(String(x.nuevo).replace(/,/g, '')) : x.nuevo;
        return _persistir(l => { const z = l.find(q => q.id === a.id);
          z.ajustes = (z.ajustes || []).concat([{ id:Utils.uid('aj'), fecha:x.fecha, campo:x.campo, anterior:anterior(x.campo), nuevo, motivo:x.motivo, usuario:Permisos.nombre(), creadoEn:new Date().toISOString() }]);
          return l; },
        [{ accion:'registrar_ajuste', entidad:'activo', entidadId:a.id, campo:x.campo, anterior:anterior(x.campo), nuevo, motivo:x.motivo }], 'Ajuste registrado'); } });
  }

  function inactivar(){
    const a = Storage.getActivo(_id); if(!a) return;
    _formulario({ titulo:'Inactivar activo ' + a.numero, boton:'Inactivar', info:'No se elimina: el activo y su historial se conservan. Deja de contarse en los indicadores y se oculta del inventario (puede mostrarse con "Incluir inactivos").',
      campos:[{ id:'motivo', label:'Motivo', tipo:'textarea', req:true }],
      onOk: v => _persistir(l => { const x = l.find(z => z.id === a.id); x.estadoRegistro = 'inactivo'; x.motivoInactivo = v.motivo; return l; },
        [{ accion:'inactivar', entidad:'activo', entidadId:a.id, campo:'estadoRegistro', anterior:'activo', nuevo:'inactivo', motivo:v.motivo }], 'Activo inactivado') });
  }
  function reactivar(){
    const a = Storage.getActivo(_id); if(!a) return;
    _formulario({ titulo:'Reactivar activo ' + a.numero, boton:'Reactivar', campos:[{ id:'motivo', label:'Motivo', tipo:'textarea', req:true }],
      onOk: v => _persistir(l => { const x = l.find(z => z.id === a.id); x.estadoRegistro = 'activo'; x.motivoInactivo = null; return l; },
        [{ accion:'reactivar', entidad:'activo', entidadId:a.id, campo:'estadoRegistro', anterior:'inactivo', nuevo:'activo', motivo:v.motivo }], 'Activo reactivado') });
  }
  function revisado(){
    const a = Storage.getActivo(_id); if(!a) return;
    _formulario({ titulo:'Marcar como revisado · activo ' + a.numero, boton:'Marcar revisado', info:'Motivos pendientes: ' + esc((a.revision.motivos || []).join('; ')),
      campos:[{ id:'motivo', label:'Resultado de la revisión', tipo:'textarea', req:true }],
      onOk: v => _persistir(l => { const x = l.find(z => z.id === a.id); x.revision = { pendiente:false, revisado:true, motivos:(x.revision && x.revision.motivos) || [], nota:v.motivo, por:Permisos.nombre(), en:new Date().toISOString() }; return l; },
        [{ accion:'marcar_revisado', entidad:'activo', entidadId:a.id, campo:null, motivo:v.motivo }], 'Marcado como revisado') });
  }

  // ---------- crear / editar ----------
  function nuevo(){
    if(!Permisos.esAdmin()){ UI.toast('Crear activos requiere el rol Administrador', 'err'); return; }
    const sig = Storage.getActivos().reduce((m, a) => Math.max(m, Number(a.numero) || 0), 0) + 1;
    _formEditar(null, sig);
  }
  function editar(){ const a = Storage.getActivo(_id); if(a) _formEditar(a); }

  function _formEditar(a, sig){
    const manual = !a || a.origen === 'manual';
    const campos = [
      { id:'numero', label:'No. de activo', tipo:'number', req:true, valor: a ? a.numero : sig, dis: !!a && a.numeroOrigen !== 'asignado' && a.origen !== 'manual', ayuda: a && a.numeroOrigen !== 'asignado' && a.origen !== 'manual' ? 'El número viene del Excel y no se cambia.' : '' },
      { id:'descripcion', label:'Descripción', req:true, valor: a ? a.descripcion : '' },
      { id:'proveedor', label:'Proveedor', valor: a ? a.proveedor : '' }, { id:'referencia', label:'Referencia / serial', valor: a ? a.referencia : '' },
      { id:'ubicacion', label:'Ubicación', valor: a ? a.ubicacion : '' },
      { id:'fechaAdquisicion', label:'Fecha de adquisición', tipo:'date', req:manual, valor: a ? a.fechaAdquisicion : '', dis:!manual },
      { id:'inicioDepreciacion', label:'Inicio de depreciación', tipo:'date', valor: a ? a.inicioDepreciacion : '', dis:!manual, ayuda: manual ? 'Si lo dejas vacío se calcula con la regla del archivo (día < 15: mismo mes; si no, mes siguiente).' : '' },
      { id:'valorAdquisicion', label:'Valor de adquisición (RD$)', tipo:'number', req:manual, valor: a ? a.valorAdquisicion : '', dis:!manual },
      { id:'cuentaActivo', label:'Cuenta del activo', req:manual, valor: a ? a.cuentaActivo : '', dis:!manual }, { id:'cuentaDepAcum', label:'Cuenta de depreciación acumulada', req:manual, valor: a ? a.cuentaDepAcum : '', dis:!manual },
      { id:'cuentaGasto', label:'Cuenta del gasto de depreciación', req:manual, valor: a ? a.cuentaGasto : '', dis:!manual },
      { id:'notas', label:'Notas', tipo:'textarea', valor: a ? a.notas : '' }
    ];
    const editables = ['numero', 'descripcion', 'proveedor', 'referencia', 'ubicacion', 'notas'].concat(manual ? ['fechaAdquisicion', 'inicioDepreciacion', 'valorAdquisicion', 'cuentaActivo', 'cuentaDepAcum', 'cuentaGasto'] : []);
    const vacio = x => x === undefined || x === null || x === '';
    const igual = (x, y) => vacio(x) ? vacio(y) : x === y;       // '' y null son lo mismo (campo sin valor)
    const calcCambios = v => editables.filter(k => !(a.numeroOrigen !== 'asignado' && a.origen !== 'manual' && k === 'numero') && !igual(a[k], k === 'numero' ? Number(v[k]) : v[k]));
    _formulario({ titulo: a ? 'Editar activo ' + a.numero : 'Nuevo activo', boton: a ? 'Guardar cambios' : 'Crear activo',
      info: a ? (manual ? '' : 'Los datos de adquisición, valor y cuentas vienen del corte importado y no se editan aquí: usa <b>Registrar ajuste</b> para dejar constancia de una corrección.') : 'El activo se crea como registro manual. Sus importes de depreciación se muestran como <b>calculados</b> hasta que aparezca en un corte importado.',
      campos,
      validar: v => {
        const num = Number(v.numero); if(!Number.isInteger(num) || num <= 0) return 'El número de activo debe ser un entero positivo';
        const otros = Storage.getActivos().filter(x => !a || x.id !== a.id);
        if(otros.some(x => Number(x.numero) === num)) return 'Ya existe un activo con el número ' + num;
        if(a && !calcCambios(v).length) return 'No hay cambios que guardar';
        if(manual){ if(!(v.valorAdquisicion > 0)) return 'El valor de adquisición debe ser mayor que cero'; if(v.fechaAdquisicion > hoy()) return 'La fecha de adquisición no puede ser futura'; if(v.inicioDepreciacion && v.fechaAdquisicion && v.inicioDepreciacion < v.fechaAdquisicion.slice(0, 7) + '-01') return 'El inicio de depreciación no puede ser anterior al mes de adquisición'; }
        return null;
      },
      onOk: async v => {
        if(v.referencia){ const dup = Storage.getActivos().filter(x => (!a || x.id !== a.id) && x.referencia && Utils.normalize(x.referencia) === Utils.normalize(v.referencia)); if(dup.length && !window.confirm('La referencia/serial "' + v.referencia + '" ya existe en el activo ' + dup.map(d => d.numero).join(', ') + '. ¿Guardar de todos modos?')) return false; }
        const ahora = new Date().toISOString();
        if(!a){
          const inicio = v.inicioDepreciacion || CalculoAF.inicioDepreciacion(v.fechaAdquisicion);
          return _persistir(l => { let id = 'AF-' + String(v.numero).padStart(4, '0'); while(l.some(x => x.id === id)) id += 'b';
              l.push({ id, numero:Number(v.numero), numeroExcel:null, numeroOrigen:'manual', huella:'', estadoRegistro:'activo', vidaUtilMeses:CalculoAF.VIDA_UTIL_MESES, fechaRetiro:null, motivoRetiro:null, importeRetiro:null,
                notas:v.notas || '', camposEditados:[], ajustes:[], origen:'manual', primerPeriodo:null, creadoEn:ahora, creadoPor:Permisos.nombre(), valores:{}, revision:{ pendiente:false, motivos:[] }, avisos:[],
                proveedor:v.proveedor, descripcion:v.descripcion, referencia:v.referencia, ubicacion:v.ubicacion, fechaAdquisicion:v.fechaAdquisicion, inicioDepreciacion:inicio, finDepreciacion:CalculoAF.finDepreciacion(inicio),
                valorAdquisicion:v.valorAdquisicion, cuentaActivo:v.cuentaActivo, cuentaDepAcum:v.cuentaDepAcum, cuentaGasto:v.cuentaGasto, actualizadoEn:ahora });
              return l; },
            [{ accion:'crear_activo', entidad:'activo', entidadId:'AF-' + String(v.numero).padStart(4, '0'), campo:'descripcion', anterior:null, nuevo:v.descripcion }], 'Activo creado');
        }
        const cambios = calcCambios(v);
        return _persistir(l => { const x = l.find(z => z.id === a.id);
            cambios.forEach(k => { x[k] = k === 'numero' ? Number(v[k]) : v[k]; if(a.origen !== 'manual' && k !== 'numero') x.camposEditados = Array.from(new Set((x.camposEditados || []).concat([k]))); });
            if(cambios.indexOf('numero') !== -1){ x.numeroOrigen = 'manual-asignado'; }
            if(manual && cambios.indexOf('fechaAdquisicion') !== -1 && !v.inicioDepreciacion){ x.inicioDepreciacion = CalculoAF.inicioDepreciacion(x.fechaAdquisicion); }
            if(manual && (cambios.indexOf('inicioDepreciacion') !== -1 || cambios.indexOf('fechaAdquisicion') !== -1)) x.finDepreciacion = CalculoAF.finDepreciacion(x.inicioDepreciacion);
            x.actualizadoEn = ahora; return l; },
          cambios.map(k => ({ accion:'editar_activo', entidad:'activo', entidadId:a.id, campo:k, anterior:a[k] === undefined ? null : a[k], nuevo:k === 'numero' ? Number(v[k]) : v[k] })), 'Cambios guardados');
      } });
  }

  // ---------- ficha imprimible ----------
  function imprimir(id){
    const a = Storage.getActivo(id || _id); if(!a) return;
    const per = Datos.periodo(), r = Datos.fila(a, per), v = r.v;
    const nombres = Storage.getSettings().cuentasNombres || {};
    const f = (l, x) => '<tr><td class="l">' + l + '</td><td>' + x + '</td></tr>';
    const cuenta = c => c ? esc(c) + (nombres[c] ? ' — ' + esc(nombres[c]) : '') : '—';
    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Ficha de activo ' + esc(a.numero) + '</title><style>@page{size:A4;margin:16mm}body{font-family:Arial,sans-serif;color:#1f2937;font-size:12.5px}h1{font-size:18px;margin:0}h2{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#1d4ed8;border-bottom:1.5px solid #cbd5e1;padding-bottom:3px;margin:16px 0 6px}table{width:100%;border-collapse:collapse}td{padding:5px 6px;border-bottom:1px solid #e5e7eb;vertical-align:top}td.l{width:38%;color:#64748b}.sub{color:#64748b;font-size:11px}.badge{display:inline-block;padding:2px 9px;border-radius:99px;background:#eff6ff;color:#1d4ed8;font-weight:700;font-size:11px}</style></head><body>'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h1>GSTAR SERVICES S.A. — Ficha de activo fijo</h1><div class="sub">RNC 131751016</div></div><div style="text-align:right" class="sub">Generada: ' + new Date().toLocaleString('es-DO') + '<br>Período consultado: ' + esc(Datos.etiquetaPeriodo(per)) + ' · Corte ' + fecha(Datos.fechaCorte(per)) + '<br>Generó: ' + esc(Permisos.nombre()) + '</div></div>'
      + '<h2>Activo No. ' + esc(a.numero) + ' <span class="badge">' + esc(r.estado) + '</span></h2>'
      + '<h2>A · Identificación</h2><table>' + f('Descripción', esc(a.descripcion || '—')) + f('Proveedor', esc(a.proveedor || '—')) + f('Referencia / serial', esc(a.referencia || '—')) + f('Ubicación', esc(a.ubicacion || '—')) + f('Categoría', esc(r.categoria)) + '</table>'
      + '<h2>B · Adquisición</h2><table>' + f('Fecha de adquisición', fecha(a.fechaAdquisicion)) + f('Inicio de depreciación', fecha(a.inicioDepreciacion)) + f('Valor de adquisición', money(a.valorAdquisicion)) + f('Fin de depreciación (calculado)', fecha(a.finDepreciacion)) + f('Fecha de retiro', a.fechaRetiro ? fecha(a.fechaRetiro) : 'No retirado') + '</table>'
      + '<h2>C · Depreciación (' + (v ? (v.tipo === 'registrado' ? 'registrada en el corte' : 'calculada') : 'sin datos') + ')</h2><table>' + f('Vida útil', (a.vidaUtilMeses || 60) + ' meses') + f('Depreciación mensual', money(v && v.depMensual)) + f('Meses depreciados', v && v.mesesDepreciados !== null && v.mesesDepreciados !== undefined ? Math.round(v.mesesDepreciados * 10) / 10 : '—') + f('Depreciación acumulada', money(v && v.amAcumulada)) + f('Importe pendiente de depreciar', money(v && v.pendiente)) + f('Gasto de depreciación del período', money(v && v.gastoPeriodo)) + '</table>'
      + '<h2>D · Información contable</h2><table>' + f('Cuenta del activo', cuenta(a.cuentaActivo)) + f('Cuenta de depreciación acumulada', cuenta(a.cuentaDepAcum)) + f('Cuenta del gasto de depreciación', cuenta(a.cuentaGasto)) + '</table>'
      + ((a.ajustes && a.ajustes.length) ? '<h2>Ajustes posteriores</h2><table>' + a.ajustes.map(j => f(fecha(j.fecha) + ' · ' + esc(ETQ[j.campo] || j.campo), esc(j.anterior === null ? '—' : j.anterior) + ' → <b>' + esc(j.nuevo) + '</b> · ' + esc(j.motivo))).join('') + '</table>' : '')
      + '</body></html>';
    const w = window.open('', '_blank', 'width=900,height=700');
    if(!w){ UI.toast('El navegador bloqueó la ventana de impresión', 'err'); return; }
    w.document.write(html); w.document.close(); w.focus();
    w.onload = () => { w.print(); };
  }

  return { abrir, cerrar, refrescar, retiro, anularRetiro, ajuste, inactivar, reactivar, revisado, nuevo, editar, accionOk, imprimir };
})();
window.Ficha = Ficha;
