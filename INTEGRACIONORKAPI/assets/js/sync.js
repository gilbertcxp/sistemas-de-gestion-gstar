/* ============================================================
   Sync — sincronización con Supabase (tabla app_state: key text PK, value jsonb, updated_at, updated_by)
   Mismo patrón que Activo Fijo / Compensación, con una diferencia: las SEMANAS (ork_sem_AAAA-Sxx, con los
   archivos originales y los resultados) pueden ser muchas y pesadas, así que NO se bajan todas al abrir:
     - pull():          trae solo las claves base (config, catálogo, índice de semanas, libro de créditos, auditoría)
     - pullKey(k):      trae UNA semana cuando se abre
     - push / pushNow:  suben una clave (pushNow espera la confirmación de Supabase)
   Si no hay window.db o falla la tabla, el módulo sigue funcionando con datos locales (y avisa al guardar).
   ============================================================ */
const Sync = (() => {
  const TABLE = 'app_state';
  const _pushTimers = {};
  let _ready = false;

  function _db(){ return window.db || null; }
  function _email(){
    try{ const u = window.Auth && Auth.getUser && Auth.getUser(); return u ? u.email : null; }
    catch(e){ return null; }
  }

  async function _upsert(key, value){
    const db = _db();
    if(!db) return false;
    try{
      const { error } = await db.from(TABLE).upsert(
        { key, value, updated_at: new Date().toISOString(), updated_by: _email() },
        { onConflict: 'key' }
      );
      if(error){ console.warn('Sync.upsert', key, error.message); return false; }
      return true;
    }catch(e){ console.warn('Sync.upsert ex', key, e); return false; }
  }

  // Trae las claves base de la nube; si una no existe todavía, la siembra con lo local (solo cuando de verdad está vacía)
  async function pull(){
    const db = _db();
    if(!db){ return { ok:false, reason:'no-db' }; }
    try{
      const base = Storage.getBaseKeys();
      const { data, error } = await db.from(TABLE).select('key,value').in('key', base);
      if(error){ console.warn('Sync.pull', error.message); return { ok:false, reason:error.message }; }
      const remote = {};
      (data || []).forEach(row => { remote[row.key] = row.value; });
      for(const key of base){
        if(Object.prototype.hasOwnProperty.call(remote, key) && remote[key] !== null){
          Storage.applyRemote(key, remote[key]);            // la nube gana
        }else{
          const localRaw = localStorage.getItem(key);        // sembrar la nube
          if(localRaw !== null){ await _upsert(key, JSON.parse(localRaw)); }
        }
      }
      _ready = true;
      return { ok:true };
    }catch(e){ console.warn('Sync.pull ex', e); return { ok:false, reason:String(e) }; }
  }

  // Trae UNA clave (p. ej. una semana). Devuelve { ok, existe }
  async function pullKey(key){
    const db = _db();
    if(!db) return { ok:false, reason:'no-db' };
    try{
      const { data, error } = await db.from(TABLE).select('key,value').eq('key', key);
      if(error){ return { ok:false, reason:error.message }; }
      const row = (data || [])[0];
      if(row && row.value !== null){ Storage.applyRemote(key, row.value); return { ok:true, existe:true }; }
      return { ok:true, existe:false };
    }catch(e){ return { ok:false, reason:String(e) }; }
  }

  function push(key, value){
    clearTimeout(_pushTimers[key]);
    _pushTimers[key] = setTimeout(() => { _upsert(key, value); }, 400);
  }

  // Envío inmediato y confirmado: devuelve { ok, reason }
  async function pushNow(key){
    const db = _db();
    if(!db) return { ok:false, reason:'no-db' };
    clearTimeout(_pushTimers[key]);
    const raw = localStorage.getItem(key);
    if(raw === null) return { ok:false, reason:'sin-dato-local' };
    const ok = await _upsert(key, JSON.parse(raw));
    return ok ? { ok:true } : { ok:false, reason:'error-supabase' };
  }

  // Cambios hechos por OTROS usuarios en tiempo real (claves base y semanas)
  function subscribeRealtime(onChange){
    const db = _db();
    if(!db || !db.channel) return;
    try{
      db.channel('app_state_rt_integracion_orkapi')
        .on('postgres_changes', { event:'*', schema:'public', table:TABLE }, payload => {
          const row = payload.new;
          if(!row || !row.key || !Storage.esCompartida(row.key)) return;
          if(row.updated_by && row.updated_by === _email()) return; // ignora el eco propio
          Storage.applyRemote(row.key, row.value);
          if(typeof onChange === 'function') onChange(row.key);
        })
        .subscribe();
    }catch(e){ console.warn('Sync.realtime', e); }
  }

  function isReady(){ return _ready; }

  return { pull, pullKey, push, pushNow, subscribeRealtime, isReady };
})();
window.Sync = Sync;
