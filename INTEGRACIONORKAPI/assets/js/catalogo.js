/* ============================================================
   CatalogoORK — catálogo de consorcios (dominio, sin pantalla)

   Identificadores: ID interno estable (entero) + código externo de ORKAPI. Los nombres pueden repetirse en
   distintos sistemas, por eso los reportes se vinculan por CÓDIGO y los alias solo ayudan a sugerir.

   Campos: id, codigo, nombre, alias[], tipo ('UD' | 'NO_UD' | '' = sin clasificar), tipoValidado, estado, origen, creadoEn, creadoPor.
   Un tipo vacío NO significa "no UD": es "sin clasificar" hasta que un responsable lo valide.
   ============================================================ */
(function (root) {
  'use strict';
  const P = root.ParserORK || (typeof require !== 'undefined' ? require('./parser.js') : null);
  const norm = P.norm;

  // entradas: [{ id?, codigo?, nombre, tipo? }] (del Excel de integración y/o de un reporte de ORKAPI)
  function fusionar(actual, entradas, opc) {
    const o = opc || {}, cat = actual.map(c => ({ ...c, alias: (c.alias || []).slice() }));
    const res = { catalogo: cat, agregados: [], actualizados: [], conflictos: [], sinCambio: 0 };
    let sig = cat.reduce((m, c) => Math.max(m, c.id), 0) + 1;
    const ahora = new Date().toISOString();
    entradas.forEach(e => {
      const nombre = String(e.nombre || '').trim(); if (!nombre) return;
      const codigo = e.codigo !== undefined && e.codigo !== '' ? P.claveCodigo(e.codigo) : '';
      let c = cat.find(x => codigo && x.codigo !== '' && P.claveCodigo(x.codigo) === codigo)
        || cat.find(x => norm(x.nombre) === norm(nombre) || (x.alias || []).some(a => norm(a) === norm(nombre)));
      if (!c) {
        const id = (e.id !== undefined && !cat.some(x => x.id === e.id)) ? e.id : sig;
        sig = Math.max(sig, id + 1);
        c = { id, codigo, nombre, alias: [], tipo: e.tipo || '', tipoValidado: false, estado: 'activo', origen: o.origen || 'importado', creadoEn: ahora, creadoPor: o.usuario || '' };
        cat.push(c); res.agregados.push(c); return;
      }
      const cambios = [];
      if (codigo) {
        if (c.codigo === '' || c.codigo === undefined) { c.codigo = codigo; cambios.push('código'); }
        else if (P.claveCodigo(c.codigo) !== codigo) res.conflictos.push({ id: c.id, nombre: c.nombre, motivo: 'El código en el catálogo (' + c.codigo + ') es distinto al del archivo (' + codigo + '): no se cambió.' });
      }
      if (e.tipo && !c.tipo) { c.tipo = e.tipo; cambios.push('tipo'); }
      else if (e.tipo && c.tipo && c.tipo !== e.tipo) res.conflictos.push({ id: c.id, nombre: c.nombre, motivo: 'El tipo en el catálogo (' + c.tipo + ') es distinto al del archivo (' + e.tipo + '): no se cambió.' });
      if (norm(c.nombre) !== norm(nombre) && !(c.alias || []).some(a => norm(a) === norm(nombre))) { c.alias.push(nombre); cambios.push('alias'); }
      if (cambios.length) res.actualizados.push({ id: c.id, nombre: c.nombre, cambios }); else res.sinCambio++;
    });
    cat.sort((a, b) => a.id - b.id);
    return res;
  }

  // Avisos de calidad del catálogo (no bloquean; piden validación del responsable)
  function avisos(cat) {
    const out = [], act = cat.filter(c => c.estado !== 'inactivo');
    const sinTipo = act.filter(c => !c.tipo); if (sinTipo.length) out.push(sinTipo.length + ' consorcio(s) sin tipo (UD / no UD): cuentan como no UD en los subtotales hasta que se clasifiquen.');
    const udSinTipo = sinTipo.filter(c => /^UD\b/i.test(c.nombre)); if (udSinTipo.length) out.push('Llevan "UD" en el nombre pero no tienen tipo: ' + udSinTipo.map(c => c.nombre).join(', ') + '.');
    const noUdNombre = act.filter(c => c.tipo === 'UD' && !/^UD\b/i.test(c.nombre) && !c.tipoValidado); if (noUdNombre.length) out.push('Marcados UD sin llevar "UD" en el nombre (validar): ' + noUdNombre.map(c => c.nombre).join(', ') + '.');
    const sinCodigo = act.filter(c => !c.codigo); if (sinCodigo.length) out.push(sinCodigo.length + ' consorcio(s) sin código de ORKAPI: no se vincularán solos al cargar un reporte.');
    const cods = {}; act.forEach(c => { if (c.codigo) (cods[P.claveCodigo(c.codigo)] = cods[P.claveCodigo(c.codigo)] || []).push(c.nombre); });
    Object.keys(cods).forEach(k => { if (cods[k].length > 1) out.push('El código ' + k + ' está repetido: ' + cods[k].join(', ') + '.'); });
    return out;
  }

  const api = { fusionar, avisos };
  root.CatalogoORK = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
