/* ============================================================
   Storage — persistencia en localStorage
   Claves: fc_clients, fc_invoices, fc_counter, fc_settings
   ============================================================ */
const Storage = (() => {

  const K_CLIENTS  = 'fc_clients';
  const K_INVOICES = 'fc_invoices';
  const K_COUNTER  = 'fc_counter';
  const K_SETTINGS = 'fc_settings';

  const DEFAULT_SETTINGS = {
    porcentaje: 2,
    diasVencimiento: 30,
    adminPin: '1234',
    vendedor: '8- ELUIN P.',
    entregadoPor: 'Eluin Polanco',
    empresa: {
      nombre: 'Gstar Services S.A',
      rnc: '131751016',
      direccion: 'AV. WINSTON CHURCHILL NO. 1099, CITI TOWER, ACROPOLIS CENTER, PISO 16-AB',
      telefono: '(809) 262-1001',
      cuenta: '9605078497 del Banco de Reservas'
    }
  };

  function _get(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }catch(e){ console.error('Storage read error', key, e); return fallback; }
  }
  function _set(key, value){
    try{
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    }catch(e){ console.error('Storage write error', key, e); return false; }
  }

  function init(){
    if(localStorage.getItem(K_CLIENTS) === null){
      const seeded = SEED_CLIENTS.map(c => ({ id: Utils.uid('cli'), ...c }));
      _set(K_CLIENTS, seeded);
    }
    if(localStorage.getItem(K_INVOICES) === null) _set(K_INVOICES, []);
    if(localStorage.getItem(K_COUNTER) === null) _set(K_COUNTER, 0);
    if(localStorage.getItem(K_SETTINGS) === null) _set(K_SETTINGS, DEFAULT_SETTINGS);
  }

  // ---------- Clients ----------
  function getClients(){ return _get(K_CLIENTS, []); }
  function saveClients(list){ return _set(K_CLIENTS, list); }
  function upsertClient(client){
    const list = getClients();
    if(client.id){
      const idx = list.findIndex(c => c.id === client.id);
      if(idx >= 0){ list[idx] = {...list[idx], ...client}; saveClients(list); return list[idx]; }
    }
    const { id, ...rest } = client; // descarta cualquier id nulo/vacío antes de generar uno nuevo
    const newClient = { id: Utils.uid('cli'), rnc:'', telefono:'', correo:'', contacto:'', direccion:'', ...rest };
    list.push(newClient);
    saveClients(list);
    return newClient;
  }
  function deleteClient(id){
    saveClients(getClients().filter(c => c.id !== id));
  }

  // ---------- Invoices ----------
  function getInvoices(){ return _get(K_INVOICES, []); }
  function saveInvoices(list){ return _set(K_INVOICES, list); }
  function addInvoices(newOnes){
    const list = getInvoices();
    list.push(...newOnes);
    saveInvoices(list);
    return list;
  }
  function updateInvoice(numero, patch){
    const list = getInvoices();
    const idx = list.findIndex(i => i.numero === numero);
    if(idx >= 0){ list[idx] = {...list[idx], ...patch}; saveInvoices(list); }
    return list[idx];
  }
  function deleteInvoice(numero){
    saveInvoices(getInvoices().filter(i => i.numero !== numero));
  }

  // ---------- Counter / numbering ----------
  function getCounter(){ return _get(K_COUNTER, 0); }
  function setCounter(n){ _set(K_COUNTER, n); }
  function nextInvoiceNumber(){
    let n = getCounter() + 1;
    setCounter(n);
    return 'FC-' + String(n).padStart(6,'0');
  }
  function peekNextInvoiceNumber(){
    return 'FC-' + String(getCounter()+1).padStart(6,'0');
  }

  // ---------- Settings ----------
  function getSettings(){ return _get(K_SETTINGS, DEFAULT_SETTINGS); }
  function saveSettings(patch){
    const s = {...getSettings(), ...patch};
    _set(K_SETTINGS, s);
    return s;
  }

  // ---------- Data Rows (historial de compensación) ----------
  const K_DATA_ROWS = 'fc_data_rows';
  const K_BANK_DATA = 'fc_bank_data';

  function getDataRows(){ return _get(K_DATA_ROWS, []); }
  function saveDataRows(list){ return _set(K_DATA_ROWS, list); }
  function clearDataRows(){ return _set(K_DATA_ROWS, []); }
  function updateDataRow(id, patch){
    const list = getDataRows();
    const idx = list.findIndex(r => r.id === id);
    if(idx >= 0){ list[idx] = {...list[idx], ...patch}; saveDataRows(list); return list[idx]; }
    return null;
  }

  // ---------- Bank Data (balances para Solicitud de Pago) ----------
  const DEFAULT_BANK = { balanceComp:0, transferencia:0, balanceOperativa:0 };
  function getBankData(){ return _get(K_BANK_DATA, DEFAULT_BANK); }
  function saveBankData(data){ return _set(K_BANK_DATA, {...getBankData(), ...data}); }

  // ---------- Backup / restore / reset ----------
  function exportBackup(){
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      clients: getClients(),
      invoices: getInvoices(),
      counter: getCounter(),
      settings: getSettings(),
      dataRows: getDataRows(),
      bankData: getBankData()
    };
  }
  function importBackup(obj){
    if(!obj || typeof obj !== 'object') throw new Error('Archivo inválido');
    if(Array.isArray(obj.clients)) saveClients(obj.clients);
    if(Array.isArray(obj.invoices)) saveInvoices(obj.invoices);
    if(typeof obj.counter === 'number') setCounter(obj.counter);
    if(obj.settings) _set(K_SETTINGS, obj.settings);
    if(Array.isArray(obj.dataRows)) saveDataRows(obj.dataRows);
    if(obj.bankData) saveBankData(obj.bankData);
  }
  function resetAll(){
    localStorage.removeItem(K_CLIENTS);
    localStorage.removeItem(K_INVOICES);
    localStorage.removeItem(K_COUNTER);
    localStorage.removeItem(K_SETTINGS);
    localStorage.removeItem(K_DATA_ROWS);
    localStorage.removeItem(K_BANK_DATA);
    init();
  }

  return {
    init,
    getClients, saveClients, upsertClient, deleteClient,
    getInvoices, saveInvoices, addInvoices, updateInvoice, deleteInvoice,
    getCounter, setCounter, nextInvoiceNumber, peekNextInvoiceNumber,
    getSettings, saveSettings,
    getDataRows, saveDataRows, clearDataRows, updateDataRow,
    getBankData, saveBankData,
    exportBackup, importBackup, resetAll
  };
})();
