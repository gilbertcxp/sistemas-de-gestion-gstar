/* ============================================================
   ReciboPDF — Recibo de Pago en PDF para entregar al cliente
   (comprobante de que su cobro CXC fue aplicado).

   Se arma desde un recibo guardado en el módulo Pagos (fc_pagos):
     cabecera con logo y datos de la empresa, número y fecha del recibo,
     cliente, monto en letras, detalle por factura (monto, pago aplicado y
     saldo pendiente), total cobrado, sello y firma.

   Saldo pendiente de cada línea:
     - recibos nuevos: se guarda en el propio recibo (saldo justo después de ese pago);
     - recibos anteriores: pendiente actual de la factura + lo cobrado en recibos
       POSTERIORES sobre esa misma factura (= saldo justo después de ese pago).
       Si la factura ya no existe en Data, no se inventa: se muestra "—".
   Recibos antiguos sin detalle: se imprime solo el total y la cantidad de registros.

   El PDF es vectorial (jsPDF, sin html2canvas) y no cambia ningún dato.
   ============================================================ */
(function (root) {
  'use strict';

  const INK = [19, 20, 28], RED = [237, 21, 86], GRAY = [100, 116, 139], LINE = [226, 232, 240], SOFT = [248, 250, 252], OK = [21, 135, 90];
  const M = 16;                                           // margen (mm)
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const fnum = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fecha = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : (s || '—'); };

  // ---------- monto en letras (pesos dominicanos) ----------
  const UN = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
    'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIÚN', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO',
    'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
  const DEC = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const CEN = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  function menorMil(n) {                                  // 1..999 (usa "UN": el sustantivo —pesos, mil, millones— es masculino)
    if (n === 100) return 'CIEN';
    const c = Math.floor(n / 100), r = n % 100;
    let s = CEN[c];
    if (r) {
      if (s) s += ' ';
      if (r < 30) s += UN[r];
      else { const d = Math.floor(r / 10), u = r % 10; s += DEC[d] + (u ? ' Y ' + UN[u] : ''); }
    }
    return s;
  }
  function entero(n) {                                    // 0..999,999,999,999
    if (n === 0) return 'CERO';
    const mill = Math.floor(n / 1e6), resto = n % 1e6, miles = Math.floor(resto / 1000), unid = resto % 1000;
    const p = [];
    if (mill) p.push(mill === 1 ? 'UN MILLÓN' : entero(mill) + ' MILLONES');
    if (miles) p.push(miles === 1 ? 'MIL' : menorMil(miles) + ' MIL');
    if (unid) p.push(menorMil(unid));
    return p.join(' ');
  }
  function numeroALetras(monto) {
    const cents = Math.round((Number(monto) || 0) * 100 + 1e-8);
    const pesos = Math.floor(cents / 100), cc = String(cents % 100).padStart(2, '0');
    // "un millón DE pesos": cuando la cifra termina exactamente en millones lleva "de"
    const moneda = pesos === 1 ? ' PESO DOMINICANO' : (pesos >= 1e6 && pesos % 1e6 === 0 ? ' DE PESOS DOMINICANOS' : ' PESOS DOMINICANOS');
    return entero(pesos) + moneda + ' CON ' + cc + '/100';
  }

  // Ancho/alto de un PNG a partir de su cabecera (para respetar la proporción del logo y el sello)
  function pngDims(dataUrl) {
    try {
      const b = atob(String(dataUrl).split(',')[1].slice(0, 48));
      const rd = i => ((b.charCodeAt(i) << 24) | (b.charCodeAt(i + 1) << 16) | (b.charCodeAt(i + 2) << 8) | b.charCodeAt(i + 3)) >>> 0;
      const w = rd(16), h = rd(20);
      if (w > 0 && h > 0) return { w, h };
    } catch (e) { /* proporción por defecto */ }
    return { w: 1, h: 1 };
  }

  // ---------- dibujo del PDF ----------
  // d = { empresa, cliente:{nombre,rnc,telefono}, recibo:{numero,fecha,total,registros}, lineas:[{corte,fechaFactura,monto,abono,saldo}],
  //       assets:{logo,sello}, generado }
  function crearPDF(jsPDF, d) {
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const emp = d.empresa || {}, cli = d.cliente || {}, rec = d.recibo;
    const txt = (s, x, y, o) => doc.text(String(s), x, y, o);
    const font = (style, size, color) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(color[0], color[1], color[2]); };
    let y = 14;

    // --- cabecera ---
    let lh = 15;
    if (d.assets && d.assets.logo) { const dm = pngDims(d.assets.logo); doc.addImage(d.assets.logo, 'PNG', M, y, lh * dm.w / dm.h, lh, undefined, 'FAST'); }
    font('bold', 20, INK); txt('RECIBO DE PAGO', W - M, y + 7, { align: 'right' });
    font('bold', 13, RED); txt('No. ' + rec.numero, W - M, y + 14, { align: 'right' });
    font('normal', 9.5, GRAY); txt('Fecha: ' + fecha(rec.fecha), W - M, y + 20, { align: 'right' });

    let cy = y + lh + 6;
    font('bold', 10, INK); txt(emp.nombre || '', M, cy); cy += 4.5;
    font('normal', 8.5, GRAY);
    if (emp.rnc) { txt('RNC: ' + emp.rnc, M, cy); cy += 4; }
    if (emp.direccion) doc.splitTextToSize(String(emp.direccion), 105).forEach(l => { txt(l, M, cy); cy += 4; });
    if (emp.telefono) { txt('TEL.: ' + emp.telefono, M, cy); cy += 4; }
    y = Math.max(cy, y + 26) + 2;
    doc.setDrawColor(RED[0], RED[1], RED[2]); doc.setLineWidth(0.7); doc.line(M, y, W - M, y);

    // --- cliente ---
    y += 9;
    font('bold', 7.5, GRAY); txt('RECIBIDO DE', M, y);
    y += 6;
    font('bold', 13, INK); txt(cli.nombre || '—', M, y);
    font('normal', 9, GRAY);
    const sub = [cli.rnc ? 'RNC: ' + cli.rnc : '', cli.telefono ? 'Tel.: ' + cli.telefono : ''].filter(Boolean).join('   ·   ');
    if (sub) { y += 5; txt(sub, M, y); }

    // --- constancia ---
    y += 9;
    font('normal', 10, INK);
    const frase = 'Hacemos constar que hemos recibido de ' + (cli.nombre || '—') + ' la suma de RD$ ' + fnum(rec.total) + ' (' + numeroALetras(rec.total).toLowerCase().replace(/^./, c => c.toUpperCase()) + '), la cual ha sido aplicada a '
      + (d.lineas.length ? 'las cuentas por cobrar que se detallan a continuación.' : 'cuentas por cobrar de este cliente (' + (rec.registros || 0) + ' registro(s)).');
    doc.splitTextToSize(frase, W - 2 * M).forEach(l => { txt(l, M, y); y += 5; });
    y += 3;

    // --- tabla de detalle ---
    const colW = [0.32, 0.14, 0.18, 0.18, 0.18].map(f => f * (W - 2 * M));
    const colX = [M]; colW.forEach((w, i) => colX.push(colX[i] + w));
    const heads = ['Corte / período', 'Fecha factura', 'Monto factura', 'Pago aplicado', 'Saldo pendiente'];
    const cabecera = () => {
      doc.setFillColor(INK[0], INK[1], INK[2]); doc.rect(M, y, W - 2 * M, 8, 'F');
      font('bold', 8.5, [255, 255, 255]);
      heads.forEach((h, i) => { if (i < 2) txt(h, colX[i] + 2.5, y + 5.3); else txt(h, colX[i + 1] - 2.5, y + 5.3, { align: 'right' }); });
      y += 8;
    };
    const reservado = 62;                                  // espacio que se deja libre abajo para total, sello y firma
    if (d.lineas.length) {
      cabecera();
      d.lineas.forEach((l, i) => {
        const cl = doc.splitTextToSize(String(l.corte || '—'), colW[0] - 5);
        const rh = Math.max(8, cl.length * 4.2 + 3.6);
        if (y + rh > H - reservado) { doc.addPage(); y = 18; cabecera(); }
        if (i % 2) { doc.setFillColor(SOFT[0], SOFT[1], SOFT[2]); doc.rect(M, y, W - 2 * M, rh, 'F'); }
        doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.2); doc.line(M, y + rh, W - M, y + rh);
        const ty = y + 5.3;
        font('normal', 9, INK);
        cl.forEach((t, k) => txt(t, colX[0] + 2.5, ty + k * 4.2));
        txt(fecha(l.fechaFactura), colX[1] + 2.5, ty);
        txt(l.monto == null ? '—' : fnum(l.monto), colX[3] - 2.5, ty, { align: 'right' });
        font('bold', 9, INK); txt(fnum(l.abono), colX[4] - 2.5, ty, { align: 'right' });
        if (l.saldo == null) { font('normal', 9, GRAY); txt('—', colX[5] - 2.5, ty, { align: 'right' }); }
        else { font('normal', 9, l.saldo <= 0.005 ? OK : INK); txt(fnum(l.saldo), colX[5] - 2.5, ty, { align: 'right' }); }
        y += rh;
      });
      // totales
      const tM = d.lineas.reduce((s, l) => s + (l.monto || 0), 0), tA = d.lineas.reduce((s, l) => s + l.abono, 0), conSaldo = d.lineas.filter(l => l.saldo != null);
      const tS = conSaldo.reduce((s, l) => s + l.saldo, 0);
      doc.setFillColor(SOFT[0], SOFT[1], SOFT[2]); doc.rect(M, y, W - 2 * M, 8, 'F');
      font('bold', 9, INK); txt('TOTALES', colX[0] + 2.5, y + 5.3);
      if (d.lineas.every(l => l.monto != null)) txt(fnum(tM), colX[3] - 2.5, y + 5.3, { align: 'right' });
      txt(fnum(tA), colX[4] - 2.5, y + 5.3, { align: 'right' });
      if (conSaldo.length === d.lineas.length) txt(fnum(tS), colX[5] - 2.5, y + 5.3, { align: 'right' });
      y += 8;
      d.todoSaldado = conSaldo.length === d.lineas.length && tS <= 0.005;
      d.saldoTotal = conSaldo.length === d.lineas.length ? r2(tS) : null;
    } else {
      doc.setFillColor(SOFT[0], SOFT[1], SOFT[2]); doc.rect(M, y, W - 2 * M, 10, 'F');
      font('normal', 9.5, INK); txt('Cobro aplicado a ' + (rec.registros || 0) + ' registro(s) de cuentas por cobrar de ' + (cli.nombre || '—') + '.', M + 3, y + 6.4);
      y += 10;
    }

    // --- total cobrado ---
    if (y + 50 > H - 14) { doc.addPage(); y = 18; }
    y += 8;
    const bw = 84, bh = 15, bx = W - M - bw;
    doc.setFillColor(RED[0], RED[1], RED[2]); doc.roundedRect(bx, y, bw, bh, 2, 2, 'F');
    font('bold', 7.5, [255, 255, 255]); txt('TOTAL COBRADO', bx + 4, y + 5.4);
    font('bold', 15, [255, 255, 255]); txt('RD$ ' + fnum(rec.total), bx + bw - 4, y + 11.6, { align: 'right' });
    if (d.todoSaldado) { font('bold', 10, OK); txt('Cuentas saldadas en su totalidad.', M, y + 9); }
    else if (d.saldoTotal != null && d.saldoTotal > 0.005) { font('normal', 9.5, GRAY); txt('Saldo pendiente de las cuentas indicadas: RD$ ' + fnum(d.saldoTotal), M, y + 9); }
    y += bh + 10;

    // --- sello y firma ---
    if (y + 36 > H - 14) { doc.addPage(); y = 18; }
    if (d.assets && d.assets.sello) { const dm = pngDims(d.assets.sello); const sw = 30; doc.addImage(d.assets.sello, 'PNG', M + 6, y, sw, sw * dm.h / dm.w, undefined, 'FAST'); }
    const lx = W - M - 72;
    doc.setDrawColor(INK[0], INK[1], INK[2]); doc.setLineWidth(0.3); doc.line(lx, y + 24, W - M, y + 24);
    font('normal', 8, GRAY); txt('FIRMA AUTORIZADA', lx + 36, y + 28.5, { align: 'center' }); txt(emp.nombre || '', lx + 36, y + 32.5, { align: 'center' });

    // --- pie en todas las páginas ---
    const n = doc.internal.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      font('normal', 7.5, GRAY);
      txt('Documento generado electrónicamente por el sistema de ' + (emp.nombre || '') + ' el ' + (d.generado || '') + ' · Recibo No. ' + rec.numero, W / 2, H - 9, { align: 'center' });
      if (n > 1) txt('Página ' + i + ' de ' + n, W - M, H - 9, { align: 'right' });
    }
    return doc;
  }

  const api = { numeroALetras, crearPDF, pngDims };
  root.ReciboPDFCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // ============================================================
  // Navegador: arma los datos desde Storage y descarga el PDF
  // ============================================================
  if (typeof document === 'undefined') return;

  function _cliente(nombre) {
    const clients = Storage.getClients();
    const key = Utils.normalize(nombre), core = Utils.coreName(nombre);
    // Solo coincidencias exactas (nombre o núcleo): en un documento para el cliente no se arriesga un RNC ajeno
    return clients.find(c => Utils.normalize(c.nombre) === key) || (core.length >= 3 && clients.find(c => Utils.coreName(c.nombre) === core)) || null;
  }

  function armar(numero) {
    const todos = Storage.getPagos();
    const p = todos.find(x => x.numero === numero);
    if (!p) return null;
    const porId = new Map(Storage.getDataRows().map(r => [r.id, r]));
    const posteriores = {};                                  // cobrado después de este recibo, por factura
    todos.forEach(q => { if (q.numero > p.numero) (q.items || []).forEach(it => { posteriores[it.rowId] = r2((posteriores[it.rowId] || 0) + (Number(it.abono) || 0)); }); });

    const lineas = (Array.isArray(p.items) ? p.items : []).map(it => {
      const f = porId.get(it.rowId);
      const monto = it.monto != null ? Number(it.monto) : (f ? Number(f.monto) || 0 : null);
      let saldo = it.saldo != null ? Number(it.saldo) : null;
      if (saldo === null && f) {
        saldo = r2(DataModule.getEffectivePendiente(f) + (posteriores[it.rowId] || 0));
        if (monto !== null) saldo = Math.min(saldo, monto);
      }
      return { corte: it.corte || (f && f.corte) || '—', fechaFactura: it.fechaFactura || (f && f.fecha) || '', monto, abono: Number(it.abono) || 0, saldo };
    });

    const c = _cliente(p.consorcio || '');
    return {
      empresa: Storage.getSettings().empresa || {},
      cliente: { nombre: p.consorcio || '—', rnc: c && c.rnc || '', telefono: c && c.telefono || '' },
      recibo: { numero: p.numero, fecha: p.fecha, total: Number(p.total) || 0, registros: p.registros || 0 },
      lineas,
      assets: { logo: typeof Assets !== 'undefined' ? Assets.LOGO : '', sello: typeof Assets !== 'undefined' ? Assets.SELLO : '' },
      generado: new Date().toLocaleString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    };
  }

  function nombreArchivo(d) {
    const limpio = String(d.cliente.nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_').slice(0, 40);
    return 'Recibo_' + d.recibo.numero + '_' + limpio + '_' + (d.recibo.fecha || Utils.todayISO()) + '.pdf';
  }

  function descargar(numero) {
    try {
      const d = armar(numero);
      if (!d) { UI.toast('No se encontró el recibo No. ' + numero, 'err'); return; }
      if (!(window.jspdf && window.jspdf.jsPDF)) { UI.toast('No se pudo cargar el generador de PDF', 'err'); return; }
      const doc = crearPDF(window.jspdf.jsPDF, d);
      Utils.download(nombreArchivo(d), doc.output('blob'));
      UI.toast('Recibo No. ' + numero + ' descargado en PDF', 'ok');
    } catch (err) {
      console.error('ReciboPDF.descargar', err);
      UI.toast('No se pudo generar el PDF: ' + (err && err.message ? err.message : 'error desconocido'), 'err');
    }
  }

  root.ReciboPDF = { descargar, armar, numeroALetras };
})(typeof window !== 'undefined' ? window : globalThis);
