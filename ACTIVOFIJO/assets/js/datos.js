/* ============================================================
   Datos — vistas derivadas del maestro de activos para un período:
   importes del período (registrados o calculados), estado y categoría.

   Distingue SIEMPRE el origen del importe:
     'registrado' → viene del corte importado (no se recalcula)
     'calculado'  → derivado con las fórmulas de la hoja (p. ej. activos
                    creados a mano que aún no están en un corte)
   ============================================================ */
const Datos = (() => {

  let _periodo = '';
  try{ _periodo = sessionStorage.getItem('afPeriodo') || ''; }catch(e){}

  function periodos(){
    const s = new Set();
    Storage.getImportaciones().forEach(i => { if(i.periodo) s.add(i.periodo); });
    Storage.getActivos().forEach(a => Object.keys(a.valores || {}).forEach(p => s.add(p)));
    return [...s].sort().reverse();
  }
  function periodo(){
    const ps = periodos();
    return (_periodo && ps.indexOf(_periodo) !== -1) ? _periodo : (ps[0] || '');
  }
  function setPeriodo(p){ _periodo = p; try{ sessionStorage.setItem('afPeriodo', p); }catch(e){} }

  // Importación más reciente de un período
  function importacionDe(per){
    const l = Storage.getImportaciones().filter(i => i.periodo === per);
    return l.length ? l[l.length - 1] : null;
  }
  function fechaCorte(per){
    const i = importacionDe(per);
    if(i && i.fechaCorte) return i.fechaCorte;
    const a = Storage.getActivos().find(x => x.valores && x.valores[per] && x.valores[per].fechaCorte);
    return a ? a.valores[per].fechaCorte : null;
  }
  function etiquetaPeriodo(per){ return per ? per.slice(5, 7) + '-' + per.slice(0, 4) : '—'; }

  // Un activo no forma parte de un período anterior a su alta: si el archivo de ese corte lo trae,
  // existe; si no, solo existe cuando ya estaba adquirido a la fecha de corte y ya figuraba en los
  // cortes importados (un activo adquirido después del corte, o que aparece por primera vez en un corte
  // posterior, no se muestra en ese período).
  function existeEn(a, per){
    if(a.valores && a.valores[per]) return true;
    const corte = fechaCorte(per);
    if(corte && a.fechaAdquisicion && a.fechaAdquisicion > corte) return false;
    if(a.primerPeriodo && a.primerPeriodo > per) return false;
    return true;
  }

  function valores(a, per){
    per = per || periodo();
    const v = a.valores && a.valores[per];
    if(v) return { ...v, tipo: 'registrado' };
    if(!existeEn(a, per)) return null;
    const corte = fechaCorte(per);
    if(corte && a.inicioDepreciacion && typeof a.valorAdquisicion === 'number'){
      return { ...CalculoAF.derivar(a.valorAdquisicion, a.inicioDepreciacion, corte, a.vidaUtilMeses), importeRetiro: null, tipo: 'calculado', fechaCorte: corte };
    }
    return null;
  }

  // "DEP. ACUM. MOB Y EQUIPOS DE OFI" → "MOB Y EQUIPOS DE OFI"; si no hay nombre, la cuenta
  function categoria(a){
    const n = (Storage.getSettings().cuentasNombres || {})[a.cuentaDepAcum];
    if(n) return String(n).replace(/^DEP\.?\s*ACUM\.?\s*/i, '').trim() || n;
    return a.cuentaActivo ? 'Cuenta ' + a.cuentaActivo : 'Sin categoría';
  }

  // Un retiro posterior a la fecha de corte no aplica a ese período (el activo aún estaba vigente)
  function estado(a, v, per){
    if(a.estadoRegistro === 'inactivo') return 'Inactivo';
    const corte = fechaCorte(per || periodo());
    const retirado = a.fechaRetiro && (!corte || a.fechaRetiro <= corte);
    return CalculoAF.estadoActivo(a.fechaRetiro && !retirado ? { ...a, fechaRetiro: null } : a, v);
  }

  function fila(a, per){
    per = per || periodo();
    const v = valores(a, per);
    return { a, v, estado: estado(a, v, per), categoria: categoria(a) };
  }
  function todas(per){ per = per || periodo(); return Storage.getActivos().filter(a => existeEn(a, per)).map(a => fila(a, per)); }

  // Totales de una lista de filas (los retirados e inactivos no cuentan como saldo vigente)
  function totales(rows){
    const t = { total: rows.length, costo: 0, acumulada: 0, pendiente: 0, gasto: 0, retirados: 0, totalDep: 0, enDep: 0, revision: 0, inactivos: 0 };
    rows.forEach(r => {
      if(r.estado === 'Retirado'){ t.retirados++; return; }
      if(r.estado === 'Inactivo'){ t.inactivos++; return; }
      t.costo += Number(r.a.valorAdquisicion) || 0;
      if(r.v){ t.acumulada += r.v.amAcumulada || 0; t.pendiente += r.v.pendiente || 0; t.gasto += r.v.gastoPeriodo || 0; }
      if(r.estado === 'Totalmente depreciado') t.totalDep++;
      else if(r.estado === 'En depreciación') t.enDep++;
      else if(r.estado === 'Pendiente de revisión') t.revision++;
    });
    return t;
  }

  return { periodos, periodo, setPeriodo, importacionDe, fechaCorte, etiquetaPeriodo, existeEn, valores, categoria, estado, fila, todas, totales };
})();
window.Datos = Datos;
