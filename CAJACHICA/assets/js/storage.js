/* ============================================================
   Storage — Caja Chica: persistencia en localStorage + sincronización
   Claves: cc_movimientos, cc_reposiciones, cc_conceptos, cc_settings
   ============================================================ */
const Storage = (() => {

  const K_MOVIMIENTOS  = 'cc_movimientos';
  const K_REPOSICIONES = 'cc_reposiciones';
  const K_CONCEPTOS    = 'cc_conceptos';
  const K_SETTINGS     = 'cc_settings';
  const K_COUNTER       = 'cc_counter';        // consecutivo local, no sincronizado
  const K_PERIODO_ACTUAL = 'cc_periodo_actual';       // reposición de fondo fijo en curso
  const K_HISTORIAL_REPO = 'cc_reposiciones_historial'; // reposiciones ya archivadas
  const CAJAS = { sto_dgo:'', stgo:'_stgo' };
  let _currentCaja = 'sto_dgo';

  const DEFAULT_SETTINGS = {
    adminPin: '1234',
    balanceInicial: 0,
    montoMinimo: 0,
    responsablePrincipal: '',
    cuentaBancariaReposicion: '',
    moneda: 'RD$',
    estadoInicial: 'Activo',
    empresa: { nombre: 'Gstar Services S.A', rnc: '131751016' }
  };

  const DEFAULT_CONCEPTOS = [
    'Combustible', 'Papelería', 'Mensajería', 'Alimentación', 'Mantenimiento',
    'Parqueo', 'Peajes', 'Materiales', 'Transporte', 'Limpieza', 'Otros'
  ].map(nombre => ({ id: 'cpt_' + nombre.toLowerCase().replace(/[^a-z0-9]+/g,'_'), nombre, activo: true }));

  // Claves que se comparten entre todos los usuarios (sincronizadas a la nube)
  const BASE_SHARED_KEYS = [K_MOVIMIENTOS, K_REPOSICIONES, K_CONCEPTOS, K_SETTINGS, K_PERIODO_ACTUAL, K_HISTORIAL_REPO];
  const SHARED_KEYS = Object.values(CAJAS).flatMap(suffix => BASE_SHARED_KEYS.map(key => key + suffix));
  let _suppressSync = false;

  function _scopedKey(key){ return key + (CAJAS[_currentCaja] || ''); }
  function setCaja(caja){ _currentCaja = Object.prototype.hasOwnProperty.call(CAJAS, caja) ? caja : 'sto_dgo'; }
  function getCaja(){ return _currentCaja; }
  // ¿Esta clave (ya sufijada, tal como llega de Supabase) pertenece a la caja
  // dada? Se usa para que Sync NO dispare un re-render cuando cambia una caja
  // que el usuario ni siquiera está viendo (evita que la tabla se reconstruya
  // en medio de una edición — ej. al elegir una fecha — por cambios ajenos).
  function isKeyForCaja(key, caja){
    const suffix = CAJAS[caja] || '';
    if(suffix) return key.endsWith(suffix);
    // Caja por defecto (sin sufijo): la clave no debe terminar en el sufijo de NINGUNA otra caja.
    return !Object.values(CAJAS).some(s => s && key.endsWith(s));
  }

  function _get(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }catch(e){ console.error('Storage read error', key, e); return fallback; }
  }
  function _set(key, value){
    try{
      localStorage.setItem(key, JSON.stringify(value));
      if(!_suppressSync && SHARED_KEYS.indexOf(key) !== -1 && window.Sync){
        window.Sync.push(key, value);
      }
      return true;
    }catch(e){ console.error('Storage write error', key, e); return false; }
  }
  function applyRemote(key, value){
    _suppressSync = true;
    try{ localStorage.setItem(key, JSON.stringify(value)); }
    catch(e){ console.error('applyRemote error', key, e); }
    _suppressSync = false;
  }
  function getSharedKeys(){ return SHARED_KEYS.slice(); }

  // Siembra valores por defecto SOLO en localStorage, sin empujar a la nube: si se
  // dispara antes de que Sync.pull() traiga los datos reales, un push aquí borraría
  // en Supabase lo que otros usuarios ya guardaron. Sync.pull() siembra la nube
  // solo cuando de verdad está vacía.
  function _seedLocal(key, value){
    if(localStorage.getItem(key) === null){
      try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){}
    }
  }
  function init(){
    Object.values(CAJAS).forEach(suffix => {
      _seedLocal(K_MOVIMIENTOS + suffix, []);
      _seedLocal(K_REPOSICIONES + suffix, []);
      _seedLocal(K_CONCEPTOS + suffix, DEFAULT_CONCEPTOS);
      _seedLocal(K_SETTINGS + suffix, DEFAULT_SETTINGS);
      _seedLocal(K_PERIODO_ACTUAL + suffix, null);
      _seedLocal(K_HISTORIAL_REPO + suffix, []);
      if(localStorage.getItem(K_COUNTER + suffix) === null) localStorage.setItem(K_COUNTER + suffix, '0');
    });
  }

  // ---------- Movimientos ----------
  function getMovimientos(){ return _get(_scopedKey(K_MOVIMIENTOS), []); }
  function saveMovimientos(list){ return _set(_scopedKey(K_MOVIMIENTOS), list); }
  function addMovimiento(mov){ const list = getMovimientos(); list.push(mov); saveMovimientos(list); return mov; }
  function updateMovimiento(id, patch){
    const list = getMovimientos();
    const idx = list.findIndex(m => m.id === id);
    if(idx >= 0){ list[idx] = {...list[idx], ...patch}; saveMovimientos(list); return list[idx]; }
    return null;
  }
  function getMovimiento(id){ return getMovimientos().find(m => m.id === id) || null; }

  // ---------- Reposiciones (detalle extendido, ligado a un movimiento) ----------
  function getReposiciones(){ return _get(_scopedKey(K_REPOSICIONES), []); }
  function saveReposiciones(list){ return _set(_scopedKey(K_REPOSICIONES), list); }
  function addReposicion(rep){ const list = getReposiciones(); list.push(rep); saveReposiciones(list); return rep; }

  // ---------- Catálogo de Conceptos ----------
  function getConceptos(){ return _get(_scopedKey(K_CONCEPTOS), DEFAULT_CONCEPTOS); }
  function saveConceptos(list){ return _set(_scopedKey(K_CONCEPTOS), list); }
  function addConcepto(nombre){
    const list = getConceptos();
    list.push({ id: Utils.uid('cpt'), nombre, activo: true });
    saveConceptos(list);
  }
  function updateConcepto(id, patch){
    const list = getConceptos();
    const idx = list.findIndex(c => c.id === id);
    if(idx >= 0){ list[idx] = {...list[idx], ...patch}; saveConceptos(list); }
  }
  function deleteConcepto(id){
    saveConceptos(getConceptos().filter(c => c.id !== id));
  }

  // ---------- Reposición de fondo fijo (Movimientos) ----------
  function getPeriodoActual(){ return _get(_scopedKey(K_PERIODO_ACTUAL), null); }
  function savePeriodoActual(obj){ return _set(_scopedKey(K_PERIODO_ACTUAL), obj); }
  function getHistorialReposiciones(){ return _get(_scopedKey(K_HISTORIAL_REPO), []); }
  function addHistorialReposicion(item){
    const list = getHistorialReposiciones();
    list.push(item);
    return _set(_scopedKey(K_HISTORIAL_REPO), list);
  }

  // ---------- Settings ----------
  function getSettings(){ return {...DEFAULT_SETTINGS, ..._get(_scopedKey(K_SETTINGS), DEFAULT_SETTINGS)}; }
  function saveSettings(patch){
    const s = {...getSettings(), ...patch};
    _set(_scopedKey(K_SETTINGS), s);
    return s;
  }

  // ---------- Numeración consecutiva (local — no sincronizada) ----------
  function getNextNumero(){
    const counterKey = _scopedKey(K_COUNTER);
    const current = parseInt(localStorage.getItem(counterKey) || '0', 10);
    const next = current + 1;
    localStorage.setItem(counterKey, String(next));
    return 'CC-' + String(next).padStart(6, '0');
  }

  // ---------- Backup / restore / reset ----------
  function exportBackup(){
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      movimientos: getMovimientos(),
      reposiciones: getReposiciones(),
      conceptos: getConceptos(),
      settings: getSettings(),
      periodoActual: getPeriodoActual(),
      historialReposiciones: getHistorialReposiciones(),
      counter: parseInt(localStorage.getItem(_scopedKey(K_COUNTER)) || '0', 10)
    };
  }
  function importBackup(obj){
    if(!obj || typeof obj !== 'object') throw new Error('Archivo inválido');
    if(Array.isArray(obj.movimientos)) saveMovimientos(obj.movimientos);
    if(Array.isArray(obj.reposiciones)) saveReposiciones(obj.reposiciones);
    if(Array.isArray(obj.conceptos)) saveConceptos(obj.conceptos);
    if(obj.settings) _set(_scopedKey(K_SETTINGS), obj.settings);
    if(obj.periodoActual) savePeriodoActual(obj.periodoActual);
    if(Array.isArray(obj.historialReposiciones)) _set(_scopedKey(K_HISTORIAL_REPO), obj.historialReposiciones);
    if(typeof obj.counter === 'number') localStorage.setItem(_scopedKey(K_COUNTER), String(obj.counter));
  }
  function resetAll(){
    [K_MOVIMIENTOS,K_REPOSICIONES,K_CONCEPTOS,K_SETTINGS,K_PERIODO_ACTUAL,K_HISTORIAL_REPO,K_COUNTER]
      .forEach(key => localStorage.removeItem(_scopedKey(key)));
    init();
  }

  return {
    init, setCaja, getCaja, isKeyForCaja,
    getMovimientos, saveMovimientos, addMovimiento, updateMovimiento, getMovimiento,
    getReposiciones, saveReposiciones, addReposicion,
    getConceptos, saveConceptos, addConcepto, updateConcepto, deleteConcepto,
    getSettings, saveSettings,
    getPeriodoActual, savePeriodoActual, getHistorialReposiciones, addHistorialReposicion,
    getNextNumero,
    exportBackup, importBackup, resetAll,
    applyRemote, getSharedKeys
  };
})();
