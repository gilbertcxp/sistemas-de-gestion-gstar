/* ============================================================
   Utils — formato, fechas, normalización de texto, helpers
   (copiado de CAJACHICA/assets/js/utils.js + helpers propios de Juegos Virtuales)
   ============================================================ */
const Utils = (() => {

  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

  function fmtMoney(n){
    n = Number(n)||0;
    return 'RD$ ' + fmtNum(n);
  }
  // Formato 1,234.56 con el MISMO redondeo que Excel: Excel trabaja con 15 dígitos
  // significativos y redondea .5 hacia arriba (JS redondearía 1043.725 a 1043.72
  // por su representación binaria; Excel muestra 1,043.73).
  function fmtNum(n){
    n = Number(n)||0;
    const abs = Math.abs(n);
    const s = abs.toPrecision(15);
    let cents;
    if(/e/i.test(s)){ cents = Math.round(abs * 100); }
    else{
      const [i, d = ''] = s.split('.');
      const f = (d + '000').slice(0, 3);
      cents = parseInt(i + f.slice(0, 2), 10) + (f[2] >= '5' ? 1 : 0);
    }
    const ent = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const res = ent + '.' + String(cents % 100).padStart(2, '0');
    return (n < 0 && cents) ? '-' + res : res;
  }
  // Parses 'YYYY-MM-DD' as a LOCAL date (avoids UTC off-by-one bugs)
  function parseISODate(s){
    if(!s) return null;
    const [y,m,d] = s.split('-').map(Number);
    if(!y||!m||!d) return null;
    return new Date(y, m-1, d);
  }
  function toISODate(d){
    if(!d) return '';
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function fmtDate(s){
    const d = typeof s === 'string' ? parseISODate(s) : s;
    if(!d || isNaN(d)) return '—';
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  }
  function fmtDateLong(s){
    const d = typeof s === 'string' ? parseISODate(s) : s;
    if(!d || isNaN(d)) return '—';
    return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
  }
  function addDays(s, days){
    const d = parseISODate(s);
    if(!d) return '';
    d.setDate(d.getDate()+Number(days||0));
    return toISODate(d);
  }
  function todayISO(){ return toISODate(new Date()); }
  function daysBetween(aISO, bISO){
    const a = parseISODate(aISO), b = parseISODate(bISO);
    if(!a || !b) return null;
    return Math.round((b - a) / 86400000);
  }

  // Convierte una fecha del Excel (Date nativo por cellDates:true, número
  // serial, o texto DD/MM/YYYY o YYYY-MM-DD) a ISO 'YYYY-MM-DD'.
  function excelDateToISO(val){
    if(val === null || val === undefined || val === '') return '';
    if(val instanceof Date){
      if(isNaN(val)) return '';
      return toISODate(val);
    }
    if(typeof val === 'number'){
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(val) * 86400000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    }
    const s = String(val).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if(m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    const dt = new Date(s);
    return isNaN(dt) ? '' : toISODate(dt);
  }

  // Strips accents, uppercases, collapses whitespace — for matching
  function normalize(s){
    return String(s||'')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toUpperCase()
      .replace(/[.,]/g,'')
      .replace(/\s+/g,' ')
      .trim();
  }

  function uid(prefix){
    return (prefix||'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
  }

  function escapeHtml(s){
    return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Safe to embed as: onclick="fn('VALUE')" — escapes for JS string context first, then HTML attribute
  function jsAttr(s){
    const jsEscaped = String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n').replace(/\r/g,'');
    return escapeHtml(jsEscaped);
  }

  function debounce(fn, ms){
    let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
  }

  function download(filename, blob){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
  }

  // Redondeo a centavos (misma precisión con la que Excel muestra "#,##0.00")
  function round2(n){ return Math.round((Number(n)||0) * 100) / 100; }

  // Convierte una celda del Excel a número. Devuelve null si no es un número válido.
  // Acepta números nativos y textos tipo "1,234.50". Vacío/'' => 0 si emptyAsZero.
  function parseNumber(v, emptyAsZero){
    if(typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v == null ? '' : v).trim();
    if(s === '') return emptyAsZero ? 0 : null;
    if(!/^-?\(?-?[\d.,]+\)?$/.test(s)) return null;
    const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
    const n = parseFloat(s.replace(/[(),-]/g, '').replace(/,/g, ''));
    return isNaN(n) ? null : (neg ? -n : n);
  }

  // SHA-256 (hex) del contenido de un archivo — para detectar el mismo archivo importado dos veces
  async function sha256Hex(arrayBuffer){
    try{
      if(window.crypto && crypto.subtle){
        const buf = await crypto.subtle.digest('SHA-256', arrayBuffer);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
      }
    }catch(e){}
    // Respaldo (contextos sin crypto.subtle): hash FNV-1a de 32 bits + longitud
    const u8 = new Uint8Array(arrayBuffer); let h = 0x811c9dc5;
    for(let i = 0; i < u8.length; i++){ h ^= u8[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return 'fnv-' + h.toString(16) + '-' + u8.length;
  }

  return { fmtMoney, fmtNum, round2, parseNumber, sha256Hex, parseISODate, toISODate, fmtDate, fmtDateLong, addDays, todayISO, daysBetween,
           excelDateToISO, normalize, uid, escapeHtml, jsAttr, debounce, download, MESES };
})();
window.Utils = Utils;
