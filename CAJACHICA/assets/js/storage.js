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
  const SHARED_KEYS = [K_MOVIMIENTOS, K_REPOSICIONES, K_CONCEPTOS, K_SETTINGS];
  let _suppressSync = false;

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
    _seedLocal(K_MOVIMIENTOS, []);
    _seedLocal(K_REPOSICIONES, []);
    _seedLocal(K_CONCEPTOS, DEFAULT_CONCEPTOS);
    _seedLocal(K_SETTINGS, DEFAULT_SETTINGS);
    if(localStorage.getItem(K_COUNTER) === null) localStorage.setItem(K_COUNTER, '0');
  }

  // ---------- Movimientos ----------
  function getMovimientos(){ return _get(K_MOVIMIENTOS, []); }
  function saveMovimientos(list){ return _set(K_MOVIMIENTOS, list); }
  function addMovimiento(mov){ const list = getMovimientos(); list.push(mov); saveMovimientos(list); return mov; }
  function updateMovimiento(id, patch){
    const list = getMovimientos();
    const idx = list.findIndex(m => m.id === id);
    if(idx >= 0){ list[idx] = {...list[idx], ...patch}; saveMovimientos(list); return list[idx]; }
    return null;
  }
  function getMovimiento(id){ return getMovimientos().find(m => m.id === id) || null; }

  // ---------- Reposiciones (detalle extendido, ligado a un movimiento) ----------
  function getReposiciones(){ return _get(K_REPOSICIONES, []); }
  function saveReposiciones(list){ return _set(K_REPOSICIONES, list); }
  function addReposicion(rep){ const list = getReposiciones(); list.push(rep); saveReposiciones(list); return rep; }

  // ---------- Catálogo de Conceptos ----------
  function getConceptos(){ return _get(K_CONCEPTOS, DEFAULT_CONCEPTOS); }
  function saveConceptos(list){ return _set(K_CONCEPTOS, list); }
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

  // ---------- Settings ----------
  function getSettings(){ return {...DEFAULT_SETTINGS, ..._get(K_SETTINGS, DEFAULT_SETTINGS)}; }
  function saveSettings(patch){
    const s = {...getSettings(), ...patch};
    _set(K_SETTINGS, s);
    return s;
  }

  // ---------- Numeración consecutiva (local — no sincronizada) ----------
  function getNextNumero(){
    const current = parseInt(localStorage.getItem(K_COUNTER) || '0', 10);
    const next = current + 1;
    localStorage.setItem(K_COUNTER, String(next));
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
      counter: parseInt(localStorage.getItem(K_COUNTER) || '0', 10)
    };
  }
  function importBackup(obj){
    if(!obj || typeof obj !== 'object') throw new Error('Archivo inválido');
    if(Array.isArray(obj.movimientos)) saveMovimientos(obj.movimientos);
    if(Array.isArray(obj.reposiciones)) saveReposiciones(obj.reposiciones);
    if(Array.isArray(obj.conceptos)) saveConceptos(obj.conceptos);
    if(obj.settings) _set(K_SETTINGS, obj.settings);
    if(typeof obj.counter === 'number') localStorage.setItem(K_COUNTER, String(obj.counter));
  }
  function resetAll(){
    localStorage.removeItem(K_MOVIMIENTOS);
    localStorage.removeItem(K_REPOSICIONES);
    localStorage.removeItem(K_CONCEPTOS);
    localStorage.removeItem(K_SETTINGS);
    localStorage.removeItem(K_COUNTER);
    init();
  }

  return {
    init,
    getMovimientos, saveMovimientos, addMovimiento, updateMovimiento, getMovimiento,
    getReposiciones, saveReposiciones, addReposicion,
    getConceptos, saveConceptos, addConcepto, updateConcepto, deleteConcepto,
    getSettings, saveSettings,
    getNextNumero,
    exportBackup, importBackup, resetAll,
    applyRemote, getSharedKeys
  };
})();
