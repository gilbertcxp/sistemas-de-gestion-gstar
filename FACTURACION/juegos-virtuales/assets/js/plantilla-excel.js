/* ============================================================
   PlantillaExcel — adapta el archivo original "FORMATO DE FACTURA JV.xlsx"
   al formato de factura vigente (el de la imagen aprobada) y lo llena con
   los datos de una factura.

   Se parte SIEMPRE del archivo original y se conservan sus FÓRMULAS, estilos
   y firmas/sello. Cambios que se aplican al XML de la hoja:
     - Entradas: C13 (Venta Bruta) y C14 (Premios) + valor guardado (caché)
       de cada celda con fórmula (cualquier visor muestra los números bien;
       además se activa fullCalcOnLoad y Excel recalcula al abrir).
     - Etiquetas: "(-) Pago de Premios" (sin %), "Deducciones(Jackpot,Agentes
       de venta y Hipodromo)", "(-) Comisión Banquera (0.5% Vta Bruta)".
     - Se quita la fila "MONTO NETO A PAGAR RAPID" (filas 8-10 ocultas, C10 y
       E10 vacías) y se elimina calcChain (si no, Excel marcaría el archivo
       como dañado por la fórmula E10 que ya no existe).
     - Caja exterior que abarca el encabezado (filas 1-7 con borde) y filas
       del encabezado más altas para alojar la imagen del encabezado.
     - Anchos de columna del formato aprobado.
     - Imágenes: encabezado (membrete + cliente / Id Doc / fechas) y pie
       (firmas + cuenta de depósito) se reemplazan por PNG generados con los
       datos reales; el sello se reposiciona. Los anclajes pasan a
       oneCellAnchor para no depender del ancho de las columnas.

   Funciona en navegador y en Node (para pruebas): no usa DOM.
   ============================================================ */
(function (root) {
  'use strict';

  // Anchos de columna (en caracteres de Excel) del formato aprobado y su equivalente en píxeles
  const COLS = [ { w: 51.88671875 }, { w: 6.7 }, { w: 35.3 }, { w: 6.3 }, { w: 20.9 } ];
  COLS.forEach(c => { c.px = Math.trunc(c.w * 7 + 5); });
  const TOTAL_PX = COLS.reduce((s, c) => s + c.px, 0);          // ancho total de la tabla (px)
  const HEADER_ROW_PT = 20.4;                                    // alto de cada una de las filas 1-7
  const HEADER_PX_H = Math.round(7 * HEADER_ROW_PT * 96 / 72);   // alto de la imagen del encabezado (px)
  const EMU = 9525;                                              // EMU por píxel
  const PIE = { w: 837, h: 130 };                                // tamaño (px) de la imagen del pie (igual que la plantilla)
  const SELLO_LEFT_PX = 614;                                     // posición horizontal del sello (px desde el borde izq.)

  const NOFOLDERS = { createFolders: false };   // el .xlsx no debe llevar entradas de carpeta
  const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function setValor(sheet, ref, valor) {
    const re = new RegExp('(<c r="' + ref + '"[^>]*>(?:<f>[^<]*</f>)?)<v>[^<]*</v>');
    if (!re.test(sheet)) throw new Error('La plantilla no tiene la celda ' + ref + ' con el formato esperado');
    return sheet.replace(re, '$1<v>' + String(valor) + '</v>');
  }

  function setTexto(sheet, ref, texto) {
    const re = new RegExp('<c r="' + ref + '"([^>]*?) t="s"([^>]*)><v>\\d+</v></c>');
    if (!re.test(sheet)) throw new Error('La plantilla no tiene la etiqueta ' + ref + ' con el formato esperado');
    return sheet.replace(re, '<c r="' + ref + '"$1 t="inlineStr"$2><is><t>' + xml(texto) + '</t></is></c>');
  }

  function reemplazarFila(sheet, n, nuevo) {
    const re = new RegExp('<row r="' + n + '"[^>]*>.*?</row>');
    if (!re.test(sheet)) throw new Error('La plantilla no tiene la fila ' + n);
    return sheet.replace(re, nuevo);
  }

  function filasEncabezado(sheet) {
    const row = (n, attrs, cells) => '<row r="' + n + '" spans="1:5"' + attrs + ' x14ac:dyDescent="0.3">' + cells + '</row>';
    const alta = ' ht="' + HEADER_ROW_PT + '" customHeight="1"';
    // fila 1: borde superior de la caja; filas 2-7: bordes laterales (estilos de la propia plantilla: 5=izq+sup, 7=sup, 8=der+sup, 9=izq, 13=der, 1=sin borde)
    sheet = reemplazarFila(sheet, 1, row(1, alta, '<c r="A1" s="5"/><c r="B1" s="7"/><c r="C1" s="7"/><c r="D1" s="7"/><c r="E1" s="8"/>'));
    for (let n = 2; n <= 7; n++) {
      sheet = reemplazarFila(sheet, n, row(n, alta, '<c r="A' + n + '" s="9"/><c r="B' + n + '" s="1"/><c r="E' + n + '" s="13"/>'));
    }
    // filas 8-10 (título vacío, borde doble y "MONTO NETO A PAGAR RAPID"): ocultas y sin contenido
    const oculta = ' hidden="1"';
    sheet = reemplazarFila(sheet, 8, row(8, oculta, '<c r="A8" s="9"/><c r="B8" s="1"/><c r="C8" s="1"/><c r="D8" s="1"/><c r="E8" s="13"/>'));
    sheet = reemplazarFila(sheet, 9, row(9, oculta, '<c r="A9" s="9"/><c r="B9" s="1"/><c r="E9" s="13"/>'));
    sheet = reemplazarFila(sheet, 10, row(10, oculta, '<c r="A10" s="9"/><c r="B10" s="1"/><c r="E10" s="13"/>'));
    return sheet;
  }

  function columnasXml() {
    return '<cols>' + COLS.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + c.w + '" customWidth="1"/>').join('') + '</cols>';
  }

  function drawingXml() {
    const NS = 'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
    const pic = (id, name, rid, col, colOff, row, rowOff, cx, cy) =>
      '<xdr:oneCellAnchor><xdr:from><xdr:col>' + col + '</xdr:col><xdr:colOff>' + colOff + '</xdr:colOff><xdr:row>' + row + '</xdr:row><xdr:rowOff>' + rowOff + '</xdr:rowOff></xdr:from>'
      + '<xdr:ext cx="' + cx + '" cy="' + cy + '"/>'
      + '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + id + '" name="' + name + '"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>'
      + '<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>'
      + '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>';
    const colC = COLS[0].px + COLS[1].px;                                   // inicio de la columna C (px)
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr ' + NS + '>'
      // pie (firmas + cuenta) — rId1 = image1.png
      + pic(2, 'Pie', 'rId1', 0, 142522, 29, 125024, PIE.w * EMU, PIE.h * EMU)
      // sello — rId2 = image2.png (se queda el original)
      + pic(3, 'Sello', 'rId2', 2, (SELLO_LEFT_PX - colC) * EMU, 29, 129540, 883265, 784859)
      // encabezado — rId3 = image3.png
      + pic(4, 'Encabezado', 'rId3', 0, 0, 0, 0, TOTAL_PX * EMU, HEADER_PX_H * EMU)
      + '</xdr:wsDr>';
  }

  /**
   * @param zip  JSZip ya cargado con la plantilla original
   * @param o    { celdas:{C13:..,...}, etiquetas:{A14:..,A16:..,A24:..}, headerPng, piePng }  (PNG como Uint8Array/ArrayBuffer)
   */
  async function parchear(zip, o) {
    let sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');

    Object.keys(o.celdas).forEach(ref => { sheet = setValor(sheet, ref, o.celdas[ref]); });
    Object.keys(o.etiquetas).forEach(ref => { sheet = setTexto(sheet, ref, o.etiquetas[ref]); });
    sheet = filasEncabezado(sheet);
    sheet = sheet.replace(/<cols>.*?<\/cols>/, columnasXml());
    // ajustar a 1 página de ancho al imprimir
    if (!/<sheetPr/.test(sheet)) sheet = sheet.replace('<dimension', '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension');
    if (!/<pageSetup/.test(sheet)) sheet = sheet.replace(/(<pageMargins[^>]*\/>)/, '$1<pageSetup orientation="portrait" fitToHeight="0"/>');
    zip.file('xl/worksheets/sheet1.xml', sheet, NOFOLDERS);

    // libro: recalcular al abrir y quitar calcChain
    let wbx = await zip.file('xl/workbook.xml').async('string');
    wbx = wbx.replace(/<calcPr([^>]*?)\/>/, (m, a) => /fullCalcOnLoad/.test(a) ? m : '<calcPr' + a + ' fullCalcOnLoad="1"/>');
    zip.file('xl/workbook.xml', wbx, NOFOLDERS);
    if (zip.file('xl/calcChain.xml')) {
      zip.remove('xl/calcChain.xml');
      let rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
      rels = rels.replace(/<Relationship [^>]*calcChain[^>]*\/>/, '');
      zip.file('xl/_rels/workbook.xml.rels', rels, NOFOLDERS);
      let ct = await zip.file('[Content_Types].xml').async('string');
      ct = ct.replace(/<Override PartName="\/xl\/calcChain.xml"[^>]*\/>/, '');
      zip.file('[Content_Types].xml', ct, NOFOLDERS);
    }

    zip.file('xl/drawings/drawing1.xml', drawingXml(), NOFOLDERS);
    zip.file('xl/media/image3.png', o.headerPng, NOFOLDERS);   // encabezado
    zip.file('xl/media/image1.png', o.piePng, NOFOLDERS);      // pie (firmas + cuenta)
    return zip;
  }

  const api = {
    parchear, TOTAL_PX, HEADER_PX_H, PIE, SELLO_LEFT_PX,
    COL_PCT: COLS.map(c => (c.px * 100 / TOTAL_PX))
  };
  root.PlantillaExcel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
