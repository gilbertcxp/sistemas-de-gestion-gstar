/* ============================================================
   Storage — persistencia en localStorage + sincronización
   Claves: cxp_rows, cxp_settings, cxp_bank, cxp_solicitudes
   ============================================================ */
const Storage = (() => {

  const K_ROWS        = 'cxp_rows';
  const K_SETTINGS     = 'cxp_settings';
  const K_BANK         = 'cxp_bank';
  const K_SOLICITUDES  = 'cxp_solicitudes';
  const K_COUNTER      = 'cxp_sol_counter';   // consecutivo local, no sincronizado

  const DEFAULT_SETTINGS = {
    adminPin: '1234',
    empresa: {
      nombre: 'Gstar Services S.A',
      rnc: '131751016'
    }
  };
  const DEFAULT_BANK = {
    cuentaLabel: 'Balance en banco BR cuenta No. 9600882715',
    balanceBanco: 0,
    chequesTransito: 0,
    provisiones: 0,
    depositos: 0
  };

  // Claves que se comparten entre todos los usuarios (sincronizadas a la nube)
  const SHARED_KEYS = [K_ROWS, K_SETTINGS, K_BANK, K_SOLICITUDES];
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
  // en Supabase lo que otros usuarios ya guardaron (p.ej. "cxp_solicitudes" con []).
  // Sync.pull() ya se encarga de sembrar la nube solo cuando de verdad está vacía.
  function _seedLocal(key, value){
    if(localStorage.getItem(key) === null){
      try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){}
    }
  }
  function init(){
    _seedLocal(K_ROWS, []);
    _seedLocal(K_SETTINGS, DEFAULT_SETTINGS);
    _seedLocal(K_BANK, DEFAULT_BANK);
    _seedLocal(K_SOLICITUDES, []);
    if(localStorage.getItem(K_COUNTER) === null) localStorage.setItem(K_COUNTER, '0');
  }

  // ---------- Rows (Detalle de CXP) ----------
  function getRows(){ return _get(K_ROWS, []); }
  function saveRows(list){ return _set(K_ROWS, list); }
  function updateRow(id, patch){
    const list = getRows();
    const idx = list.findIndex(r => r.id === id);
    if(idx >= 0){ list[idx] = {...list[idx], ...patch}; saveRows(list); return list[idx]; }
    return null;
  }
  function deleteRow(id){
    saveRows(getRows().filter(r => r.id !== id));
  }
  function clearRows(){ return _set(K_ROWS, []); }

  // ---------- Settings ----------
  function getSettings(){ return {...DEFAULT_SETTINGS, ..._get(K_SETTINGS, DEFAULT_SETTINGS)}; }
  function saveSettings(patch){
    const s = {...getSettings(), ...patch};
    _set(K_SETTINGS, s);
    return s;
  }

  // ---------- Bank (disponibilidad para Solicitud de Pago) ----------
  function getBank(){ return {...DEFAULT_BANK, ..._get(K_BANK, DEFAULT_BANK)}; }
  function saveBank(patch){
    const b = {...getBank(), ...patch};
    _set(K_BANK, b);
    return b;
  }

  // ---------- Solicitudes (historial) ----------
  function getSolicitudes(){ return _get(K_SOLICITUDES, []); }
  function saveSolicitudes(list){ return _set(K_SOLICITUDES, list); }
  function upsertSolicitud(sol){
    const list = getSolicitudes();
    const idx = list.findIndex(s => s.id === sol.id);
    if(idx >= 0){ list[idx] = sol; } else { list.unshift(sol); }
    saveSolicitudes(list);
    return sol;
  }
  function deleteSolicitud(id){
    saveSolicitudes(getSolicitudes().filter(s => s.id !== id));
  }

  // ---------- Numeración consecutiva (local — no sincronizada) ----------
  function getNextNumero(){
    const current = parseInt(localStorage.getItem(K_COUNTER) || '0', 10);
    const next = current + 1;
    localStorage.setItem(K_COUNTER, String(next));
    return next;
  }
  function getNumeroActual(){
    return parseInt(localStorage.getItem(K_COUNTER) || '0', 10);
  }

  // ---------- Selección temporal (NO se sincroniza — es local/personal) ----------
  const K_SELECCION = 'cxp_seleccion';
  function getSeleccion(){ return _get(K_SELECCION, []); }
  function saveSeleccion(ids){
    try{ localStorage.setItem(K_SELECCION, JSON.stringify(ids)); }catch(e){}
  }

  // ---------- Backup / restore / reset ----------
  function exportBackup(){
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      rows: getRows(),
      settings: getSettings(),
      bank: getBank(),
      solicitudes: getSolicitudes(),
      solicitudesCounter: getNumeroActual()
    };
  }
  function importBackup(obj){
    if(!obj || typeof obj !== 'object') throw new Error('Archivo inválido');
    if(Array.isArray(obj.rows)) saveRows(obj.rows);
    if(obj.settings) _set(K_SETTINGS, obj.settings);
    if(obj.bank) _set(K_BANK, obj.bank);
    if(Array.isArray(obj.solicitudes)) saveSolicitudes(obj.solicitudes);
    if(typeof obj.solicitudesCounter === 'number'){
      localStorage.setItem(K_COUNTER, String(obj.solicitudesCounter));
    }
  }
  function resetAll(){
    localStorage.removeItem(K_ROWS);
    localStorage.removeItem(K_SETTINGS);
    localStorage.removeItem(K_BANK);
    localStorage.removeItem(K_SOLICITUDES);
    localStorage.removeItem(K_SELECCION);
    localStorage.removeItem(K_COUNTER);
    init();
  }

  return {
    init,
    getRows, saveRows, updateRow, deleteRow, clearRows,
    getSettings, saveSettings,
    getBank, saveBank,
    getSolicitudes, saveSolicitudes, upsertSolicitud, deleteSolicitud,
    getNextNumero, getNumeroActual,
    getSeleccion, saveSeleccion,
    exportBackup, importBackup, resetAll,
    applyRemote, getSharedKeys
  };
})();
