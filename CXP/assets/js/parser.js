/* ============================================================
   Parser — importa el Excel de Cuentas por Pagar
   Busca una hoja con cabecera: Proveedor, Número de Factura,
   Monto Total / Saldo Pendiente, Estado (formato "Detalle CXP")
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

  function _normEstado(val){
    const v = Utils.normalize(val);
    if(v === 'PAGADA') return 'Pagada';
    if(v === 'PAGAR') return 'Pagar';
    return 'Pendiente';
  }

  function _normMoneda(val){
    const v = String(val||'').trim().toUpperCase();
    return v.includes('US') ? 'US$' : 'RD$';
  }

  // Llave natural para upsert: no destruye Estado/observaciones ya editados localmente
  function rowKey(r){
    return [Utils.normalize(r.proveedor), Utils.normalize(r.numeroFactura), r.fecha, r.montoTotal].join('|');
  }

  // Exige Proveedor/Suplidor + Estado + (Saldo Pendiente o Monto Total): evita
  // confundir la hoja de detalle con otras hojas de proyección que también
  // mencionan "suplidor" y "monto" pero no son el reporte de CXP por factura.
  function _findHeaderRow(aoa){
    for(let r = 0; r < Math.min(aoa.length, 20); r++){
      const row = aoa[r].map(c => Utils.normalize(String(c||'')));
      const hasProveedor = row.some(c => c === 'PROVEEDOR' || c === 'SUPLIDOR');
      const hasEstado    = row.some(c => c === 'ESTADO');
      const hasMontoKey  = row.some(c => c === 'MONTO TOTAL' || c === 'SALDO PENDIENTE' || c === 'PENDIENTE' || c === 'MONTO');
      if(hasProveedor && hasEstado && hasMontoKey) return r;
    }
    return -1;
  }

  function _mapColumns(headerRow){
    const colMap = {};
    headerRow.forEach((raw, i) => {
      const h = Utils.normalize(String(raw||''));
      if(h === 'FECHA DE FACTURA' || h === 'FECHA FACTURA')        colMap.fecha = i;
      else if(h === 'PROVEEDOR' || h === 'SUPLIDOR')               colMap.proveedor = i;
      else if(h === 'RNC')                                         colMap.rnc = i;
      else if(h.startsWith('COMPROBANTE'))                         colMap.comprobanteFiscal = i;
      else if(h.startsWith('NUMERO DE FACTURA') || h === 'FACTURA' || h === 'NO FACTURA') colMap.numeroFactura = i;
      else if(h.startsWith('FECHA DE VENCIMIENTO') || h === 'VENCIMIENTO') colMap.fechaVencimiento = i;
      else if(h === 'MONEDA')                                      colMap.moneda = i;
      else if(h === 'MONTO TOTAL' || h === 'MONTO')                colMap.montoTotal = i;
      else if(h === 'MONTO PAGADO')                                colMap.montoPagado = i;
      else if(h === 'SALDO PENDIENTE' || h === 'PENDIENTE')        colMap.saldoPendiente = i;
      else if(h === 'ESTADO')                                      colMap.estado = i;
      else if(h === 'DETALLE' || h === 'CONCEPTO')                 colMap.detalle = i;
      else if(h.startsWith('TIPO DE GASTO'))                       colMap.tipoGasto = i;
    });
    return colMap;
  }

  function parseWorkbook(wb){
    let best = null;
    // Prioriza hojas tipo "Detalle CXP" si existen, antes que otras hojas de proyección
    const ordered = [...wb.SheetNames].sort((a,b) => {
      const score = n => /CXP/i.test(n) ? 0 : 1;
      return score(a) - score(b);
    });
    for(const sn of ordered){
      const ws = wb.Sheets[sn];
      const aoa = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:'' });
      const headerIdx = _findHeaderRow(aoa);
      if(headerIdx === -1) continue;
      const colMap = _mapColumns(aoa[headerIdx]);
      if(colMap.proveedor === undefined) continue;

      const rows = [];
      for(let r = headerIdx + 1; r < aoa.length; r++){
        const row = aoa[r];
        const proveedor = String(row[colMap.proveedor]||'').trim();
        if(!proveedor) continue;
        const montoTotal     = colMap.montoTotal !== undefined ? _parseNum(row[colMap.montoTotal]) : 0;
        const montoPagado    = colMap.montoPagado !== undefined ? _parseNum(row[colMap.montoPagado]) : 0;
        const saldoPendiente = colMap.saldoPendiente !== undefined ? _parseNum(row[colMap.saldoPendiente]) : (montoTotal - montoPagado);
        const fecha = colMap.fecha !== undefined ? _excelDateToISO(row[colMap.fecha]) : '';
        const d = fecha ? Utils.parseISODate(fecha) : null;

        rows.push({
          id: Utils.uid('cxp'),
          empresa: 'Gstar Services',
          fecha,
          mes: d ? d.getMonth()+1 : 0,
          año: d ? d.getFullYear() : 0,
          proveedor,
          rnc: colMap.rnc !== undefined ? String(row[colMap.rnc]||'').trim() : '',
          comprobanteFiscal: colMap.comprobanteFiscal !== undefined ? String(row[colMap.comprobanteFiscal]||'').trim() : '',
          numeroFactura: colMap.numeroFactura !== undefined ? String(row[colMap.numeroFactura]||'').trim() : '',
          fechaVencimiento: colMap.fechaVencimiento !== undefined ? _excelDateToISO(row[colMap.fechaVencimiento]) : fecha,
          moneda: colMap.moneda !== undefined ? _normMoneda(row[colMap.moneda]) : 'RD$',
          montoTotal,
          montoPagado,
          saldoPendiente,
          estado: colMap.estado !== undefined ? _normEstado(row[colMap.estado]) : 'Pendiente',
          detalle: colMap.detalle !== undefined ? String(row[colMap.detalle]||'').trim() : '',
          tipoGasto: colMap.tipoGasto !== undefined ? String(row[colMap.tipoGasto]||'').trim() : ''
        });
      }
      if(rows.length){ best = { sheetName: sn, rows }; break; }
    }
    if(!best) throw new Error('No se encontró una hoja con el formato esperado.\nVerifica que el archivo tenga columnas: Proveedor, Número de Factura, Monto/Saldo Pendiente, Estado.');
    return best;
  }

  function parseFile(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.onload = () => {
        try{
          const wb = XLSX.read(reader.result, { type:'array', cellDates:true });
          resolve(parseWorkbook(wb));
        }catch(err){ reject(err); }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  return { parseFile, rowKey };
})();
