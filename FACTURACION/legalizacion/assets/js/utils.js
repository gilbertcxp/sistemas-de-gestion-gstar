/* ============================================================
   Utils — formato, fechas, normalización de texto, helpers
   (copiado de CAJACHICA/assets/js/utils.js + excelDateToISO propio)
   ============================================================ */
const Utils = (() => {

  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

  function fmtMoney(n){
    n = Number(n)||0;
    return 'RD$ ' + n.toLocaleString('es-DO', {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  function fmtNum(n){
    n = Number(n)||0;
    return n.toLocaleString('es-DO', {minimumFractionDigits:2, maximumFractionDigits:2});
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
      .normalize('NFD').replace(/[̀-ͯ]/g,'')
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

  return { fmtMoney, fmtNum, parseISODate, toISODate, fmtDate, fmtDateLong, addDays, todayISO, daysBetween,
           excelDateToISO, normalize, uid, escapeHtml, jsAttr, debounce, download, MESES };
})();
window.Utils = Utils;
