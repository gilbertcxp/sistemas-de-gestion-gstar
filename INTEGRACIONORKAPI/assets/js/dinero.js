/* ============================================================
   Dinero — aritmética monetaria en ENTEROS (centavos).

   Política explícita de redondeo (única en todo el módulo):
     • Todo importe se guarda y calcula en centavos enteros (sin coma flotante).
     • Una comisión = importe × tasa, con la tasa en puntos base (800 = 8 %, 200 = 2 %, 500 = 5 %).
     • El resultado se redondea a centavos "mitad hacia afuera de cero" (0.005 → 0.01 y −0.005 → −0.01),
       línea por línea (cada comisión de cada consorcio/producto), y los totales son la SUMA de las líneas
       ya redondeadas. Así lo que se muestra, se suma y se exporta siempre coincide.
     • Con importes enteros de pesos (como los reportes de ORKAPI) las comisiones del 2 %, 5 % y 8 %
       son exactas al centavo: el redondeo no interviene y el resultado es idéntico al del Excel.
   ============================================================ */
(function (root) {
  'use strict';

  // Texto/número → centavos enteros (null si no es un importe). Acepta "1,234,567.00", "-1,800.00", "(1,800.00)", "RD$ 5.00".
  function aCentavos(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100 + (v < 0 ? -1e-9 : 1e-9)) : null;
    let s = String(v).replace(/&nbsp;/g, ' ').trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/RD\$|\$|\s/g, '');
    if (s[0] === '-') { neg = !neg; s = s.slice(1); } else if (s[0] === '+') s = s.slice(1);
    s = s.replace(/,/g, '');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const parts = s.split('.'), e = parts[0], d = parts[1] || '';
    let c = parseInt(e, 10) * 100 + parseInt((d + '00').slice(0, 2), 10);
    if (d.length > 2 && parseInt(d[2], 10) >= 5) c += 1;          // más de 2 decimales: mitad hacia arriba
    return neg ? -c : c;
  }

  // Centavos → "1,234,567.00" (negativos con signo; la pantalla los pinta en rojo)
  function fmt(c) {
    if (c === null || c === undefined || isNaN(c)) return '—';
    const neg = c < 0, a = Math.abs(c), e = Math.floor(a / 100), d = String(a % 100).padStart(2, '0');
    return (neg ? '-' : '') + String(e).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + d;
  }
  const aNumero = c => c / 100;                                       // solo para exportar a Excel (celdas numéricas)

  // n / d redondeado mitad-hacia-afuera (enteros)
  function divRound(n, d) {
    const neg = n < 0, a = Math.abs(n), q = Math.floor((2 * a + d) / (2 * d));
    return neg ? -q : q;
  }
  const pct = (c, bp) => divRound(c * bp, 10000);                     // c × (bp / 10000)
  const bpATexto = bp => (bp / 100).toString().replace(/\.0+$/, '') + '%';

  const api = { aCentavos, fmt, aNumero, divRound, pct, bpATexto };
  root.Dinero = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
