/**
 * RSVP · Boda Sara y Emmanuel · 5 junio 2027
 *
 * Backend del formulario RSVP de la web. Va pegado en el editor de Apps Script de la hoja
 * «RSVP Boda 2027» (Extensiones → Apps Script) y se publica como aplicación web.
 *
 * Este archivo es PÚBLICO (vive en el repo): no contiene secretos, nombres ni códigos.
 * Los datos y los textos privados viven solo en la hoja. Diseño: docs/rsvp-design.md
 *
 *   GET  ?action=lookup&code=XXXXXX  → datos del hogar (nombres de pila, opciones, respuesta previa)
 *   POST (text/plain, cuerpo JSON)   → guarda la respuesta: ACTUALIZA la fila del código, nunca añade
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
  // Si hay demasiados códigos fallidos en 10 min, se pausa la búsqueda (anti-adivinanzas).
  MAX_FALLOS: 60,
  // Web pública: se usa para construir los enlaces personales. Cambiar si hay dominio propio.
  SITE_URL: 'https://jejjohnson.github.io/boda-2027/',
};

const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   // sin 0/O ni 1/I/L
const LARGO_CODIGO = 6;

const H = {   // cabeceras: el script localiza las columnas por nombre, se pueden reordenar
  HOGARES: ['CÓDIGO', 'HOGAR', 'IDIOMA', 'PREGUNTA PRIVADA', 'TIENE BEBÉS', 'ENLACE',
            'RESPONDIDO', 'ASISTEN', 'AUTOBÚS', 'COCHE COMPARTIDO', 'RESPUESTA PRIVADA',
            'BEBÉS', 'MENSAJE', 'ACTUALIZADO', 'N.º ENVÍOS'],
  PERSONAS: ['HOGAR', 'NOMBRE', 'ACOMPAÑANTE', 'CÓDIGO', 'ID',
             'ASISTE', 'NOMBRE +1', 'MENÚ', 'ALERGIAS'],
  LOG: ['FECHA', 'CÓDIGO', 'IDIOMA', 'DATOS'],
  TEXTOS: ['CLAVE', 'ES', 'EN'],
};

// ───────────────────────── Entradas web ─────────────────────────

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'lookup') return json_(lookup_(p.code));
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

// ───────────────────────── Lógica ─────────────────────────

function lookup_(rawCode) {
  const code = normCode_(rawCode);
  if (!code) return { ok: false, error: 'code_not_found' };
  if (demasiadosFallos_()) return { ok: false, error: 'busy' };

  const hog = table_('HOGARES');
  const i = findRow_(hog, 'CÓDIGO', code);
  if (i < 0) { anotarFallo_(); return { ok: false, error: 'code_not_found' }; }

  const row = hog.rows[i];
  const v = name => row[hog.col[name]];
  const per = table_('PERSONAS');
  const personas = per.rows
    .filter(r => normCode_(r[per.col['CÓDIGO']]) === code && r[per.col['ID']])
    .map(r => ({
      id: String(r[per.col['ID']]),
      nombre: String(r[per.col['NOMBRE']] || '').trim().split(/\s+/)[0],   // solo nombre de pila
      acompanante: yes_(r[per.col['ACOMPAÑANTE']]),
      _r: r,
    }));

  const privada = yes_(v('PREGUNTA PRIVADA')) ? textoPrivado_() : null;
  const flags = { privada: !!privada, bebes: yes_(v('TIENE BEBÉS')) };

  let respuesta = null;
  if (yes_(v('RESPONDIDO'))) {
    respuesta = {
      personas: personas.map(p => ({
        id: p.id,
        asiste: String(p._r[per.col['ASISTE']] || ''),
        nombre_mas1: String(p._r[per.col['NOMBRE +1']] || ''),
        menu: String(p._r[per.col['MENÚ']] || ''),
        alergias: String(p._r[per.col['ALERGIAS']] || ''),
      })),
      autobus: String(v('AUTOBÚS') || ''),
      coche: String(v('COCHE COMPARTIDO') || ''),
      privada: flags.privada ? String(v('RESPUESTA PRIVADA') || '') : '',
      bebes: flags.bebes ? String(v('BEBÉS') || '').split(', ').filter(Boolean) : [],
      mensaje: String(v('MENSAJE') || ''),
    };
  }

  return {
    ok: true,
    hogar: String(v('HOGAR') || ''),
    idioma: String(v('IDIOMA') || '').toLowerCase() === 'en' ? 'en' : 'es',
    personas: personas.map(({ _r, ...p }) => p),
    flags,
    privada,   // { es, en } solo para hogares marcados; null para el resto
    opciones: { menu: CONFIG.MENU, autobus: opcionesAutobus_(), coche: CONFIG.COCHE, bebes: CONFIG.BEBES },
    plazo: plazo_(),
    cerrado: cerrado_(),
    respuesta,
  };
}

function submit_(d) {
  if (!d || typeof d !== 'object') return { ok: false, error: 'invalid' };
  // Trampa para bots: campo oculto que una persona nunca rellena. Se finge éxito.
  if (d.website) return { ok: true };

  const code = normCode_(d.code);
  if (!code) return { ok: false, error: 'code_not_found' };
  if (demasiadosFallos_()) return { ok: false, error: 'busy' };

  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (err) { return { ok: false, error: 'busy' }; }
  try {
    const hog = table_('HOGARES');
    const i = findRow_(hog, 'CÓDIGO', code);
    if (i < 0) { anotarFallo_(); return { ok: false, error: 'code_not_found' }; }
    if (cerrado_()) return { ok: false, error: 'closed' };

    const row = hog.rows[i];
    const flagPrivada = yes_(row[hog.col['PREGUNTA PRIVADA']]) && !!textoPrivado_();
    const flagBebes = yes_(row[hog.col['TIENE BEBÉS']]);

    // ── Validación: el servidor no se fía de la página ──
    const per = table_('PERSONAS');
    const mias = {};
    per.rows.forEach((r, j) => {
      if (normCode_(r[per.col['CÓDIGO']]) === code && r[per.col['ID']]) {
        mias[String(r[per.col['ID']])] = { j, acompanante: yes_(r[per.col['ACOMPAÑANTE']]) };
      }
    });
    const enviadas = Array.isArray(d.personas) ? d.personas : [];
    if (!Object.keys(mias).length) return bad_('personas');
    if (enviadas.length !== Object.keys(mias).length) return bad_('personas');

    const filasPersona = [];
    for (const p of enviadas) {
      const m = p && mias[String(p.id)];
      if (!m) return bad_('personas');
      if (!['Sí', 'No'].includes(p.asiste)) return bad_('asiste');
      const va = p.asiste === 'Sí';
      if (va && !CONFIG.MENU.includes(p.menu)) return bad_('menu');
      const mas1 = m.acompanante && va ? texto_(p.nombre_mas1) : '';
      filasPersona.push({ j: m.j, asiste: p.asiste, mas1, menu: va ? p.menu : '', alergias: va ? texto_(p.alergias) : '' });
    }
    if (new Set(enviadas.map(p => String(p.id))).size !== enviadas.length) return bad_('personas');

    const vanAlguno = filasPersona.some(p => p.asiste === 'Sí');
    let autobus = '', coche = '', privada = '', bebes = '';
    if (vanAlguno) {
      if (!opcionesAutobus_().includes(d.autobus)) return bad_('autobus');
      if (!CONFIG.COCHE.includes(d.coche)) return bad_('coche');
      autobus = d.autobus; coche = d.coche;
      if (flagPrivada) {
        if (!['Sí', 'No'].includes(d.privada)) return bad_('privada');
        privada = d.privada;
      }
      if (flagBebes) {
        const b = Array.isArray(d.bebes) ? d.bebes : [];
        if (!b.every(x => CONFIG.BEBES.includes(x))) return bad_('bebes');
        bebes = CONFIG.BEBES.filter(x => b.includes(x)).join(', ');
      }
    }
    const mensaje = texto_(d.mensaje);

    // ── Escritura: SIEMPRE sobre la fila del código (upsert) ──
    const now = new Date();
    const n = (Number(row[hog.col['N.º ENVÍOS']]) || 0) + 1;
    const total = filasPersona.length, si = filasPersona.filter(p => p.asiste === 'Sí').length;
    setRow_(hog, i, {
      'RESPONDIDO': '✓',
      'ASISTEN': si + ' / ' + total,
      'AUTOBÚS': autobus,
      'COCHE COMPARTIDO': coche,
      'RESPUESTA PRIVADA': privada,
      'BEBÉS': bebes,
      'MENSAJE': mensaje,
      'ACTUALIZADO': now,
      'N.º ENVÍOS': n,
    });
    filasPersona.forEach(p => setRow_(per, p.j, {
      'ASISTE': p.asiste, 'NOMBRE +1': p.mas1, 'MENÚ': p.menu, 'ALERGIAS': p.alergias,
    }));

    const idioma = d.idioma === 'en' ? 'en' : 'es';
    sheet_('LOG').appendRow([now, code, idioma, JSON.stringify({
      personas: filasPersona.map(p => ({ id: per.rows[p.j][per.col['ID']], asiste: p.asiste, mas1: p.mas1, menu: p.menu, alergias: p.alergias })),
      autobus, coche, privada, bebes, mensaje,
    })]);
    SpreadsheetApp.flush();
    return { ok: true, envios: n, actualizado: now.toISOString() };
  } finally {
    lock.releaseLock();
  }
}

// ───────────────────────── Menú de la hoja ─────────────────────────

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Boda')
    .addItem('Generar códigos y enlaces', 'generarCodigos')
    .addSeparator()
    .addItem('Preparar hoja (primera vez)', 'setup')
    .addItem('Prueba automática', 'selfTest')
    .addToUi();
}

/** Crea las pestañas que falten con sus cabeceras y un hogar de prueba (TEST01). No borra nada. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(H).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, H[name].length).setValues([H[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  const textos = table_('TEXTOS');
  if (findRow_(textos, 'CLAVE', 'PREGUNTA_PRIVADA') < 0) {
    textos.sh.appendRow(['PREGUNTA_PRIVADA', '', '']);   // la pareja escribe aquí la pregunta (ES / EN)
  }
  const hog = table_('HOGARES');
  if (findRow_(hog, 'CÓDIGO', 'TEST01') < 0) {
    appendObj_(hog, { 'CÓDIGO': 'TEST01', 'HOGAR': 'Prueba (borrar)', 'IDIOMA': 'es', 'PREGUNTA PRIVADA': '✓', 'TIENE BEBÉS': '✓' });
    const per = table_('PERSONAS');
    appendObj_(per, { 'HOGAR': 'Prueba (borrar)', 'NOMBRE': 'Ana Prueba', 'CÓDIGO': 'TEST01', 'ID': 'TEST01-1' });
    appendObj_(per, { 'HOGAR': 'Prueba (borrar)', 'NOMBRE': 'Bruno Prueba', 'CÓDIGO': 'TEST01', 'ID': 'TEST01-2' });
    appendObj_(per, { 'HOGAR': 'Prueba (borrar)', 'NOMBRE': '+1', 'ACOMPAÑANTE': '✓', 'CÓDIGO': 'TEST01', 'ID': 'TEST01-3' });
    generarCodigos(true);
  }
}

/**
 * Da código a cada hogar que no lo tenga, rellena ENLACE, y enlaza PERSONAS con su hogar
 * por la columna HOGAR (por eso el nombre de cada hogar tiene que ser único).
 * Nunca cambia un código ya asignado.
 */
function generarCodigos(silencioso) {
  const hog = table_('HOGARES');
  const avisos = [];
  const usados = new Set(hog.rows.map(r => normCode_(r[hog.col['CÓDIGO']])).filter(Boolean));
  const porHogar = {};
  let nuevos = 0;

  hog.rows.forEach((r, i) => {
    const nombre = String(r[hog.col['HOGAR']] || '').trim();
    if (!nombre) return;
    if (porHogar[nombre]) { avisos.push('Hogar repetido: «' + nombre + '»'); return; }
    let code = normCode_(r[hog.col['CÓDIGO']]);
    if (!code) {
      do { code = nuevoCodigo_(); } while (usados.has(code));
      usados.add(code); nuevos++;
    }
    porHogar[nombre] = code;
    const en = String(r[hog.col['IDIOMA']] || '').toLowerCase() === 'en';
    setRow_(hog, i, { 'CÓDIGO': code, 'ENLACE': CONFIG.SITE_URL + '?c=' + code + (en ? '&lang=en' : '') + '#rsvp' });
  });

  const per = table_('PERSONAS');
  const contador = {};
  per.rows.forEach(r => {   // numeración existente, para no repetir ID
    const id = String(r[per.col['ID']] || ''), m = id.match(/^(.+)-(\d+)$/);
    if (m) contador[m[1]] = Math.max(contador[m[1]] || 0, Number(m[2]));
  });
  per.rows.forEach((r, j) => {
    const nombre = String(r[per.col['HOGAR']] || '').trim();
    if (!nombre) return;
    const code = porHogar[nombre];
    if (!code) { avisos.push('Persona sin hogar en HOGARES: «' + nombre + '» (fila ' + (j + 2) + ')'); return; }
    const id = String(r[per.col['ID']] || '');
    const cambios = { 'CÓDIGO': code };
    if (!id || id.split('-')[0] !== code) {
      contador[code] = (contador[code] || 0) + 1;
      cambios['ID'] = code + '-' + contador[code];
    }
    setRow_(per, j, cambios);
  });

  if (!silencioso) {
    SpreadsheetApp.getUi().alert(
      nuevos + ' código(s) nuevo(s).' + (avisos.length ? '\n\nRevisar:\n· ' + avisos.join('\n· ') : '\n\nTodo en orden.'));
  }
  return { nuevos, avisos };
}

/** Comprueba que reenviar actualiza la misma fila y que se rechaza lo inválido. Usa TEST01. */
function selfTest() {
  setup();
  const base = () => ({
    code: 'test01', idioma: 'es',
    personas: [
      { id: 'TEST01-1', asiste: 'Sí', menu: 'Adulto', alergias: 'Ninguna' },
      { id: 'TEST01-2', asiste: 'Sí', menu: 'Vegetariano', alergias: '' },
      { id: 'TEST01-3', asiste: 'No' },
    ],
    autobus: opcionesAutobus_()[0], coche: 'No', privada: 'Sí', bebes: ['Trona'], mensaje: '=prueba',
  });
  const celda = name => { const t = table_('HOGARES'); return t.rows[findRow_(t, 'CÓDIGO', 'TEST01')][t.col[name]]; };
  const filas = () => { const t = table_('HOGARES'); return t.rows.filter(r => normCode_(r[t.col['CÓDIGO']]) === 'TEST01').length; };
  const envios = () => Number(celda('N.º ENVÍOS')) || 0;

  const res = [];
  const check = (nombre, cond) => res.push((cond ? '✓ ' : '✗ ') + nombre);
  const n0 = envios();
  check('envío válido', submit_(base()).ok);
  const b2 = base(); b2.personas[1].asiste = 'No';
  check('reenvío válido', submit_(b2).ok);
  check('una sola fila para TEST01', filas() === 1);
  check('contador +2', envios() === n0 + 2);
  check('código inexistente', submit_(Object.assign(base(), { code: 'ZZZZZZ' })).error === 'code_not_found');
  check('menú no válido', submit_((() => { const b = base(); b.personas[0].menu = 'Pizza'; return b; })()).error === 'invalid');
  check('persona ajena', submit_((() => { const b = base(); b.personas[0].id = 'OTRO-1'; return b; })()).error === 'invalid');
  check('trampa de bots no escribe', submit_(Object.assign(base(), { website: 'x' })).ok && envios() === n0 + 2);
  check('fórmula guardada como texto', celda('MENSAJE') === '=prueba');   // el ' inicial lo oculta Sheets
  const l = lookup_('test01');
  check('lookup devuelve respuesta previa', l.ok && l.respuesta && l.respuesta.personas[1].asiste === 'No');
  check('lookup solo nombres de pila', l.personas.every(p => !/\s/.test(p.nombre)));

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
function nuevoCodigo_() {
  let s = '';
  for (let k = 0; k < LARGO_CODIGO; k++) s += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  return s;
}
function yes_(v) { return v === true || /^(✓|✔|x|s[ií]|y|yes|1|true)$/i.test(String(v == null ? '' : v).trim()); }

/** Texto libre: recortado, limitado y sin fórmulas (= + - @ al inicio se escapan con '). */
function texto_(s) {
  let t = String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, CONFIG.MAX_TEXTO);
  if (/^[=+\-@]/.test(t)) t = "'" + t;
  return t;
}

function opcionesAutobus_() { return CONFIG.AUTOBUS.length ? CONFIG.AUTOBUS.concat('No') : ['Sí', 'No']; }

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

function demasiadosFallos_() {
  return Number(CacheService.getScriptCache().get('fallos') || 0) >= CONFIG.MAX_FALLOS;
}
function anotarFallo_() {
  const c = CacheService.getScriptCache();
  c.put('fallos', String(Number(c.get('fallos') || 0) + 1), 600);
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
  const want = colName === 'CÓDIGO' ? normCode_(value) : String(value);
  return t.rows.findIndex(r => (colName === 'CÓDIGO' ? normCode_(r[k]) : String(r[k])) === want);
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
