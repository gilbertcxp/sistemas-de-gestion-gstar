/* ============================================================
   Importador — carga el catálogo de puntos desde el Excel MASTER
   (hoja "MASTER", encabezado en fila 6, datos desde fila 7; columna
   V = CONSORCIO real/Grupo — ver plan de Legalización).
   ============================================================ */
const Importador = (() => {

  // Mapeo Grupo → Consorcio/Socio confirmado con el negocio (25 grupos).
  const MAPEO_GRUPO = {
    'JUAN GUTIERREZ':       { consorcio:'JUAN',          socio:'JUAN' },
    'UD SANTIAGO':          { consorcio:'UD',            socio:'UD' },
    'LA PRIMERA SAN PEDRO': { consorcio:'UD',            socio:'LENIN' },
    'VLD':                  { consorcio:'UD',            socio:'VLADY' },
    'OVALLE':                { consorcio:'UD',            socio:'UD' },
    'UD STO DGO':            { consorcio:'UD',            socio:'UD' },
    'LINIERO':               { consorcio:'FEY',           socio:'FEY' },
    'YAMASA':                { consorcio:'UD',            socio:'ENRIQUITO' },
    'LA PRIMERA YAMASA':     { consorcio:'UD',            socio:'ENRIQUITO' },
    'JUNIOR COTUI':          { consorcio:'UD',            socio:'UD' },
    'BMS':                   { consorcio:'UD',            socio:'UD' },
    'LC':                    { consorcio:'UD',            socio:'LENIN' },
    'FAMA':                  { consorcio:'UD',            socio:'UD' },
    'LA OPCION (HIGUEY)':    { consorcio:'UD',            socio:'UD' },
    'SOLL':                  { consorcio:'SOLL',          socio:'SOLL' },
    'LLUEVE':                { consorcio:'UD',            socio:'UD' },
    'MARCOS':                { consorcio:'UD',            socio:'UD' },
    'MIDAS':                 { consorcio:'MIDAS',         socio:'PABLO' },
    'BANI':                  { consorcio:'UD',            socio:'ALEX' },
    'LOS CIBAO':             { consorcio:'UD',            socio:'ALEX' },
    'VILLA ALTAGRACIA':      { consorcio:'UD',            socio:'LENIN' },
    'JOELVIS BONAO':         { consorcio:'ELVIS',         socio:'JOELVIS' },
    'LA VEGA':               { consorcio:'VIVA',          socio:'ALEX' },
    'JUAN TERCEROS':         { consorcio:'JUAN TERCEROS', socio:'JUAN' },
    'FARAON MOCA':           { consorcio:'UD',            socio:'FARAON MOCA' }
  };

  let _previewRows = [];
  let _previewErrors = [];
  let _previewWarnings = [];

  function _cleanExcelError(v){
    const s = String(v == null ? '' : v).trim();
    return s.startsWith('#') ? null : (s || null);
  }
  function _norm(s){ return Utils.normalize(s); }

  function handleFile(input){
    const file = input.files && input.files[0];
    if(!file) return;
    if(!/\.xlsx?$/i.test(file.name)){ UI.toast('Solo se aceptan archivos .xlsx', 'err'); return; }
    UI.toast('Leyendo archivo…', 'ok');
    const reader = new FileReader();
    reader.onerror = () => UI.toast('No se pudo leer el archivo', 'err');
    reader.onload = () => {
      try{
        const wb = XLSX.read(reader.result, { type:'array', cellDates:true });
        const sheetName = wb.SheetNames.find(n => /^master$/i.test(n.trim())) || wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const aoa = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
        _parseMaster(aoa);
      }catch(err){
        console.error(err);
        UI.toast('Error al leer el archivo: ' + err.message, 'err');
      }
    };
    reader.readAsArrayBuffer(file);
    input.value = '';
  }

  // Encabezado esperado en fila 6 (índice 5), datos desde fila 7 (índice 6).
  function _parseMaster(aoa){
    let headerIdx = -1;
    for(let r = 0; r < Math.min(aoa.length, 15); r++){
      const row = (aoa[r]||[]).map(c => _norm(String(c||'')));
      if(row.indexOf('ID') !== -1 && row.some(c => c.indexOf('CONSORCIO') !== -1) && row.some(c => c.indexOf('NO TERMINALES') !== -1 || c.indexOf('NO. TERMINALES') !== -1)){
        headerIdx = r; break;
      }
    }
    if(headerIdx === -1){
      UI.toast('No se encontró el encabezado esperado (ID, CONSORCIO, NO. TERMINALES) en la hoja MASTER', 'err');
      return;
    }
    const header = aoa[headerIdx];
    // La columna V=CONSORCIO (Grupo real) es la ÚLTIMA columna con encabezado
    // "CONSORCIO" antes de "HASTA" — la primera aparición (columna G) es la
    // vieja/no confiable, se ignora.
    const consorcioIdxs = [];
    header.forEach((h,i) => { if(_norm(String(h||'')).indexOf('CONSORCIO') !== -1) consorcioIdxs.push(i); });
    const colConsorcioGrupo = consorcioIdxs.length > 1 ? consorcioIdxs[consorcioIdxs.length-1] : consorcioIdxs[0];

    const idx = {};
    header.forEach((h,i) => {
      const n = _norm(String(h||''));
      if(n === 'ID') idx.id = i;
      else if(n.indexOf('NOMBRE EMPRESA') !== -1) idx.nombreEmpresa = i;
      else if(n.indexOf('NO LOT') !== -1) idx.noLot = i;
      else if(n.indexOf('NOMBRE DEL PUNTO') !== -1) idx.nombrePuntoVenta = i;
      else if(n.indexOf('FECHA DE ADMISION') !== -1) idx.fechaAdmision = i;
      else if(n === 'TERMINAL') idx.terminal = i;
      else if(n === 'CALLE') idx.calle = i;
      else if(n === 'NO') idx.numero = i;
      else if(n.indexOf('SECTOR') !== -1) idx.sector = i;
      else if(n.indexOf('PROVINCIA') !== -1) idx.provincia = i;
      else if(n.indexOf('MUNICIPIO') !== -1) idx.municipio = i;
      else if(n.indexOf('DISTRITO MUNICIPAL') !== -1) idx.distritoMunicipal = i;
      else if(n.indexOf('SECCION') !== -1) idx.seccion = i;
      else if(n.indexOf('BARRIO') !== -1) idx.barrioParaje = i;
      else if(n.indexOf('GEOLOCALIZACION') !== -1) idx.geolocalizacion = i;
      else if(n.indexOf('CORREO') !== -1) idx.correo = i;
      else if(n.indexOf('TELEFONO') !== -1) idx.telefono = i;
      else if(n.indexOf('NO TERMINALES') !== -1 || n.indexOf('NO. TERMINALES') !== -1) idx.noTerminales = i;
      else if(n.indexOf('COMENTARIOS') !== -1) idx.comentarios = i;
    });
    idx.grupo = colConsorcioGrupo;

    const rows = [];
    const errors = [];
    const seenExternalIds = new Set();
    for(let r = headerIdx + 1; r < aoa.length; r++){
      const row = aoa[r];
      if(!row || row.every(c => c === '' || c == null)) continue;
      const externalId = parseInt(row[idx.id], 10);
      const grupoNombre = String(row[idx.grupo] || '').trim();
      if(!externalId || !grupoNombre) continue; // fila vacía/inservible, no es error bloqueante
      if(seenExternalIds.has(externalId)){
        errors.push(`ID duplicado en el archivo: ${externalId}`);
        continue;
      }
      seenExternalIds.add(externalId);
      rows.push({
        externalId,
        grupoNombre,
        nombreEmpresa: row[idx.nombreEmpresa] || null,
        noLot: row[idx.noLot] || null,
        nombrePuntoVenta: row[idx.nombrePuntoVenta] || null,
        fechaAdmision: idx.fechaAdmision != null ? Utils.excelDateToISO(row[idx.fechaAdmision]) : '',
        terminal: row[idx.terminal] || null,
        calle: row[idx.calle] || null,
        numero: row[idx.numero] != null ? String(row[idx.numero]) : null,
        sector: row[idx.sector] || null,
        provincia: row[idx.provincia] || null,
        municipio: row[idx.municipio] || null,
        distritoMunicipal: _cleanExcelError(row[idx.distritoMunicipal]),
        seccion: row[idx.seccion] || null,
        barrioParaje: row[idx.barrioParaje] || null,
        geolocalizacion: row[idx.geolocalizacion] || null,
        correo: row[idx.correo] || null,
        telefono: row[idx.telefono] || null,
        noTerminales: Number(row[idx.noTerminales]) || null,
        comentarios: row[idx.comentarios] || null
      });
    }

    // Grupos detectados en el Excel que NO están en el mapeo confirmado —
    // se bloquea la importación hasta resolverlo (evita grupos "fantasma").
    const gruposDetectados = [...new Set(rows.map(r => r.grupoNombre))];
    const gruposDesconocidos = gruposDetectados.filter(g => !MAPEO_GRUPO[g.toUpperCase()] && !MAPEO_GRUPO[g]);
    // Normaliza contra las claves de MAPEO_GRUPO (mayúsculas exactas ya usadas ahí)
    const mapeoKeys = Object.keys(MAPEO_GRUPO);
    const desconocidosReales = gruposDetectados.filter(g => mapeoKeys.indexOf(g) === -1);

    _previewRows = rows;
    _previewErrors = errors;
    _previewWarnings = desconocidosReales.length > 0
      ? [`${desconocidosReales.length} grupo(s) en el Excel no están en el mapeo confirmado: ${desconocidosReales.join(', ')}. Revisa el nombre exacto en la hoja MASTER antes de continuar.`]
      : [];

    _renderPreview(gruposDetectados);
  }

  function _renderPreview(gruposDetectados){
    const wrap = document.getElementById('impPreviewWrap');
    if(!wrap) return;
    wrap.style.display = '';

    const summary = document.getElementById('impPreviewSummary');
    const gruposFaltantes = Object.keys(MAPEO_GRUPO).filter(g => gruposDetectados.indexOf(g) === -1);
    summary.innerHTML = `
      <div class="cc-kpi-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px">
        <div class="kpi blue"><div class="lbl">Puntos detectados</div><div class="val">${_previewRows.length.toLocaleString('es-DO')}</div></div>
        <div class="kpi indigo"><div class="lbl">Grupos detectados</div><div class="val">${gruposDetectados.length}</div></div>
        <div class="kpi ${_previewWarnings.length ? 'red' : 'ok'}"><div class="lbl">Advertencias</div><div class="val">${_previewWarnings.length}</div></div>
        <div class="kpi ${_previewErrors.length ? 'red' : 'ok'}"><div class="lbl">Errores</div><div class="val">${_previewErrors.length}</div></div>
      </div>
      ${gruposFaltantes.length ? `<p style="font-size:12.5px;color:var(--ink-soft);margin-bottom:10px">Grupos del mapeo sin puntos en este archivo (se crean igual, vacíos): <b>${gruposFaltantes.join(', ')}</b></p>` : ''}
      ${_previewWarnings.map(w => `<div class="cc-alert warn" style="padding:10px 14px;border-radius:8px;background:var(--warn-soft);color:var(--warn);margin-bottom:8px;font-size:12.5px">${Utils.escapeHtml(w)}</div>`).join('')}
      ${_previewErrors.map(e => `<div class="cc-alert danger" style="padding:10px 14px;border-radius:8px;background:var(--danger-soft);color:var(--danger);margin-bottom:8px;font-size:12.5px">${Utils.escapeHtml(e)}</div>`).join('')}`;

    const tbody = document.getElementById('impPreviewBody');
    tbody.innerHTML = _previewRows.slice(0, 50).map(r => `
      <tr>
        <td>${r.externalId}</td>
        <td>${Utils.escapeHtml(r.nombrePuntoVenta||'—')}</td>
        <td>${Utils.escapeHtml(r.grupoNombre)}</td>
        <td>${Utils.escapeHtml(r.municipio||'—')}</td>
        <td class="r">${r.noTerminales||0}</td>
      </tr>`).join('');
    if(_previewRows.length > 50){
      tbody.innerHTML += `<tr><td colspan="5" class="t-empty">… y ${_previewRows.length - 50} más</td></tr>`;
    }

    const btn = document.getElementById('impBtnConfirmar');
    if(btn) btn.disabled = _previewRows.length === 0 || _previewWarnings.length > 0 || _previewErrors.length > 0;
  }

  function _ensureGrupoTree(){
    const map = {};
    Object.entries(MAPEO_GRUPO).forEach(([grupoNombre, info]) => {
      const consorcio = Storage.findOrCreateConsorcio(info.consorcio);
      const socio = Storage.findOrCreateSocio(info.socio);
      const grupo = Storage.findOrCreateGrupo(grupoNombre, consorcio.id, socio.id);
      map[grupoNombre] = grupo.id;
    });
    return map;
  }

  function confirmImport(){
    if(_previewRows.length === 0){ UI.toast('No hay datos para importar', 'err'); return; }
    UI.requirePin(() => {
      const grupoIdPorNombre = _ensureGrupoTree();
      const puntos = _previewRows.map(r => {
        const { grupoNombre, ...rest } = r;
        return { ...rest, grupoId: grupoIdPorNombre[grupoNombre] };
      }).filter(p => p.grupoId);

      Storage.upsertPuntos(puntos);
      Auditoria.registrar('importar_catalogo', 'catalogo', null, null, { count: puntos.length });

      UI.toast(`Importados ${puntos.length} puntos en ${Object.keys(MAPEO_GRUPO).length} grupos`, 'ok');
      _previewRows = []; _previewErrors = []; _previewWarnings = [];
      document.getElementById('impPreviewWrap').style.display = 'none';
      App.switchView('dashboard');
    });
  }

  return { handleFile, confirmImport, MAPEO_GRUPO };
})();
window.Importador = Importador;
