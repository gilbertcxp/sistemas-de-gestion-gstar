/* ============================================================
   Storage — Juegos Virtuales: persistencia en localStorage + sincronización
   Mismo patrón que CAJACHICA / Legalización (blob JSON por clave en la
   tabla genérica app_state de Supabase — sin tablas SQL nuevas).

   Claves:
     jv_lotes      Lotes de importación ORKAPI. Cada lote lleva EMBEBIDAS sus
                   filas de venta (una por consorcio) => guardar un lote es
                   UNA sola escritura: o queda completo o no queda (sin
                   importaciones parciales).
     jv_facturas   Facturas generadas. Cada factura guarda loteId + filaId
                   (relación con la venta que la originó) y un snapshot del
                   cálculo y de los porcentajes usados.
     jv_auditoria  Bitácora (importaciones, facturas, anulaciones).
     jv_settings   PIN de administrador, correlativo de facturas.

   "Facturada" NO se guarda en la fila de venta: se deriva de las facturas
   no anuladas que la referencian (una sola fuente de verdad => no hay
   forma de que quede inconsistente).
   ============================================================ */
const Storage = (() => {

  const K_LOTES      = 'jv_lotes';
  const K_FACTURAS   = 'jv_facturas';
  const K_AUDITORIA  = 'jv_auditoria';
  const K_SETTINGS   = 'jv_settings';

  const DEFAULT_SETTINGS = {
    adminPin: '1234',
    prefijoFactura: 'JV-',
    prefijoGeneral: 'JVG-',     // factura GENERAL: numeración APARTE de las facturas normales
    diasVencimiento: 3,         // Vence = Emisión + 3 días (como el ejemplo de la plantilla: 07-Jun → 10-Jun)
    // Asiento contable (TXT de Entrada de Diario) — ver asiento.js
    cuentasAsiento: { ventas: '400125', premios: '400233', comision: '400234', distribucion: '400235' },
    descripcionAsiento: 'PARA RECLASICACION DE CUENTAS JUEGOS VIRTUALES',   // tal cual el archivo de ejemplo
    centrosCosto: {}            // { <código de consorcio ORKAPI>: IdCentroCosto } — se configura en la pantalla "Centros de costo"
  };

  const SHARED_KEYS = [K_LOTES, K_FACTURAS, K_AUDITORIA, K_SETTINGS];
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

  // Siembra valores por defecto SOLO en localStorage (sin empujar a la nube).
  function _seedLocal(key, value){
    if(localStorage.getItem(key) === null){
      try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){}
    }
  }
  function init(){
    _seedLocal(K_LOTES, []);
    _seedLocal(K_FACTURAS, []);
    _seedLocal(K_AUDITORIA, []);
    _seedLocal(K_SETTINGS, DEFAULT_SETTINGS);
  }

  // ---------- Lotes (con sus filas embebidas) ----------
  function getLotes(){ return _get(K_LOTES, []); }
  function saveLotes(list){ return _set(K_LOTES, list); }
  function getLote(id){ return getLotes().find(l => l.id === id) || null; }
  function getLotesActivos(){ return getLotes().filter(l => l.estado === 'Activo'); }

  // ---------- Facturas ----------
  function getFacturas(){ return _get(K_FACTURAS, []); }
  function saveFacturas(list){ return _set(K_FACTURAS, list); }
  function getFactura(id){ return getFacturas().find(f => f.id === id) || null; }
  function getFacturasVigentes(){ return getFacturas().filter(f => f.estado !== 'Anulada'); }

  const esGeneral = f => f.tipo === 'General';

  // Fila de venta (loteId+filaId) → factura NORMAL vigente que la usa (o null)
  function getFacturaDeFila(loteId, filaId){
    return getFacturasVigentes().find(f => !esGeneral(f) && f.loteId === loteId && f.filaId === filaId) || null;
  }

  // Factura GENERAL vigente de un lote (consolida todos los consorcios) o null
  function getFacturaGeneralDeLote(loteId){
    return getFacturasVigentes().find(f => esGeneral(f) && f.loteId === loteId) || null;
  }

  // Siguiente número correlativo de cada serie (normal: JV-0001… / general: JVG-0001…).
  // Toma el mayor ya usado en ESA serie (incluye anuladas — el número de una
  // factura anulada nunca se reutiliza) + 1. `lista` permite sumar lo que se
  // está generando en la misma tanda.
  function proximoNumero(tipo, lista){
    const general = tipo === 'General';
    const s = getSettings();
    const pref = general ? (s.prefijoGeneral || 'JVG-') : (s.prefijoFactura || 'JV-');
    let max = 0;
    (lista || getFacturas()).forEach(f => {
      if(esGeneral(f) !== general) return;
      const m = String(f.numero || '').match(/(\d+)\s*$/);
      if(m) max = Math.max(max, parseInt(m[1], 10));
    });
    return pref + String(max + 1).padStart(4, '0');
  }

  // ---------- Auditoría ----------
  function getAuditoria(){ return _get(K_AUDITORIA, []); }
  function addAuditoria(row){
    const list = getAuditoria();
    const nueva = { id: Utils.uid('aud'), createdAt: new Date().toISOString(), ...row };
    list.push(nueva);
    while(list.length > 2000) list.shift();   // evita que la bitácora crezca indefinidamente
    _set(K_AUDITORIA, list);
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
    getLotes, saveLotes, getLote, getLotesActivos,
    getFacturas, saveFacturas, getFactura, getFacturasVigentes, getFacturaDeFila, getFacturaGeneralDeLote, proximoNumero, esGeneral,
    getAuditoria, addAuditoria,
    getSettings, saveSettings,
    applyRemote, getSharedKeys,
    KEYS: { LOTES: K_LOTES, FACTURAS: K_FACTURAS, SETTINGS: K_SETTINGS }
  };
})();
window.Storage = Storage;
