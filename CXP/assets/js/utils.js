/* ============================================================
   Utils — formato, fechas, normalización de texto, helpers
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

  // Builds "08 al 14 Junio 2026" / "28 Mayo al 03 Junio 2026" style ranges
  function conceptoPeriodo(desdeISO, hastaISO){
    const d1 = parseISODate(desdeISO), d2 = parseISODate(hastaISO);
    if(!d1 || !d2) return '';
    const cap = s => s.charAt(0).toUpperCase()+s.slice(1);
    const dd1 = String(d1.getDate()).padStart(2,'0');
    const dd2 = String(d2.getDate()).padStart(2,'0');
    if(d1.getMonth()===d2.getMonth() && d1.getFullYear()===d2.getFullYear()){
      return `${dd1} al ${dd2} ${cap(MESES[d1.getMonth()])} ${d1.getFullYear()}`;
    }
    if(d1.getFullYear()===d2.getFullYear()){
      return `${dd1} ${cap(MESES[d1.getMonth()])} al ${dd2} ${cap(MESES[d2.getMonth()])} ${d2.getFullYear()}`;
    }
    return `${dd1} ${cap(MESES[d1.getMonth()])} ${d1.getFullYear()} al ${dd2} ${cap(MESES[d2.getMonth()])} ${d2.getFullYear()}`;
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
  // Removes common generic prefixes to compare "core" identity
  function coreName(s){
    return normalize(s).replace(/^(CONSORCIO|GRUPO|UD)\s+/,'').trim();
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

  function initials(name){
    const parts = normalize(name).split(' ').filter(Boolean);
    if(parts.length===0) return '?';
    if(parts.length===1) return parts[0].slice(0,2);
    return (parts[0][0]||'') + (parts[1][0]||'');
  }

  // Deterministic color from string, restricted to brand-friendly hues
  function colorFor(name){
    const palette = ['#ED1556','#1768FF','#3E4095','#15875A','#B7791F','#C20F44','#0F4FCC'];
    let h = 0;
    for(const ch of String(name)) h = (h*31 + ch.charCodeAt(0)) >>> 0;
    return palette[h % palette.length];
  }

  function download(filename, blob){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
  }

  return { fmtMoney, fmtNum, parseISODate, toISODate, fmtDate, fmtDateLong, addDays, todayISO,
           conceptoPeriodo, normalize, coreName, uid, escapeHtml, jsAttr, debounce, initials, colorFor, download, MESES };
})();
