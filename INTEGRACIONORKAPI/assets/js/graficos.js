/* ============================================================
   Graf — gráficos SVG simples (sin librerías): barras agrupadas y líneas. Valores en centavos.
   ============================================================ */
const Graf = (() => {
  const COLORES = ['#1768FF', '#ED1556', '#15875A', '#B7791F', '#7C3AED', '#0891B2'];
  const esc = s => Utils.escapeHtml(s);

  function abrev(c){
    const v = c / 100, a = Math.abs(v);
    if(a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + ' M';
    if(a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + ' K';
    return String(Math.round(v));
  }
  function escala(min, max){                                // 4–5 marcas "bonitas" (1-2-5) que incluyen el cero
    min = Math.min(min, 0); max = Math.max(max, 0); if(min === max) max = min + 100;
    const rango = max - min, paso0 = rango / 4, mag = Math.pow(10, Math.floor(Math.log10(paso0))), n = paso0 / mag;
    const paso = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
    const lo = Math.floor(min / paso) * paso, hi = Math.ceil(max / paso) * paso, marcas = [];
    for(let v = lo; v <= hi + paso / 2; v += paso) marcas.push(v);
    return { lo, hi, marcas };
  }
  function leyenda(series){ return '<div class="graf-ley">' + series.map((s, i) => `<span><i style="background:${s.color || COLORES[i % COLORES.length]}"></i>${esc(s.nombre)}</span>`).join('') + '</div>'; }
  const marco = (W, H, inner) => `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" style="display:block">${inner}</svg>`;

  function ejes(sc, W, H, m, etiquetas, xPos){
    let s = '';
    sc.marcas.forEach(v => { const y = m.t + (H - m.t - m.b) * (1 - (v - sc.lo) / (sc.hi - sc.lo)); s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="${v === 0 ? '#94a3b8' : '#e2e8f0'}" stroke-width="1"/><text x="${m.l - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#64748b">${abrev(v)}</text>`; });
    etiquetas.forEach((e, i) => { s += `<text x="${xPos(i)}" y="${H - m.b + 15}" text-anchor="middle" font-size="10" fill="#64748b">${esc(e)}</text>`; });
    return s;
  }

  function barras(el, etiquetas, series, opt){
    const W = 640, H = (opt && opt.alto) || 250, m = { l: 48, r: 10, t: 10, b: 24 };
    const todos = series.flatMap(s => s.valores); if(!todos.length){ el.innerHTML = '<div class="t-empty">Sin datos para graficar.</div>'; return; }
    const sc = escala(Math.min(...todos), Math.max(...todos)), n = etiquetas.length, ancho = (W - m.l - m.r) / n, k = series.length, bw = Math.min(34, ancho * 0.8 / k);
    const y = v => m.t + (H - m.t - m.b) * (1 - (v - sc.lo) / (sc.hi - sc.lo)), y0 = y(0);
    let s = ejes(sc, W, H, m, etiquetas, i => m.l + ancho * (i + .5));
    series.forEach((se, j) => se.valores.forEach((v, i) => {
      const x = m.l + ancho * (i + .5) - (k * bw) / 2 + j * bw, yy = y(v);
      s += `<rect x="${x}" y="${Math.min(yy, y0)}" width="${bw - 2}" height="${Math.max(1, Math.abs(yy - y0))}" rx="2" fill="${se.color || COLORES[j % COLORES.length]}"><title>${esc(se.nombre)} · ${esc(etiquetas[i])}: ${Dinero.fmt(v)}</title></rect>`;
    }));
    el.innerHTML = marco(W, H, s) + (series.length > 1 || (opt && opt.leyenda) ? leyenda(series) : '');
  }

  function lineas(el, etiquetas, series, opt){
    const W = 640, H = (opt && opt.alto) || 250, m = { l: 48, r: 14, t: 10, b: 24 };
    const todos = series.flatMap(s => s.valores.filter(v => v !== null)); if(!todos.length){ el.innerHTML = '<div class="t-empty">Sin datos para graficar.</div>'; return; }
    const sc = escala(Math.min(...todos), Math.max(...todos)), n = etiquetas.length, x = i => n === 1 ? (m.l + (W - m.l - m.r) / 2) : m.l + (W - m.l - m.r) * i / (n - 1);
    const y = v => m.t + (H - m.t - m.b) * (1 - (v - sc.lo) / (sc.hi - sc.lo));
    let s = ejes(sc, W, H, m, etiquetas, x);
    series.forEach((se, j) => {
      const col = se.color || COLORES[j % COLORES.length]; let d = '', abierto = false;
      se.valores.forEach((v, i) => { if(v === null){ abierto = false; return; } d += (abierto ? 'L' : 'M') + x(i) + ' ' + y(v) + ' '; abierto = true; });
      s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round"/>`;
      se.valores.forEach((v, i) => { if(v !== null) s += `<circle cx="${x(i)}" cy="${y(v)}" r="3.2" fill="${col}"><title>${esc(se.nombre)} · ${esc(etiquetas[i])}: ${Dinero.fmt(v)}</title></circle>`; });
    });
    el.innerHTML = marco(W, H, s) + (series.length > 1 ? leyenda(series) : '');
  }

  return { barras, lineas, abrev, COLORES };
})();
window.Graf = Graf;
