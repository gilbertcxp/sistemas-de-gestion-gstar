/* ============================================================
   Parser — construye los Pagos Fijos desde la Antigüedad de Saldo
   e importa el Excel de Pagos Provisionales del Reporte de CXP.
   ============================================================ */
const Parser = (() => {

  function _excelDateToISO(val){
    if(val === null || val === undefined || val === '') return '';
    if(val instanceof Date){
      if(isNaN(val)) return '';
      return Utils.toISODate(val);
    }
    if(typeof val === 'number'){
      const d = new Date((val - 25569) * 86400 * 1000);
      return Utils.toISODate(d);
    }
    const s = String(val).trim();
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if(m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    const dt = new Date(s);
    return isNaN(dt) ? '' : Utils.toISODate(dt);
  }

  function _parseNum(val){
    if(val === null || val === undefined || val === '') return 0;
    if(typeof val === 'number') return val;
    const n = parseFloat(String(val).replace(/[A-Za-z$\s,]/g,''));
    return isNaN(n) ? 0 : n;
  }

  function _normMoneda(val){
    const v = String(val||'').trim().toUpperCase();
    return v.includes('US') ? 'US$' : 'RD$';
  }

  // Llave natural para upsert: no destruye Estado/observaciones ya editados localmente
  function rowKey(r){
    return [Utils.normalize(r.proveedor), Utils.normalize(r.numeroFactura), r.fecha, r.montoTotal].join('|');
  }

  // Hash corto y determinístico (para IDs estables de Pagos Fijos entre sincronizaciones)
  function _hash32(str){
    let h = 0;
    for(let i = 0; i < str.length; i++){ h = (h*31 + str.charCodeAt(i)) >>> 0; }
    return h.toString(36);
  }

  /* ============================================================
     Pagos Fijos — construidos a partir de la Antigüedad de Saldo
     (Supabase app_state, key 'cxp_aging_data', publicada desde
     CXP/antiguedad-cxp.html). Un registro por factura, no por
     proveedor. IDs determinísticos para que la sincronización
     no duplique registros ni pierda el Estado editado localmente.
     ============================================================ */
  function buildFijosFromAging(agingValue){
    const rows = [];
    if(!agingValue || !Array.isArray(agingValue.allRows)) return rows;
    agingValue.allRows.forEach(prov => {
      (prov.invoices || []).forEach(inv => {
        const monto = Math.abs(Number(inv.deuda) || 0);
        if(monto < 0.005) return; // sin saldo pendiente, no aplica al reporte
        const fecha = _excelDateToISO(inv.fecha) || '';
        const fechaVencimiento = _excelDateToISO(inv.vence) || fecha;
        const numeroFactura = String(inv.idDoc || inv.noFactura || '').trim();
        const key = ['FIJO', Utils.normalize(prov.name), Utils.normalize(numeroFactura), fecha].join('|');
        rows.push({
          id: 'fijo_' + _hash32(key),
          tipoPago: 'Fijo',
          empresa: 'Gstar Services',
          fecha,
          mes: 0, año: 0,
          proveedor: prov.name,
          rnc: '',
          comprobanteFiscal: inv.noFactura ? String(inv.noFactura).trim() : '',
          numeroFactura,
          fechaVencimiento,
          moneda: 'RD$',
          montoTotal: monto,
          montoPagado: 0,
          saldoPendiente: monto,
          estado: 'Pendiente',
          detalle: inv.descripcion ? String(inv.descripcion).trim() : '',
          tipoGasto: '',
          observaciones: ''
        });
      });
    });
    return rows;
  }

  /* ============================================================
     Pagos Provisionales — importación de Excel
     Columnas mínimas: Suplidor, No. Factura/Referencia, Fecha de
     Factura, Fecha de Vencimiento, Concepto, Moneda, Monto.
     No exige columna Estado (siempre entra como 'Pendiente').
     ============================================================ */
  function _findProvisionalHeaderRow(aoa){
    for(let r = 0; r < Math.min(aoa.length, 20); r++){
      const row = aoa[r].map(c => Utils.normalize(String(c||'')));
      const hasProveedor = row.some(c => c === 'PROVEEDOR' || c === 'SUPLIDOR');
      const hasMonto = row.some(c => c === 'MONTO' || c === 'MONTO TOTAL' || c === 'VALOR');
      if(hasProveedor && hasMonto) return r;
    }
    return -1;
  }

  function _mapProvisionalColumns(headerRow){
    const colMap = {};
    headerRow.forEach((raw, i) => {
      const h = Utils.normalize(String(raw||''));
      if(h === 'PROVEEDOR' || h === 'SUPLIDOR')                     colMap.proveedor = i;
      else if(h.startsWith('NUMERO DE FACTURA') || h.startsWith('REFERENCIA') ||
              h === 'FACTURA' || h === 'NO FACTURA' || h === 'NO FACTURA O REFERENCIA') colMap.numeroFactura = i;
      else if(h === 'FECHA DE FACTURA' || h === 'FECHA FACTURA' || h === 'FECHA') colMap.fecha = i;
      else if(h.startsWith('FECHA DE VENCIMIENTO') || h === 'VENCIMIENTO') colMap.fechaVencimiento = i;
      else if(h === 'CONCEPTO' || h === 'DETALLE')                  colMap.detalle = i;
      else if(h === 'MONEDA')                                       colMap.moneda = i;
      else if(h === 'MONTO' || h === 'MONTO TOTAL' || h === 'VALOR') colMap.montoTotal = i;
    });
    return colMap;
  }

  function parseProvisionalWorkbook(wb){
    let headerIdx = -1, colMap = null, sheetName = null, aoaUsed = null;
    for(const name of wb.SheetNames){
      const ws = wb.Sheets[name];
      const aoa = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:'' });
      const idx = _findProvisionalHeaderRow(aoa);
      if(idx !== -1){
        const map = _mapProvisionalColumns(aoa[idx]);
        if(map.proveedor !== undefined && map.montoTotal !== undefined){
          headerIdx = idx; colMap = map; sheetName = name; aoaUsed = aoa; break;
        }
      }
    }
    if(headerIdx === -1 || !colMap){
      throw new Error('No se encontró una hoja con el formato esperado.\nVerifica que el archivo tenga columnas: Suplidor, No. Factura o Referencia, Fecha de Factura, Fecha de Vencimiento, Concepto, Moneda, Monto.');
    }

    const rows = [];
    const errors = [];
    for(let r = headerIdx + 1; r < aoaUsed.length; r++){
      const row = aoaUsed[r];
      if(!row || row.every(c => c === '' || c === null || c === undefined)) continue;

      const proveedor = String(row[colMap.proveedor]||'').trim();
      const monto = colMap.montoTotal !== undefined ? _parseNum(row[colMap.montoTotal]) : 0;
      if(!proveedor && monto === 0) continue; // fila vacía

      if(!proveedor){ errors.push(`Fila ${r+1}: falta el suplidor.`); continue; }
      if(monto <= 0){ errors.push(`Fila ${r+1} (${proveedor}): el monto debe ser mayor a 0.`); continue; }

      const fecha = (colMap.fecha !== undefined ? _excelDateToISO(row[colMap.fecha]) : '') || Utils.todayISO();
      const fechaVencimiento = (colMap.fechaVencimiento !== undefined ? _excelDateToISO(row[colMap.fechaVencimiento]) : '') || fecha;

      rows.push({
        id: Utils.uid('prov'),
        tipoPago: 'Provisional',
        empresa: 'Gstar Services',
        fecha,
        mes: 0, año: 0,
        proveedor,
        rnc: '', comprobanteFiscal: '',
        numeroFactura: colMap.numeroFactura !== undefined ? String(row[colMap.numeroFactura]||'').trim() : '',
        fechaVencimiento,
        moneda: colMap.moneda !== undefined ? _normMoneda(row[colMap.moneda]) : 'RD$',
        montoTotal: monto,
        montoPagado: 0,
        saldoPendiente: monto,
        estado: 'Pendiente',
        detalle: colMap.detalle !== undefined ? String(row[colMap.detalle]||'').trim() : '',
        tipoGasto: '',
        observaciones: ''
      });
    }
    return { sheetName, rows, errors };
  }

  function parseProvisionalFile(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.onload = () => {
        try{
          const wb = XLSX.read(reader.result, { type:'array', cellDates:true });
          resolve(parseProvisionalWorkbook(wb));
        }catch(err){ reject(err); }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  return { rowKey, buildFijosFromAging, parseProvisionalFile };
})();
