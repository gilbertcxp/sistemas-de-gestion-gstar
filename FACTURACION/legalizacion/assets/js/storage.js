/* ============================================================
   Storage — Legalización: persistencia en localStorage + sincronización
   Mismo patrón que CAJACHICA/assets/js/storage.js (blob JSON por clave
   en la tabla genérica app_state — sin tablas SQL nuevas).
   Claves: fact_consorcios, fact_socios, fact_grupos, fact_puntos,
           fact_legalizaciones, fact_auditoria
   ============================================================ */
const Storage = (() => {

  const K_CONSORCIOS     = 'fact_consorcios';
  const K_SOCIOS         = 'fact_socios';
  const K_GRUPOS         = 'fact_grupos';
  const K_PUNTOS         = 'fact_puntos';
  const K_LEGALIZACIONES = 'fact_legalizaciones';
  const K_AUDITORIA      = 'fact_auditoria';
  const K_SETTINGS       = 'fact_settings';

  const DEFAULT_SETTINGS = {
    adminPin: '1234',
    umbralPorVencerDias: 15
  };

  const SHARED_KEYS = [K_CONSORCIOS, K_SOCIOS, K_GRUPOS, K_PUNTOS, K_LEGALIZACIONES, K_AUDITORIA, K_SETTINGS];
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

  // Siembra valores por defecto SOLO en localStorage, sin empujar a la nube —
  // Sync.pull() se encarga de sembrar la nube solo cuando de verdad está vacía.
  function _seedLocal(key, value){
    if(localStorage.getItem(key) === null){
      try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){}
    }
  }
  function init(){
    _seedLocal(K_CONSORCIOS, []);
    _seedLocal(K_SOCIOS, []);
    _seedLocal(K_GRUPOS, []);
    _seedLocal(K_PUNTOS, []);
    _seedLocal(K_LEGALIZACIONES, []);
    _seedLocal(K_AUDITORIA, []);
    _seedLocal(K_SETTINGS, DEFAULT_SETTINGS);
  }

  // ---------- Consorcios ----------
  function getConsorcios(){ return _get(K_CONSORCIOS, []); }
  function saveConsorcios(list){ return _set(K_CONSORCIOS, list); }
  function getConsorcio(id){ return getConsorcios().find(c => c.id === id) || null; }
  // find-or-create por nombre; devuelve la fila (existente o recién creada)
  function findOrCreateConsorcio(nombre){
    const list = getConsorcios();
    const norm = Utils.normalize(nombre);
    let row = list.find(c => Utils.normalize(c.nombre) === norm);
    if(row) return row;
    row = { id: Utils.uid('cns'), nombre: String(nombre).trim() };
    list.push(row);
    saveConsorcios(list);
    return row;
  }

  // ---------- Socios ----------
  function getSocios(){ return _get(K_SOCIOS, []); }
  function saveSocios(list){ return _set(K_SOCIOS, list); }
  function getSocio(id){ return getSocios().find(s => s.id === id) || null; }
  function findOrCreateSocio(nombre){
    const list = getSocios();
    const norm = Utils.normalize(nombre);
    let row = list.find(s => Utils.normalize(s.nombre) === norm);
    if(row) return row;
    row = { id: Utils.uid('soc'), nombre: String(nombre).trim() };
    list.push(row);
    saveSocios(list);
    return row;
  }

  // ---------- Grupos ----------
  function getGrupos(){ return _get(K_GRUPOS, []); }
  function saveGrupos(list){ return _set(K_GRUPOS, list); }
  function getGrupo(id){ return getGrupos().find(g => g.id === id) || null; }
  function getGrupoByNombre(nombre){
    const norm = Utils.normalize(nombre);
    return getGrupos().find(g => Utils.normalize(g.nombre) === norm) || null;
  }
  function findOrCreateGrupo(nombre, consorcioId, socioId){
    const list = getGrupos();
    const norm = Utils.normalize(nombre);
    let row = list.find(g => Utils.normalize(g.nombre) === norm);
    if(row) return row;
    row = { id: Utils.uid('grp'), nombre: String(nombre).trim(), consorcioId, socioId, activo: true };
    list.push(row);
    saveGrupos(list);
    return row;
  }

  // ---------- Puntos ----------
  function getPuntos(){ return _get(K_PUNTOS, []); }
  function savePuntos(list){ return _set(K_PUNTOS, list); }
  function getPunto(id){ return getPuntos().find(p => p.id === id) || null; }
  function getPuntosByGrupo(grupoId){ return getPuntos().filter(p => p.grupoId === grupoId); }
  // Mezcla filas nuevas/actualizadas en el catálogo existente (upsert por id local, único por external_id)
  function upsertPuntos(rows){
    const list = getPuntos();
    const byExternalId = new Map(list.map((p, idx) => [p.externalId, idx]));
    rows.forEach(row => {
      const idx = byExternalId.get(row.externalId);
      if(idx !== undefined){
        list[idx] = { ...list[idx], ...row, id: list[idx].id, updatedAt: new Date().toISOString() };
      }else{
        const nuevo = { id: Utils.uid('pto'), ...row, activo: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        list.push(nuevo);
        byExternalId.set(nuevo.externalId, list.length - 1);
      }
    });
    savePuntos(list);
    return list;
  }

  // ---------- Legalizaciones ----------
  function getLegalizaciones(){ return _get(K_LEGALIZACIONES, []); }
  function saveLegalizaciones(list){ return _set(K_LEGALIZACIONES, list); }
  function getLegalizacion(id){ return getLegalizaciones().find(l => l.id === id) || null; }
  function addLegalizacion(row){
    const list = getLegalizaciones();
    const nueva = {
      id: Utils.uid('leg'),
      estado: 'Vigente',
      creadoEn: new Date().toISOString(),
      anuladoPor: null, anuladoEn: null,
      ...row,
      cantidadPuntos: Array.isArray(row.puntoIds) ? row.puntoIds.length : 0
    };
    list.push(nueva);
    saveLegalizaciones(list);
    return nueva;
  }
  function anularLegalizacion(id, usuario){
    const list = getLegalizaciones();
    const idx = list.findIndex(l => l.id === id);
    if(idx < 0) return null;
    list[idx] = { ...list[idx], estado: 'Anulada', anuladoPor: usuario, anuladoEn: new Date().toISOString() };
    saveLegalizaciones(list);
    return list[idx];
  }

  // ---------- Auditoría ----------
  function getAuditoria(){ return _get(K_AUDITORIA, []); }
  function saveAuditoria(list){ return _set(K_AUDITORIA, list); }
  function addAuditoria(row){
    const list = getAuditoria();
    const nueva = { id: Utils.uid('aud'), createdAt: new Date().toISOString(), ...row };
    list.push(nueva);
    // Máximo 2000 filas — evita que la bitácora crezca indefinidamente en el blob.
    while(list.length > 2000) list.shift();
    saveAuditoria(list);
    return nueva;
  }

  // ---------- Settings ----------
  function getSettings(){ return {...DEFAULT_SETTINGS, ..._get(K_SETTINGS, DEFAULT_SETTINGS)}; }
  function saveSettings(patch){
    const s = {...getSettings(), ...patch};
    _set(K_SETTINGS, s);
    return s;
  }

  return {
    init,
    getConsorcios, saveConsorcios, getConsorcio, findOrCreateConsorcio,
    getSocios, saveSocios, getSocio, findOrCreateSocio,
    getGrupos, saveGrupos, getGrupo, getGrupoByNombre, findOrCreateGrupo,
    getPuntos, savePuntos, getPunto, getPuntosByGrupo, upsertPuntos,
    getLegalizaciones, saveLegalizaciones, getLegalizacion, addLegalizacion, anularLegalizacion,
    getAuditoria, saveAuditoria, addAuditoria,
    getSettings, saveSettings,
    applyRemote, getSharedKeys
  };
})();
window.Storage = Storage;
