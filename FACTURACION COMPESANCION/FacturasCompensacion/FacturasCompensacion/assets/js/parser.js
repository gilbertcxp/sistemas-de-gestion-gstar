/* ============================================================
   Parser — lee el archivo de ventas/premios (consolidado)
   Soporta:
   1) .xls que en realidad es HTML (formato real del sistema:
      tabla CONSORCIO / BALANCE FINAL + fechas DESDE/HASTA)
   2) .xlsx / .xls binarios genéricos (vía SheetJS), detectando
      columnas por encabezado (Consorcio/Cliente + Balance/Monto)
   Devuelve siempre: { desde, hasta, rows:[{consorcio, balance}] }
   ============================================================ */
const Parser = (() => {

  function parseMoneyText(txt){
    if(txt == null) return 0;
    let s = String(txt).trim();
    if(s === '') return 0;
    let neg = false;
    if(/^\(.*\)$/.test(s)){ neg = true; s = s.slice(1,-1); }
    s = s.replace(/RD\$/gi,'').replace(/[^0-9.,\-]/g,'').trim();
    if(s.startsWith('-')){ neg = true; }
    // remove thousand separators (,) keep decimal point
    s = s.replace(/,/g,'');
    let n = parseFloat(s);
    if(isNaN(n)) n = 0;
    return neg ? -Math.abs(n) : n;
  }

  function looksLikeHTML(text){
    const head = text.slice(0,1500).toLowerCase();
    return head.includes('<html') || head.includes('<table') || head.includes('<!doctype') || head.includes('<div');
  }

  // ---------- Format 1: HTML disguised as .xls ----------
  function parseHTMLConsolidado(text){
    const doc = new DOMParser().parseFromString(text, 'text/html');

    // Fechas DESDE / HASTA: primeros dos ".pull-left" con forma de fecha
    let desde = '', hasta = '';
    const dateLike = /^\d{4}-\d{2}-\d{2}$/;
    const pullLeftEls = Array.from(doc.querySelectorAll('.pull-left'));
    const dates = pullLeftEls.map(e => e.textContent.trim()).filter(t => dateLike.test(t));
    if(dates.length >= 2){ desde = dates[0]; hasta = dates[1]; }
    else if(dates.length === 1){ desde = hasta = dates[0]; }

    // Tabla CONSORCIO / BALANCE FINAL: localizar por encabezado
    const tables = Array.from(doc.querySelectorAll('table'));
    let targetTable = null;
    for(const t of tables){
      const headTxt = Utils.normalize(t.querySelector('thead') ? t.querySelector('thead').textContent : t.rows[0]?.textContent || '');
      if(headTxt.includes('BALANCE') && headTxt.includes('CONSORCIO')){ targetTable = t; break; }
    }
    if(!targetTable){
      // fallback: la tabla más angosta (2 columnas) que no sea la matriz grande
      targetTable = tables.filter(t => (t.rows[0]?.cells.length||0) <= 3).sort((a,b)=>b.rows.length-a.rows.length)[0];
    }
    if(!targetTable) throw new Error('No se encontró la tabla de CONSORCIO / BALANCE FINAL en el archivo.');

    const rows = [];
    const bodyRows = targetTable.querySelectorAll('tbody tr').length ? targetTable.querySelectorAll('tbody tr') : targetTable.querySelectorAll('tr');
    bodyRows.forEach(tr => {
      const cells = tr.querySelectorAll('td');
      if(cells.length < 2) return;
      const consorcio = cells[0].textContent.trim();
      if(!consorcio || Utils.normalize(consorcio) === 'CONSORCIO') return;
      const balance = parseMoneyText(cells[1].textContent);
      rows.push({ consorcio, balance });
    });

    return { desde, hasta, rows, sourceLabel: 'COMPENSACION CONSOLIDADO (HTML)' };
  }

  // ---------- Format 2: binary xlsx/xls via SheetJS ----------
  function parseBinaryWorkbook(arrayBuffer){
    const wb = XLSX.read(arrayBuffer, { type:'array', cellDates:true });
    let best = null;

    for(const sheetName of wb.SheetNames){
      const ws = wb.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:'' });
      for(let r=0; r<Math.min(aoa.length, 15); r++){
        const row = aoa[r].map(c => Utils.normalize(c));
        const ciCons = row.findIndex(c => c.includes('CONSORCIO') || c.includes('CLIENTE'));
        const ciBal  = row.findIndex(c => c.includes('BALANCE') || c.includes('MONTO') || c === 'TOTAL');
        if(ciCons >= 0 && ciBal >= 0){
          const rows = [];
          for(let i=r+1; i<aoa.length; i++){
            const name = aoa[i][ciCons];
            if(name === undefined || name === '' || name === null) continue;
            const balance = parseMoneyText(aoa[i][ciBal]);
            rows.push({ consorcio: String(name).trim(), balance });
          }
          if(rows.length){ best = { desde:'', hasta:'', rows, sourceLabel:`Hoja "${sheetName}"` }; }
        }
      }
      if(best) break;
    }
    if(!best) throw new Error('No se pudo identificar columnas de Consorcio/Cliente y Balance/Monto en el archivo.');
    return best;
  }

  function parseFile(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      reader.onload = () => {
        try{
          const buf = reader.result;
          // Sniff: try decoding as text first to check for HTML signature
          const textDecoder = new TextDecoder('utf-8');
          const sampleText = textDecoder.decode(buf.slice(0, 4000));
          if(looksLikeHTML(sampleText)){
            const fullText = textDecoder.decode(buf);
            resolve(parseHTMLConsolidado(fullText));
          } else {
            resolve(parseBinaryWorkbook(buf));
          }
        }catch(err){ reject(err); }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  return { parseFile, parseMoneyText };
})();
