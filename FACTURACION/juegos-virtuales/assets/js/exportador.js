/* ============================================================
   Exportador — vista de la factura, Excel y PDF.

   Formato de factura vigente (el aprobado por el negocio):
     - Encabezado dentro de una caja: logo, GSTAR SERVICES SA, RNC, dirección,
       "Corte <desde> al <hasta>", Cliente / Teléfono / Dirección y
       Id Doc (N° de factura) / Fecha / Vence.
     - Cuadro: Venta Bruta, Premios, Resultado, Deducciones, Distribución
       70/30, Deducciones por parte, TOTAL y TOTAL A PAGAR.
     - Pie: RECIBIDO POR / ENTREGADO POR (nombre = usuario que cargó las
       ventas), sello y cuenta de depósito.

   EXCEL: parte del archivo ORIGINAL de la plantilla (fórmulas intactas) y lo
   adapta a este formato — ver plantilla-excel.js.
   PDF / pantalla: réplica HTML del mismo formato.
   ============================================================ */
const Exportador = (() => {

  const PLANTILLA_URL = 'assets/plantilla/formato-factura-jv.xlsx';
  const EMPRESA = {
    nombre: 'GSTAR SERVICES SA',
    rnc: 'RNC: 131751016',
    dir: 'AV. WINSTON CHURCHILL NO. 1099, CITI TOWER, ACROPOLIS CENTER, PISO 16-AB'
  };
  const CUENTA_DEPOSITO = 'Depositar en cuenta corriente: 9600882715 del Banco de Reservas a nombre de Gstar Services, S.A';
  const ETIQUETAS_EXCEL = {
    A14: '(-) Pago de Premios',
    A16: 'Deducciones(Jackpot,Agentes de venta y Hipodromo)',
    A24: '(-) Comisión Banquera (0.5% Vta Bruta)'
  };

  const usd = v => { const s = Utils.fmtNum(Math.abs(Number(v) || 0)); return ((Number(v) || 0) < 0 && s !== '0.00' ? '-' : '') + '$' + s; };
  const acct = v => { const s = Utils.fmtNum(Math.abs(Number(v) || 0)); return ((Number(v) || 0) < 0 && s !== '0.00') ? '(' + s + ')' : s; };
  const pct = (x, d) => (x * 100).toFixed(d == null ? 1 : d).replace(/\.0+$/, '') + '%';

  const MES_C = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const MES_D = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const fCorte = iso => { const d = Utils.parseISODate(iso); return d ? String(d.getDate()).padStart(2, '0') + '-' + MES_C[d.getMonth()] + '-' + d.getFullYear() : ''; };
  const fDoc = iso => { const d = Utils.parseISODate(iso); return d ? d.getDate() + '-' + MES_D[d.getMonth()] + '-' + String(d.getFullYear()).slice(2) : ''; };

  // Quien entrega = el usuario que cargó las ventas (guardado en la factura; para facturas viejas se toma del lote)
  function entregadoPor(f){
    if(f.entregadoPor) return f.entregadoPor;
    const l = Storage.getLote(f.loteId);
    return (l && l.importadoPor) || '';
  }

  // ---------- imágenes (encabezado y pie) ----------
  let _logoImg = null;
  function _cargarLogo(){
    if(_logoImg) return Promise.resolve(_logoImg);
    return new Promise(res => {
      const img = new Image();
      img.onload = () => { _logoImg = img; res(img); };
      img.onerror = () => res(null);
      img.src = 'assets/plantilla/encabezado-original.png';
    });
  }

  function _lienzo(w, h, S){
    const cv = document.createElement('canvas');
    cv.width = w * S; cv.height = h * S;
    const g = cv.getContext('2d');
    g.scale(S, S);
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#000'; g.textBaseline = 'alphabetic';
    return { cv, g };
  }
  // Texto que se achica si no cabe en maxW
  function _texto(g, txt, x, y, px, bold, maxW, align){
    let size = px;
    g.textAlign = align || 'left';
    do{ g.font = (bold ? 'bold ' : '') + size + 'px Arial'; size -= 0.5; }
    while(maxW && g.measureText(txt).width > maxW && size > 8);
    g.fillText(txt, x, y);
  }

  // Encabezado: mismo diseño que el formato aprobado, con los datos REALES de la factura
  async function headerCanvas(f){
    const W = PlantillaExcel.TOTAL_PX, H = PlantillaExcel.HEADER_PX_H;
    const { cv, g } = _lienzo(W, H, 2);
    const logo = await _cargarLogo();
    if(logo) g.drawImage(logo, 0, 12, 200, 88, 46, 12, 165, 72.6);           // recorte del logo "La Primera" de la plantilla
    _texto(g, EMPRESA.nombre, 222, 34, 18, true);
    _texto(g, EMPRESA.rnc, 222, 53, 12, true);
    _texto(g, EMPRESA.dir, 222, 70, 12, true, W - 230);
    _texto(g, 'Corte ' + fCorte(f.desde) + ' al ' + fCorte(f.hasta), 222, 95, 16, true);
    // cliente (izquierda)
    _texto(g, 'Cliente:', 40, 138, 12, false);   _texto(g, f.cliente, 92, 138, 12, true, 290);
    _texto(g, 'Teléfono:', 40, 157, 12, false);
    _texto(g, 'Dirección:', 40, 176, 12, false);
    // documento (centro-derecha)
    _texto(g, 'Id Doc:', 396, 138, 12, true);    _texto(g, f.numero, 448, 138, 12, false);
    _texto(g, 'Fecha:', 396, 157, 12, true);     _texto(g, fDoc(f.fechaEmision), 448, 157, 12, false);
    _texto(g, 'Vence:', 396, 176, 12, true);     _texto(g, fDoc(f.fechaVence), 448, 176, 12, false);
    return cv;
  }

  // Pie: firmas (con el nombre de quien entrega) y cuenta de depósito
  function pieCanvas(f){
    const { w, h } = PlantillaExcel.PIE;
    const { cv, g } = _lienzo(w, h, 2);
    g.lineWidth = 1; g.strokeStyle = '#000';
    const linea = (x1, x2, y) => { g.beginPath(); g.moveTo(x1, y); g.lineTo(x2, y); g.stroke(); };
    linea(5, 253, 42); linea(260, 511, 42);
    _texto(g, 'RECIBIDO POR (NOMBRE)', 129, 57, 15, false, 244, 'center');
    _texto(g, 'ENTREGADO POR (NOMBRE)', 385, 57, 15, false, 247, 'center');
    const quien = entregadoPor(f);
    if(quien) _texto(g, quien, 385, 36, 15, false, 247, 'center');
    _texto(g, CUENTA_DEPOSITO, w / 2 + 4, 108, 15, false, w - 20, 'center');
    return cv;
  }

  // ---------- réplica HTML del cuadro ----------
  // b = bordes INTERNOS (t,r,b,l); la caja exterior la dibuja el contenedor
  function _td(txt, o){
    o = o || {};
    const b = o.b || '';
    const bd = ['t','r','b','l'].map(k => 'border-' + {t:'top',r:'right',b:'bottom',l:'left'}[k] + ':' + (b.indexOf(k) !== -1 ? '1px solid #000' : '0')).join(';');
    const st = bd + ';' + (o.bold ? 'font-weight:700;' : '') + (o.align ? 'text-align:' + o.align + ';' : '') + (o.color ? 'color:' + o.color + ';' : '');
    return '<td' + (o.span ? ' colspan="' + o.span + '"' : '') + ' style="' + st + '">' + (txt == null ? '' : txt) + '</td>';
  }

  function cuadroHTML(f){
    const c = f.calc, p = f.params || Calculo.PARAMS_DEFAULT;
    const R = 'right', C = 'center';
    const rows = [];
    const row = (h, cells) => rows.push('<tr style="height:' + h + 'px">' + cells.join('') + '</tr>');
    const vacia = h => row(h, [_td(''), _td(''), _td(''), _td(''), _td('')]);
    vacia(19);
    row(21, [_td(''), _td(''), _td('Monto DOP', { bold:true, align:C }), _td(''), _td('Monto DOP', { bold:true, align:C })]);
    row(21, [_td('Venta Bruta'), _td(''), _td(usd(c.ventaBruta), { align:R }), _td(''), _td('')]);
    row(21, [_td('(-) Pago de Premios'), _td(''), _td(usd(c.premios), { b:'b', align:R }), _td(''), _td('')]);
    row(21, [_td('(=) Resultado después de premios', { bold:true }), _td(''), _td(''), _td(''), _td(usd(c.resultadoPremios), { bold:true, align:R })]);
    row(21, [_td('Deducciones(Jackpot,Agentes de venta y Hipodromo)'), _td(''), _td(''), _td(''), _td(usd(c.deducciones), { b:'b', align:R, color:'#FF0000' })]);
    row(21, [_td('Resultado', { bold:true }), _td(''), _td(''), _td(''), _td(usd(c.resultado), { bold:true, align:R })]);
    vacia(19);
    row(21, [_td(''), _td(''), _td('OPERADOR', { bold:true, align:C }), _td(''), _td('GSTAR', { bold:true, align:C })]);
    row(23, [_td('Distribución de resultados', { b:'tb', bold:true, align:C }), _td(pct(p.operador, 0), { b:'tb', align:C }), _td(acct(c.distOperador), { b:'tb', align:R }), _td(pct(p.gstar, 0), { b:'tb', align:C }), _td(acct(c.distGstar), { b:'tb', align:R })]);
    vacia(19);
    row(23, [_td('Deducciones', { b:'tb', bold:true, align:C }), _td('', { b:'tb' }), _td('OPERADOR', { b:'tb', bold:true, align:C }), _td('', { b:'tb' }), _td('GSTAR', { b:'tb', bold:true, align:C })]);
    row(21, [_td('(-) Jackpot Acumulado (1% Vta Bruta)'), _td(pct(p.jackpot, 0), { align:C }), _td(''), _td(''), _td(usd(c.jackpot), { align:R })]);
    row(21, [_td('(-) Comisión Banquera (0.5% Vta Bruta)'), _td(pct(p.comision, 1), { align:C }), _td(usd(c.comision), { align:R }), _td(''), _td('')]);
    row(21, [_td('(-) Hipódromo (1% Vta Bruta)'), _td(pct(p.hipodromo, 0), { align:C }), _td('', { b:'b' }), _td('', { b:'b' }), _td(usd(c.hipodromo), { b:'b', align:R })]);
    row(23, [_td('(=) TOTAL', { b:'b', bold:true, align:C }), _td('', { b:'b' }), _td(usd(c.totalOperador), { b:'b', bold:true, align:R }), _td('', { b:'b' }), _td(usd(c.totalGstar), { b:'b', bold:true, align:R })]);
    vacia(19);
    row(23, [_td(''), _td(''), _td('OPERADOR ', { b:'tbl', bold:true, align:C }), _td('', { b:'tb' }), _td('GSTAR ', { b:'tb', bold:true, align:C })]);
    row(25, [_td('TOTAL A PAGAR', { span:2, b:'tb', bold:true, align:C }), _td(usd(c.totalPagarOperador), { b:'bl', bold:true, align:R }), _td('', { b:'b' }), _td(usd(c.totalPagarGstar), { b:'b', bold:true, align:R })]);
    const cols = PlantillaExcel.COL_PCT.map(x => '<col style="width:' + x.toFixed(2) + '%">').join('');
    return '<table class="inv-t"><colgroup>' + cols + '</colgroup><tbody>' + rows.join('') + '</tbody></table>';
  }

  async function renderFacturaHTML(f){
    const head = await headerCanvas(f);
    const pie = pieCanvas(f);
    const anulada = f.estado === 'Anulada';
    return '<div class="inv" id="invDoc">'
      + (anulada ? '<div class="inv-anulada">ANULADA</div>' : '')
      + '<div class="inv-box">'
      +   '<img class="inv-head" alt="Encabezado" src="' + head.toDataURL('image/png') + '">'
      +   cuadroHTML(f)
      + '</div>'
      + '<div class="inv-foot"><img class="inv-pie" alt="" src="' + pie.toDataURL('image/png') + '"><img class="inv-sello" alt="Sello" src="assets/plantilla/sello.png"></div>'
      + '</div>';
  }

  // ---------- Excel (sobre la plantilla original) ----------
  async function generarExcelBlob(f){
    if(!window.JSZip) throw new Error('JSZip no está disponible');
    const resp = await fetch(PLANTILLA_URL);
    if(!resp.ok) throw new Error('No se pudo leer la plantilla (' + resp.status + ')');
    const zip = await JSZip.loadAsync(await resp.arrayBuffer(), { createFolders:false });   // sin entradas de carpeta: igual de estructurado que el original

    const aBytes = async cv => { const b = await new Promise(res => cv.toBlob(res, 'image/png')); return new Uint8Array(await b.arrayBuffer()); };
    await PlantillaExcel.parchear(zip, {
      celdas: Calculo.aCeldas(f.calc),
      etiquetas: ETIQUETAS_EXCEL,
      headerPng: await aBytes(await headerCanvas(f)),
      piePng: await aBytes(pieCanvas(f))
    });
    return zip.generateAsync({ type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function _nombreArchivo(f, ext){
    const cli = String(f.cliente || f.consorcio).replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    return 'Factura_' + f.numero + '_' + cli + '.' + ext;
  }

  async function exportExcel(f){
    try{
      const blob = await generarExcelBlob(f);
      Utils.download(_nombreArchivo(f, 'xlsx'), blob);
      UI.toast('Excel exportado: ' + f.numero, 'ok');
    }catch(err){
      console.error(err);
      UI.toast('No se pudo exportar el Excel: ' + err.message, 'err');
    }
  }

  // ---------- PDF ----------
  async function exportPDF(f){
    try{
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff;width:900px;';
      host.innerHTML = await renderFacturaHTML(f);
      document.body.appendChild(host);
      await Promise.all([...host.querySelectorAll('img')].map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; })));
      const canvas = await html2canvas(host.firstElementChild, { scale:2, backgroundColor:'#ffffff' });
      host.remove();
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
      const W = 210, mx = 10;
      const w = W - mx * 2, h = canvas.height * w / canvas.width;
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', mx, 10, w, h);
      doc.save(_nombreArchivo(f, 'pdf'));
      UI.toast('PDF exportado: ' + f.numero, 'ok');
    }catch(err){
      console.error(err);
      UI.toast('No se pudo exportar el PDF: ' + err.message, 'err');
    }
  }

  return { renderFacturaHTML, cuadroHTML, headerCanvas, pieCanvas, generarExcelBlob, exportExcel, exportPDF };
})();
window.Exportador = Exportador;
