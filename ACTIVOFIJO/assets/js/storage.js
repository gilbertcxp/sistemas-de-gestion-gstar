/* ============================================================
   Storage — Activo Fijo: persistencia en localStorage + sincronización
   Mismo patrón que el resto del sistema (blob JSON por clave en la tabla
   genérica app_state de Supabase — sin tablas SQL nuevas).

   Claves:
     af_activos       Maestro de activos. Cada activo guarda además sus importes
                      REGISTRADOS por período en activo.valores['AAAA-MM'] (el
                      corte importado nunca se sobrescribe) y sus ajustes.
     af_importaciones Historial de importaciones (qué archivo/hoja, quién, cuándo,
                      resumen, conciliación con los totales del archivo).
     af_auditoria     Bitácora de cambios (usuario, fecha, campo, valor anterior y nuevo).
     af_settings      PIN de administrador y nombres de cuentas contables.

   No se elimina ningún activo: se inactiva (estadoRegistro = 'inactivo').
   ============================================================ */
const Storage = (() => {

  const K_ACTIVOS = 'af_activos';
  const K_IMPORT  = 'af_importaciones';
  const K_AUDIT   = 'af_auditoria';
  const K_SETT    = 'af_settings';

  const DEFAULT_SETTINGS = {
    adminPin: '1234',
    cuentasNombres: {}            // { '110203': 'DEP. ACUM. MOB Y EQUIPOS DE OFI', ... } (tomado del asiento del archivo)
  };

  const SHARED_KEYS = [K_ACTIVOS, K_IMPORT, K_AUDIT, K_SETT];
  let _suppressSync = false;
  const _listeners = [];
  function onChange(cb){ if(typeof cb === 'function') _listeners.push(cb); }
  function _emit(key){ _listeners.forEach(cb => { try{ cb(key); }catch(e){ console.warn('Storage.onChange', e); } }); }

  function _get(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }catch(e){ console.error('Storage read error', key, e); return fallback; }
  }
  function _set(key, value){
    try{
      localStorage.setItem(key, JSON.stringify(value));
      if(!_suppressSync && SHARED_KEYS.indexOf(key) !== -1 && window.Sync){ window.Sync.push(key, value); }
      _emit(key);
      return true;
    }catch(e){ console.error('Storage write error', key, e); return false; }
  }
  function applyRemote(key, value){
    _suppressSync = true;
    try{ localStorage.setItem(key, JSON.stringify(value)); }
    catch(e){ console.error('applyRemote error', key, e); }
    _suppressSync = false;
    _emit(key);
  }
  function getSharedKeys(){ return SHARED_KEYS.slice(); }

  // Siembra SOLO en localStorage (sin empujar a la nube): Sync.pull() siembra la nube solo si de verdad está vacía.
  function _seedLocal(key, value){
    if(localStorage.getItem(key) === null){ try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){} }
  }
  function init(){
    _seedLocal(K_ACTIVOS, []);
    _seedLocal(K_IMPORT, []);
    _seedLocal(K_AUDIT, []);
    _seedLocal(K_SETT, DEFAULT_SETTINGS);
  }

  // ---------- Activos ----------
  function getActivos(){ return _get(K_ACTIVOS, []); }
  function saveActivos(list){ return _set(K_ACTIVOS, list); }
  function getActivo(id){ return getActivos().find(a => a.id === id) || null; }
  function updateActivo(id, patch){
    const list = getActivos();
    const i = list.findIndex(a => a.id === id);
    if(i < 0) return null;
    list[i] = { ...list[i], ...patch, actualizadoEn: new Date().toISOString() };
    saveActivos(list);
    return list[i];
  }

  // ---------- Importaciones ----------
  function getImportaciones(){ return _get(K_IMPORT, []); }
  function saveImportaciones(list){ return _set(K_IMPORT, list); }

  // ---------- Auditoría ----------
  function getAuditoria(){ return _get(K_AUDIT, []); }
  function addAuditoria(row){
    const list = getAuditoria();
    list.push({ id: Utils.uid('aud'), createdAt: new Date().toISOString(), ...row });
    while(list.length > 5000) list.shift();
    _set(K_AUDIT, list);
  }

  // ---------- Settings ----------
  function getSettings(){ return {...DEFAULT_SETTINGS, ..._get(K_SETT, DEFAULT_SETTINGS)}; }
  function saveSettings(patch){ const s = {...getSettings(), ...patch}; _set(K_SETT, s); return s; }

  return {
    init, onChange,
    getActivos, saveActivos, getActivo, updateActivo,
    getImportaciones, saveImportaciones,
    getAuditoria, addAuditoria,
    getSettings, saveSettings,
    applyRemote, getSharedKeys,
    KEYS: { ACTIVOS: K_ACTIVOS, IMPORT: K_IMPORT, AUDIT: K_AUDIT, SETT: K_SETT }
  };
})();
window.Storage = Storage;
