/* ============================================================
   Sync — sincronización de datos compartidos vía Supabase
   Tabla: app_state (key text PK, value jsonb, updated_at, updated_by)
   - pull():        nube -> local (al arrancar)
   - push(k,v):     local -> nube (en cada cambio, con debounce)
   - publishAll():  fuerza subir TODAS las claves locales a la nube
   - subscribeRealtime(cb): escucha cambios de otros usuarios
   Si no hay window.db o falla la tabla, la app sigue funcionando local.
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

  // Trae la data compartida de la nube y la aplica en local.
  // Si una clave no existe en la nube, siembra la nube con lo local.
  async function pull(){
    const db = _db();
    if(!db){ return { ok:false, reason:'no-db' }; }
    try{
      const { data, error } = await db.from(TABLE).select('key,value');
      if(error){ console.warn('Sync.pull', error.message); return { ok:false, reason:error.message }; }

      const remote = {};
      (data || []).forEach(row => { remote[row.key] = row.value; });

      for(const key of Storage.getSharedKeys()){
        if(Object.prototype.hasOwnProperty.call(remote, key) && remote[key] !== null){
          Storage.applyRemote(key, remote[key]);            // nube gana
        }else{
          const localRaw = localStorage.getItem(key);        // sembrar nube
          if(localRaw !== null){ await _upsert(key, JSON.parse(localRaw)); }
        }
      }
      _ready = true;
      return { ok:true };
    }catch(e){ console.warn('Sync.pull ex', e); return { ok:false, reason:String(e) }; }
  }

  // Trae las Transferencias entre Cuentas publicadas por Disponibilidad Bancaria
  // (captura-disponibilidad.html). No es una SHARED_KEY de este módulo: solo se lee.
  async function pullTransferData(){
    const db = _db();
    if(!db) return null;
    try{
      const { data, error } = await db.from(TABLE).select('value').eq('key','disponibilidad_transferencias_entre_cuentas').single();
      if(error || !data) return null;
      return data.value || null;
    }catch(e){ console.warn('Sync.pullTransferData', e); return null; }
  }

  // Empuje con debounce por clave (se llama desde Storage._set)
  function push(key, value){
    clearTimeout(_pushTimers[key]);
    _pushTimers[key] = setTimeout(() => { _upsert(key, value); }, 400);
  }

  // Sube a la fuerza TODAS las claves compartidas locales (acción de admin)
  async function publishAll(){
    const db = _db();
    if(!db){ return { ok:false, reason:'no-db' }; }
    let n = 0;
    for(const key of Storage.getSharedKeys()){
      const raw = localStorage.getItem(key);
      if(raw !== null){ if(await _upsert(key, JSON.parse(raw))) n++; }
    }
    return { ok:true, count:n };
  }

  // Escucha cambios en tiempo real hechos por OTROS usuarios
  function subscribeRealtime(onChange){
    const db = _db();
    if(!db || !db.channel) return;
    try{
      db.channel('app_state_rt')
        .on('postgres_changes', { event:'*', schema:'public', table:TABLE }, payload => {
          const row = payload.new;
          if(!row || !row.key) return;
          // Transferencias entre Cuentas (Disponibilidad Bancaria): no es SHARED_KEY local,
          // solo dispara resync del Saldo a Favor de Compensación.
          if(row.key === 'disponibilidad_transferencias_entre_cuentas'){
            if(typeof onChange === 'function') onChange(row.key);
            return;
          }
          if(Storage.getSharedKeys().indexOf(row.key) === -1) return;
          if(row.updated_by && row.updated_by === _email()) return; // ignora eco propio
          Storage.applyRemote(row.key, row.value);
          if(typeof onChange === 'function') onChange(row.key);
        })
        .subscribe();
    }catch(e){ console.warn('Sync.realtime', e); }
  }

  function isReady(){ return _ready; }

  return { pull, push, publishAll, subscribeRealtime, isReady, pullTransferData };
})();
window.Sync = Sync;
