/* ============================================================
   Storage — Integración ORKAPI: persistencia local + sincronización (app_state de Supabase)

   Claves compartidas:
     ork_config      Tasas de comisión por producto (con historial de cambios), reglas, PIN, patrones de producto.
     ork_catalogo    Catálogo de consorcios (ID interno estable, código ORKAPI, nombre, alias, tipo, estado).
     ork_semanas     Índice liviano de semanas (estado y totales) para el Control semanal y el Dashboard.
     ork_sem_AAAA-Sxx  Detalle de UNA semana: archivos originales, filas importadas, resultados y consolidados.
     ork_creditos    Libro auxiliar de saldos a favor (solo crece; se corrige con reversiones).
     ork_auditoria   Bitácora de acciones (quién, cuándo, qué).

   Los importes son centavos enteros y las tasas puntos base (ver dinero.js).
   ============================================================ */
const Storage = (() => {

  const K_CONFIG = 'ork_config', K_CAT = 'ork_catalogo', K_SEM = 'ork_semanas', K_CRED = 'ork_creditos', K_AUDIT = 'ork_auditoria';
  const PREFIJO = 'ork_sem_';
  const BASE = [K_CONFIG, K_CAT, K_SEM, K_CRED, K_AUDIT];

  const DEFAULT_CONFIG = () => ({
    adminPin: '1234',
    loteria: 'LA PRIMERA',
    productos: JSON.parse(JSON.stringify(SemanaORK.PRODUCTOS_DEF)),
    tasasHistorial: [],                         // [{producto, ventasBp, premiosBp, anteriorVentasBp, anteriorPremiosBp, por, en, motivo}]
    creditoDesdeNegativos: 'desactivado'        // 'desactivado' | 'propuesta' (el sistema sugiere; un responsable aprueba uno a uno)
  });

  let _suppressSync = false;
  const _listeners = [];
  function onChange(cb){ if(typeof cb === 'function') _listeners.push(cb); }
  function _emit(key){ _listeners.forEach(cb => { try{ cb(key); }catch(e){ console.warn('Storage.onChange', e); } }); }

  const esCompartida = k => BASE.indexOf(k) !== -1 || String(k).indexOf(PREFIJO) === 0;
  function getBaseKeys(){ return BASE.slice(); }

  function _get(key, fallback){
    try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch(e){ console.error('Storage read error', key, e); return fallback; }
  }
  function _set(key, value){
    try{
      localStorage.setItem(key, JSON.stringify(value));
      if(!_suppressSync && esCompartida(key) && window.Sync){ window.Sync.push(key, value); }
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
  function _seedLocal(key, value){ if(localStorage.getItem(key) === null){ try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){} } }
  function init(){
    _seedLocal(K_CONFIG, DEFAULT_CONFIG());
    _seedLocal(K_CAT, []);
    _seedLocal(K_SEM, []);
    _seedLocal(K_CRED, []);
    _seedLocal(K_AUDIT, []);
  }

  // ---------- Configuración ----------
  function getConfig(){
    const d = DEFAULT_CONFIG(), c = _get(K_CONFIG, d);
    const productos = {}; Object.keys(d.productos).forEach(p => { productos[p] = { ...d.productos[p], ...(c.productos && c.productos[p]) }; });
    return { ...d, ...c, productos };
  }
  function saveConfig(cfg){ return _set(K_CONFIG, cfg); }
  const getProductosCfg = () => getConfig().productos;

  // ---------- Catálogo ----------
  function getCatalogo(){ return _get(K_CAT, []); }
  function saveCatalogo(list){ return _set(K_CAT, list); }
  const getCatalogoActivo = () => getCatalogo().filter(c => c.estado !== 'inactivo').sort((a, b) => a.id - b.id);

  // ---------- Semanas ----------
  const claveSemana = id => PREFIJO + id;
  function getIndice(){ return _get(K_SEM, []); }
  function getSemana(id){ return _get(claveSemana(id), null); }
  // Guarda el detalle y actualiza su fila del índice. Devuelve las claves escritas (para guardarSeguro)
  function saveSemana(sem){
    sem.actualizadoEn = new Date().toISOString();
    _set(claveSemana(sem.id), sem);
    const idx = getIndice().filter(x => x.id !== sem.id); idx.push(SemanaORK.indice(sem));
    idx.sort((a, b) => a.anio - b.anio || a.semana - b.semana);
    _set(K_SEM, idx);
    return [claveSemana(sem.id), K_SEM];
  }
  // Trae la versión más reciente de la nube y la devuelve (si la nube no responde, la local)
  async function cargarSemana(id){
    if(window.Sync){ try{ await Sync.pullKey(claveSemana(id)); }catch(e){} }
    return getSemana(id);
  }

  // ---------- Libro de créditos ----------
  function getCreditos(){ return _get(K_CRED, []); }
  function saveCreditos(list){ return _set(K_CRED, list); }

  // ---------- Auditoría ----------
  function getAuditoria(){ return _get(K_AUDIT, []); }
  function addAuditoria(row){
    const list = getAuditoria();
    list.push({ id: Utils.uid('aud'), createdAt: new Date().toISOString(), ...row });
    while(list.length > 8000) list.shift();
    _set(K_AUDIT, list);
  }

  return {
    init, onChange, esCompartida, getBaseKeys, applyRemote,
    getConfig, saveConfig, getProductosCfg, getCatalogo, saveCatalogo, getCatalogoActivo,
    getIndice, getSemana, saveSemana, cargarSemana, claveSemana,
    getCreditos, saveCreditos, getAuditoria, addAuditoria,
    KEYS: { CONFIG: K_CONFIG, CATALOGO: K_CAT, SEMANAS: K_SEM, CREDITOS: K_CRED, AUDIT: K_AUDIT }
  };
})();
window.Storage = Storage;
