/**
 * RSVP · Boda Sara y Emmanuel · 5 junio 2027
 *
 * Backend del formulario RSVP de la web. Va pegado en el editor de Apps Script de la hoja
 * «RSVP Boda 2027» (Extensiones → Apps Script) y se publica como aplicación web.
 *
 * Este archivo es PÚBLICO (vive en el repo): no contiene secretos, nombres ni textos privados.
 * Los datos viven solo en la hoja. Diseño: docs/rsvp-design.md
 *
 * Un solo enlace para todos. El invitado escribe su nombre, se busca (sin exigir acentos,
 * mayúsculas ni ortografía perfecta) en la lista de PERSONAS, y responde por todo su hogar.
 * Siempre se ACTUALIZA la fila del hogar encontrado: reenviar no duplica.
 * Si no aparece en la lista, puede responder igualmente: va a PENDIENTES para revisarlo a mano
 * (también sin duplicar: misma persona = misma fila).
 *
 *   GET  ?action=buscar&nombre=…&apellidos=…  → candidatos [{id, etiqueta}] + opciones
 *   GET  ?action=hogar&id=PERSONA-ID          → nombres de pila del hogar + preguntas que tocan
 *   POST (text/plain, JSON) tipo:'hogar'      → actualiza el hogar
 *   POST (text/plain, JSON) tipo:'pendiente'  → actualiza/crea su fila en PENDIENTES
 */

// ───────────────────────── Configuración ─────────────────────────

const CONFIG = {
  // Opciones válidas. El servidor rechaza cualquier otro valor.
  MENU: ['Adulto', 'Infantil', 'Vegetariano'],
  // Paradas del autobús desde Requena: MISMAS etiquetas que el desplegable del workbook
  // (sin comas). Mientras esté vacío, la pregunta es solo «Sí / No».
  AUTOBUS: [],
  COCHE: ['Ofrezco plazas', 'Busco plaza', 'No'],
  BEBES: ['Trona', 'Cuna', 'Menú infantil'],
  MAX_TEXTO: 500,
  MAX_PERSONAS_PENDIENTE: 8,
  // Parecido mínimo (0–1) de nombre y de apellido para dar a alguien por encontrado.
  UMBRAL: 0.88,
  // Dos candidatos a menos de esta distancia se consideran empate → se pregunta «¿cuál eres?».
  EMPATE: 0.08,
  // Límite de búsquedas por cada 10 min (anti-abuso). Por encima, «inténtalo en unos minutos».
  MAX_BUSQUEDAS: 400,
};

const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   // claves internas de hogar
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'i', 'da', 'do', 'van', 'von', 'e']);

const H = {   // cabeceras: el script localiza las columnas por nombre, se pueden reordenar
  PERSONAS: ['HOGAR', 'NOMBRE', 'APELLIDOS', 'ALIAS', 'ACOMPAÑANTE', 'CÓDIGO', 'ID',
             'ASISTE', 'NOMBRE +1', 'MENÚ', 'ALERGIAS'],
  HOGARES: ['CÓDIGO', 'HOGAR', 'PREGUNTA PRIVADA', 'TIENE BEBÉS',
            'RESPONDIDO', 'RESPONDIÓ', 'ASISTEN', 'AUTOBÚS', 'COCHE COMPARTIDO', 'RESPUESTA PRIVADA',
            'BEBÉS', 'MENSAJE', 'ACTUALIZADO', 'N.º ENVÍOS'],
  PENDIENTES: ['CLAVE', 'NOMBRE ESCRITO', 'PERSONAS', 'ASISTEN', 'AUTOBÚS', 'COCHE COMPARTIDO',
               'MENSAJE', 'ACTUALIZADO', 'N.º ENVÍOS', 'NOTA'],
  LOG: ['FECHA', 'TIPO', 'REFERENCIA', 'IDIOMA', 'DATOS'],
  TEXTOS: ['CLAVE', 'ES', 'EN'],
};

// ───────────────────────── Entradas web ─────────────────────────

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'buscar') return json_(buscar_(p.nombre, p.apellidos));
  if (p.action === 'hogar') return json_(hogar_(p.id));
  return json_({ ok: true, servicio: 'rsvp' });
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    return json_({ ok: false, error: 'invalid' });
  }
  return json_(submit_(data));
}

// ───────────────────────── Búsqueda por nombre ─────────────────────────

/** Normaliza: sin acentos, minúsculas, solo letras y espacios. «M.ª José» → «m a jose». */
function norm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokens_(s) { return norm_(s).split(' ').filter(t => t && !PARTICULAS.has(t)); }

/** Parecido Jaro-Winkler entre 0 y 1. Tolera erratas pequeñas («Garsia» ≈ «García»). */
function jw_(a, b) {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const win = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array(la).fill(false), mb = new Array(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) {
    for (let j = Math.max(0, i - win); j < Math.min(i + win + 1, lb); j++) {
      if (mb[j] || a[i] !== b[j]) continue;
      ma[i] = mb[j] = true; m++; break;
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (m / la + m / lb + (m - t / 2) / m) / 3;
  let p = 0;
  while (p < 4 && p < la && p < lb && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

/** Mejor parecido entre alguna forma escrita y alguna forma de la lista (palabra a palabra o todo junto). */
function mejor_(escritas, lista) {
  let best = 0;
  escritas.forEach(a => lista.forEach(b => { best = Math.max(best, jw_(a, b)); }));
  return best;
}
function formas_(toks) { return toks.length > 1 ? toks.concat(toks.join('')) : toks; }

/**
 * Puntúa a una persona de la lista frente a lo escrito.
 * Nombre: vale cualquiera de sus nombres, el compuesto junto («maricarmen») o un ALIAS.
 * Apellido: basta con que UNO de los apellidos escritos se parezca a uno de los suyos
 * (casi nadie escribe el segundo apellido).
 */
function puntuar_(qNombre, qApellidos, persona) {
  const nombres = formas_(persona.nombre);
  persona.alias.forEach(a => { nombres.push(...formas_(a)); });
  const sN = mejor_(formas_(qNombre), nombres);
  if (sN < CONFIG.UMBRAL) return 0;
  const porApellido = qApellidos.map(q => mejor_([q], persona.apellidos));
  const sA = Math.max.apply(null, porApellido.concat(mejor_([qApellidos.join('')], [persona.apellidos.join('')])));
  if (sA < CONFIG.UMBRAL) return 0;
  const media = porApellido.reduce((x, y) => x + y, 0) / porApellido.length;
  return sN + sA + 0.4 * media;   // escribir los dos apellidos desempata
}

function buscar_(nombre, apellidos) {
  const base = { ok: true, opciones: opciones_(), plazo: plazo_(), cerrado: cerrado_() };
  const qN = tokens_(nombre), qA = tokens_(apellidos);
  if (!qN.length || !qA.length) return Object.assign(base, { candidatos: [] });
  if (contar_('busquedas') > CONFIG.MAX_BUSQUEDAS) return { ok: false, error: 'busy' };

  const per = table_('PERSONAS');
  const lista = per.rows
    .filter(r => r[per.col['ID']] && !yes_(r[per.col['ACOMPAÑANTE']]))
    .map(r => ({
      id: String(r[per.col['ID']]),
      code: normCode_(r[per.col['CÓDIGO']]),
      nombreTxt: String(r[per.col['NOMBRE']] || '').trim(),
      apellidosTxt: String(r[per.col['APELLIDOS']] || '').trim(),
      nombre: tokens_(r[per.col['NOMBRE']]),
      apellidos: tokens_(r[per.col['APELLIDOS']]),
      alias: String(r[per.col['ALIAS']] || '').split(/[;,]/).map(tokens_).filter(a => a.length),
    }))
    .filter(p => p.nombre.length && p.apellidos.length);

  const hits = lista.map(p => ({ p, s: puntuar_(qN, qA, p) })).filter(h => h.s > 0).sort((a, b) => b.s - a.s);
  if (!hits.length) return Object.assign(base, { candidatos: [] });

  const top = hits[0].s;
  const elegidos = hits.filter(h => h.s >= top - CONFIG.EMPATE).slice(0, 3);
  const varios = elegidos.length > 1;
  const candidatos = elegidos.map(({ p }) => {
    const etiqueta = p.nombreTxt + ' ' + (p.apellidosTxt.split(/\s+/)[0] || '');
    // Si hay empate, se añaden los nombres de pila de su hogar para que se reconozca.
    const con = varios
      ? per.rows.filter(r => normCode_(r[per.col['CÓDIGO']]) === p.code && String(r[per.col['ID']]) !== p.id && !yes_(r[per.col['ACOMPAÑANTE']]))
          .map(r => String(r[per.col['NOMBRE']] || '').trim().split(/\s+/)[0]).filter(Boolean)
      : [];
    return { id: p.id, etiqueta, con };
  });
  return Object.assign(base, { candidatos });
}

/** Datos del hogar de una persona encontrada. Nunca devuelve respuestas anteriores. */
function hogar_(personaId) {
  const per = table_('PERSONAS');
  const k = findRow_(per, 'ID', String(personaId || ''));
  if (k < 0) return { ok: false, error: 'not_found' };
  const code = normCode_(per.rows[k][per.col['CÓDIGO']]);
  const hog = table_('HOGARES');
  const i = findRow_(hog, 'CÓDIGO', code);
  if (i < 0) return { ok: false, error: 'not_found' };
  const v = name => hog.rows[i][hog.col[name]];

  const personas = per.rows
    .filter(r => normCode_(r[per.col['CÓDIGO']]) === code && r[per.col['ID']])
    .map(r => ({
      id: String(r[per.col['ID']]),
      nombre: String(r[per.col['NOMBRE']] || '').trim().split(/\s+/)[0],   // solo nombre de pila
      acompanante: yes_(r[per.col['ACOMPAÑANTE']]),
    }));
  const privada = yes_(v('PREGUNTA PRIVADA')) ? textoPrivado_() : null;
  return {
    ok: true,
    id: String(personaId),
    personas,
    flags: { privada: !!privada, bebes: yes_(v('TIENE BEBÉS')) },
    privada,
    respondido: yes_(v('RESPONDIDO')),
    opciones: opciones_(), plazo: plazo_(), cerrado: cerrado_(),
  };
}

// ───────────────────────── Guardar ─────────────────────────

function submit_(d) {
  if (!d || typeof d !== 'object') return { ok: false, error: 'invalid' };
  // Trampa para bots: campo oculto que una persona nunca rellena. Se finge éxito.
  if (d.website) return { ok: true };
  if (d.tipo !== 'hogar' && d.tipo !== 'pendiente') return { ok: false, error: 'invalid' };

  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (err) { return { ok: false, error: 'busy' }; }
  try {
    if (cerrado_()) return { ok: false, error: 'closed' };
    return d.tipo === 'hogar' ? guardarHogar_(d) : guardarPendiente_(d);
  } finally {
    lock.releaseLock();
  }
}

/** Datos comunes del hogar (bus, coche…), solo si alguien viene. */
function extras_(d, vanAlguno, flagPrivada, flagBebes) {
  const out = { autobus: '', coche: '', privada: '', bebes: '' };
  if (!vanAlguno) return out;
  if (!opciones_().autobus.includes(d.autobus)) return { error: 'autobus' };
  if (!CONFIG.COCHE.includes(d.coche)) return { error: 'coche' };
  out.autobus = d.autobus; out.coche = d.coche;
  if (flagPrivada) {
    if (!['Sí', 'No'].includes(d.privada)) return { error: 'privada' };
    out.privada = d.privada;
  }
  if (flagBebes) {
    const b = Array.isArray(d.bebes) ? d.bebes : [];
    if (!b.every(x => CONFIG.BEBES.includes(x))) return { error: 'bebes' };
    out.bebes = CONFIG.BEBES.filter(x => b.includes(x)).join(', ');
  }
  return out;
}

/** Valida una persona (asiste / menú / alergias). Devuelve null si no es válida. */
function persona_(p) {
  if (!p || !['Sí', 'No'].includes(p.asiste)) return null;
  const va = p.asiste === 'Sí';
  if (va && !CONFIG.MENU.includes(p.menu)) return null;
  return { asiste: p.asiste, menu: va ? p.menu : '', alergias: va ? texto_(p.alergias) : '' };
}

function guardarHogar_(d) {
  const per = table_('PERSONAS');
  const k = findRow_(per, 'ID', String(d.id || ''));
  if (k < 0) return { ok: false, error: 'not_found' };
  const code = normCode_(per.rows[k][per.col['CÓDIGO']]);
  const hog = table_('HOGARES');
  const i = findRow_(hog, 'CÓDIGO', code);
  if (i < 0) return { ok: false, error: 'not_found' };
  const row = hog.rows[i];

  // El envío debe traer a TODAS las personas del hogar, una vez cada una, y a nadie más.
  const mias = {};
  per.rows.forEach((r, j) => {
    if (normCode_(r[per.col['CÓDIGO']]) === code && r[per.col['ID']]) {
      mias[String(r[per.col['ID']])] = { j, acompanante: yes_(r[per.col['ACOMPAÑANTE']]) };
    }
  });
  const enviadas = Array.isArray(d.personas) ? d.personas : [];
  if (!Object.keys(mias).length || enviadas.length !== Object.keys(mias).length) return bad_('personas');
  if (new Set(enviadas.map(p => String(p && p.id))).size !== enviadas.length) return bad_('personas');

  const filas = [];
  for (const p of enviadas) {
    const m = mias[String(p.id)];
    const ok = persona_(p);
    if (!m || !ok) return bad_('personas');
    filas.push(Object.assign(ok, { j: m.j, mas1: m.acompanante && ok.asiste === 'Sí' ? texto_(p.nombre_mas1) : '' }));
  }
  const vanAlguno = filas.some(p => p.asiste === 'Sí');
  const ex = extras_(d, vanAlguno, yes_(row[hog.col['PREGUNTA PRIVADA']]) && !!textoPrivado_(), yes_(row[hog.col['TIENE BEBÉS']]));
  if (ex.error) return bad_(ex.error);
  const mensaje = texto_(d.mensaje);
  const quien = String(per.rows[k][per.col['NOMBRE']] || '') + ' ' + String(per.rows[k][per.col['APELLIDOS']] || '');

  const now = new Date();
  const n = (Number(row[hog.col['N.º ENVÍOS']]) || 0) + 1;
  setRow_(hog, i, {
    'RESPONDIDO': '✓',
    'RESPONDIÓ': quien.trim(),
    'ASISTEN': filas.filter(p => p.asiste === 'Sí').length + ' / ' + filas.length,
    'AUTOBÚS': ex.autobus, 'COCHE COMPARTIDO': ex.coche, 'RESPUESTA PRIVADA': ex.privada, 'BEBÉS': ex.bebes,
    'MENSAJE': mensaje, 'ACTUALIZADO': now, 'N.º ENVÍOS': n,
  });
  filas.forEach(p => setRow_(per, p.j, { 'ASISTE': p.asiste, 'NOMBRE +1': p.mas1, 'MENÚ': p.menu, 'ALERGIAS': p.alergias }));
  log_(now, 'hogar', code, d.idioma, {
    respondio: quien.trim(),
    personas: filas.map(p => ({ id: per.rows[p.j][per.col['ID']], asiste: p.asiste, mas1: p.mas1, menu: p.menu, alergias: p.alergias })),
    autobus: ex.autobus, coche: ex.coche, privada: ex.privada, bebes: ex.bebes, mensaje,
  });
  return { ok: true, envios: n, actualizado: now.toISOString() };
}

/** No está en la lista: una fila en PENDIENTES por persona que escribe (misma persona = misma fila). */
function guardarPendiente_(d) {
  const nombre = texto_(d.nombre).slice(0, 80), apellidos = texto_(d.apellidos).slice(0, 80);
  const clave = tokens_(nombre).concat(tokens_(apellidos)).join(' ');
  if (!tokens_(nombre).length || !tokens_(apellidos).length) return bad_('nombre');

  const enviadas = Array.isArray(d.personas) ? d.personas : [];
  if (!enviadas.length || enviadas.length > CONFIG.MAX_PERSONAS_PENDIENTE) return bad_('personas');
  const filas = [];
  for (const p of enviadas) {
    const ok = persona_(p);
    const quien = texto_(p && p.nombre).slice(0, 120);
    if (!ok || !quien) return bad_('personas');
    filas.push(Object.assign(ok, { nombre: quien }));
  }
  const vanAlguno = filas.some(p => p.asiste === 'Sí');
  const ex = extras_(d, vanAlguno, false, false);
  if (ex.error) return bad_(ex.error);
  const mensaje = texto_(d.mensaje);

  const pen = table_('PENDIENTES');
  let i = findRow_(pen, 'CLAVE', clave);
  if (i < 0) { appendObj_(pen, { 'CLAVE': clave }); i = pen.rows.length - 1; }
  const now = new Date();
  const n = (Number(pen.rows[i][pen.col['N.º ENVÍOS']]) || 0) + 1;
  setRow_(pen, i, {
    'NOMBRE ESCRITO': (nombre + ' ' + apellidos).trim(),
    'PERSONAS': filas.map(p => [p.nombre, p.asiste, p.menu, p.alergias].filter(Boolean).join(' — ')).join(' | '),
    'ASISTEN': filas.filter(p => p.asiste === 'Sí').length + ' / ' + filas.length,
    'AUTOBÚS': ex.autobus, 'COCHE COMPARTIDO': ex.coche, 'MENSAJE': mensaje,
    'ACTUALIZADO': now, 'N.º ENVÍOS': n,
  });
  log_(now, 'pendiente', clave, d.idioma, { personas: filas, autobus: ex.autobus, coche: ex.coche, mensaje });
  return { ok: true, envios: n, actualizado: now.toISOString() };
}

// ───────────────────────── Menú de la hoja ─────────────────────────

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Boda')
    .addItem('Preparar invitados', 'prepararInvitados')
    .addSeparator()
    .addItem('Preparar hoja (primera vez)', 'setup')
    .addItem('Prueba automática', 'selfTest')
    .addToUi();
}

/** Crea las pestañas que falten con sus cabeceras y un hogar de prueba (Ana y Bruno Prueba). */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(H).forEach(name => {
    if (!ss.getSheetByName(name)) {
      const sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, H[name].length).setValues([H[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  const textos = table_('TEXTOS');
  if (findRow_(textos, 'CLAVE', 'PREGUNTA_PRIVADA') < 0) {
    textos.sh.appendRow(['PREGUNTA_PRIVADA', '', '']);   // la pareja escribe aquí la pregunta (ES / EN)
  }
  const per = table_('PERSONAS');
  if (findRow_(per, 'HOGAR', 'Prueba (borrar)') < 0) {
    appendObj_(per, { 'HOGAR': 'Prueba (borrar)', 'NOMBRE': 'Ana', 'APELLIDOS': 'Prueba Test' });
    appendObj_(per, { 'HOGAR': 'Prueba (borrar)', 'NOMBRE': 'Bruno', 'APELLIDOS': 'Prueba Test' });
    appendObj_(per, { 'HOGAR': 'Prueba (borrar)', 'NOMBRE': '+1', 'ACOMPAÑANTE': '✓' });
    prepararInvitados(true);
    const hog = table_('HOGARES');
    setRow_(hog, findRow_(hog, 'HOGAR', 'Prueba (borrar)'), { 'PREGUNTA PRIVADA': '✓', 'TIENE BEBÉS': '✓' });
  }
}

/**
 * Se rellena PERSONAS (HOGAR, NOMBRE, APELLIDOS, ALIAS, ACOMPAÑANTE) y este menú hace el resto:
 *  · persona sin HOGAR → su propio hogar («Nombre Apellidos»)
 *  · cada HOGAR nuevo → una fila en HOGARES (donde se marcan PREGUNTA PRIVADA / TIENE BEBÉS)
 *  · clave interna por hogar e ID por persona (nunca cambia una ya asignada)
 * Se puede repetir cuantas veces se quiera.
 */
function prepararInvitados(silencioso) {
  const per = table_('PERSONAS');
  const hog = table_('HOGARES');
  const avisos = [];

  per.rows.forEach((r, j) => {
    const nombre = String(r[per.col['NOMBRE']] || '').trim();
    if (!nombre) return;
    const plus = yes_(r[per.col['ACOMPAÑANTE']]);
    if (!String(r[per.col['HOGAR']] || '').trim()) {
      if (plus) { avisos.push('Acompañante sin HOGAR (fila ' + (j + 2) + ')'); return; }
      setRow_(per, j, { 'HOGAR': (nombre + ' ' + String(r[per.col['APELLIDOS']] || '')).trim() });
    }
    if (!plus && !String(r[per.col['APELLIDOS']] || '').trim()) {
      avisos.push('Sin apellidos, no se le podrá encontrar: «' + nombre + '» (fila ' + (j + 2) + ')');
    }
  });

  const usados = new Set(hog.rows.map(r => normCode_(r[hog.col['CÓDIGO']])).filter(Boolean));
  const nuevo = () => { let c; do { c = ''; for (let k = 0; k < 6; k++) c += ALFABETO[Math.floor(Math.random() * ALFABETO.length)]; } while (usados.has(c)); usados.add(c); return c; };
  const porHogar = {};
  hog.rows.forEach((r, i) => {
    const h = String(r[hog.col['HOGAR']] || '').trim();
    if (!h) return;
    if (porHogar[h]) { avisos.push('Hogar repetido en HOGARES: «' + h + '»'); return; }
    let c = normCode_(r[hog.col['CÓDIGO']]);
    if (!c) { c = nuevo(); setRow_(hog, i, { 'CÓDIGO': c }); }
    porHogar[h] = c;
  });
  let nuevosHogares = 0;
  per.rows.forEach(r => {
    const h = String(r[per.col['HOGAR']] || '').trim();
    if (h && !porHogar[h]) { porHogar[h] = nuevo(); appendObj_(hog, { 'CÓDIGO': porHogar[h], 'HOGAR': h }); nuevosHogares++; }
  });

  const contador = {};
  per.rows.forEach(r => {
    const m = String(r[per.col['ID']] || '').match(/^(.+)-(\d+)$/);
    if (m) contador[m[1]] = Math.max(contador[m[1]] || 0, Number(m[2]));
  });
  per.rows.forEach((r, j) => {
    const h = String(r[per.col['HOGAR']] || '').trim();
    if (!h || !String(r[per.col['NOMBRE']] || '').trim()) return;
    const c = porHogar[h];
    const id = String(r[per.col['ID']] || '');
    const cambios = { 'CÓDIGO': c };
    if (!id || id.split('-')[0] !== c) { contador[c] = (contador[c] || 0) + 1; cambios['ID'] = c + '-' + contador[c]; }
    setRow_(per, j, cambios);
  });

  // Nombres idénticos en la lista: la web preguntará «¿cuál eres?» y enseñará con quién va cada uno.
  const vistos = {};
  per.rows.forEach(r => {
    if (yes_(r[per.col['ACOMPAÑANTE']])) return;
    const k = tokens_(r[per.col['NOMBRE']]).concat(tokens_(r[per.col['APELLIDOS']])).join(' ');
    if (k) vistos[k] = (vistos[k] || 0) + 1;
  });
  Object.keys(vistos).filter(k => vistos[k] > 1).forEach(k => avisos.push('Nombre repetido (se distinguirán por su hogar): «' + k + '»'));

  if (!silencioso) {
    SpreadsheetApp.getUi().alert(nuevosHogares + ' hogar(es) nuevo(s).' +
      (avisos.length ? '\n\nRevisar:\n· ' + avisos.join('\n· ') : '\n\nTodo en orden.'));
  }
  return { nuevosHogares, avisos };
}

/** Comprueba la búsqueda, que reenviar actualiza la misma fila y que se rechaza lo inválido. */
function selfTest() {
  setup();
  const res = [];
  const check = (nombre, cond) => res.push((cond ? '✓ ' : '✗ ') + nombre);
  const hogT = () => { const t = table_('HOGARES'); return { t, i: findRow_(t, 'HOGAR', 'Prueba (borrar)') }; };
  const celda = name => { const { t, i } = hogT(); return t.rows[i][t.col[name]]; };

  const b1 = buscar_('ana', 'prueba');
  check('encuentra «ana prueba»', b1.ok && b1.candidatos.length === 1);
  const b2 = buscar_('Anna', 'Pruebaa');
  check('tolera erratas', b2.candidatos.length === 1 && b2.candidatos[0].id === b1.candidatos[0].id);
  check('no encuentra «Zoe Zzzz»', buscar_('Zoe', 'Zzzz').candidatos.length === 0);
  check('sin apellido no busca', buscar_('Ana', '').candidatos.length === 0);

  const id = b1.candidatos[0].id;
  const h = hogar_(id);
  check('hogar con 3 personas', h.ok && h.personas.length === 3);
  check('hogar sin respuestas previas', !('respuesta' in h));
  const envio = () => ({
    tipo: 'hogar', id, idioma: 'es',
    personas: h.personas.map((p, k) => k === 0 ? { id: p.id, asiste: 'Sí', menu: 'Adulto', alergias: '=prueba' } : { id: p.id, asiste: 'No' }),
    autobus: opciones_().autobus[0], coche: 'No', privada: 'Sí', bebes: ['Trona'], mensaje: 'hola',
  });
  const n0 = Number(celda('N.º ENVÍOS')) || 0;
  check('envío válido', submit_(envio()).ok);
  check('reenvío válido', submit_(envio()).ok);
  check('una sola fila del hogar', table_('HOGARES').rows.filter(r => String(r[1]) === 'Prueba (borrar)').length === 1);
  check('contador +2', Number(celda('N.º ENVÍOS')) === n0 + 2);
  check('menú no válido', submit_((() => { const e = envio(); e.personas[0].menu = 'Pizza'; return e; })()).error === 'invalid');
  check('falta una persona', submit_((() => { const e = envio(); e.personas.pop(); return e; })()).error === 'invalid');
  check('persona inexistente', submit_(Object.assign(envio(), { id: 'NOPE-1' })).error === 'not_found');
  check('trampa de bots no escribe', submit_(Object.assign(envio(), { website: 'x' })).ok && Number(celda('N.º ENVÍOS')) === n0 + 2);

  const pend = { tipo: 'pendiente', nombre: 'Zoe', apellidos: 'Pruebaprueba', personas: [{ nombre: 'Zoe', asiste: 'No' }], mensaje: '' };
  const pc = () => table_('PENDIENTES').rows.filter(r => r[0] === 'zoe pruebaprueba').length;
  submit_(pend); submit_(Object.assign({}, pend, { nombre: 'zoé', apellidos: 'PRUEBAPRUEBA' }));
  check('pendiente: una fila aunque cambie la grafía', pc() === 1);

  const out = res.join('\n');
  Logger.log(out);
  try { SpreadsheetApp.getUi().alert(out); } catch (e) { /* ejecutado sin interfaz */ }
  return res;
}

// ───────────────────────── Utilidades ─────────────────────────

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function bad_(campo) { return { ok: false, error: 'invalid', campo }; }
function normCode_(c) { return String(c == null ? '' : c).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); }
function yes_(v) { return v === true || /^(✓|✔|x|s[ií]|y|yes|1|true)$/i.test(String(v == null ? '' : v).trim()); }

/** Texto libre: recortado, limitado y guardado siempre como texto (nunca como fórmula). */
function texto_(s) {
  let t = String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, CONFIG.MAX_TEXTO);
  if (/^[=+\-@]/.test(t)) t = "'" + t;
  return t;
}

function opciones_() {
  return { menu: CONFIG.MENU, autobus: CONFIG.AUTOBUS.length ? CONFIG.AUTOBUS.concat('No') : ['Sí', 'No'], coche: CONFIG.COCHE, bebes: CONFIG.BEBES };
}

function textoPrivado_() {
  const t = table_('TEXTOS'), i = findRow_(t, 'CLAVE', 'PREGUNTA_PRIVADA');
  if (i < 0) return null;
  const es = String(t.rows[i][t.col['ES']] || '').trim(), en = String(t.rows[i][t.col['EN']] || '').trim();
  return es ? { es, en: en || es } : null;
}

/** Plazo: propiedad del script RSVP_DEADLINE = AAAA-MM-DD (hasta las 23:59 de ese día, hora de España). */
function plazo_() {
  const d = PropertiesService.getScriptProperties().getProperty('RSVP_DEADLINE');
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}
function cerrado_() {
  const d = plazo_();
  return !!d && Date.now() > Date.parse(d + 'T23:59:59+02:00');
}

/** Contador con ventana de 10 min en la caché del script. */
function contar_(clave) {
  const c = CacheService.getScriptCache();
  const n = Number(c.get(clave) || 0) + 1;
  c.put(clave, String(n), 600);
  return n;
}

function log_(fecha, tipo, ref, idioma, datos) {
  sheet_('LOG').appendRow([fecha, tipo, ref, idioma === 'en' ? 'en' : 'es', JSON.stringify(datos)]);
  SpreadsheetApp.flush();
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Falta la pestaña ' + name + ' — ejecuta Boda → Preparar hoja');
  return sh;
}
function table_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const header = (values.shift() || []).map(h => String(h).trim());
  const col = {};
  header.forEach((h, k) => { col[h] = k; });
  H[name].forEach(h => { if (!(h in col)) throw new Error('Falta la columna «' + h + '» en ' + name); });
  return { sh, col, rows: values };
}
function findRow_(t, colName, value) {
  const k = t.col[colName];
  const isCode = colName === 'CÓDIGO';
  const want = isCode ? normCode_(value) : String(value);
  return t.rows.findIndex(r => (isCode ? normCode_(r[k]) : String(r[k])) === want);
}
/** Escribe varias celdas de una fila (i = índice en t.rows) y mantiene t.rows al día. */
function setRow_(t, i, obj) {
  Object.keys(obj).forEach(name => {
    const k = t.col[name];
    t.sh.getRange(i + 2, k + 1).setValue(obj[name]);
    t.rows[i][k] = obj[name];
  });
}
function appendObj_(t, obj) {
  const width = Math.max.apply(null, Object.values(t.col)) + 1;
  const row = new Array(width).fill('');
  Object.keys(obj).forEach(name => { row[t.col[name]] = obj[name]; });
  t.sh.appendRow(row);
  t.rows.push(row);
}
