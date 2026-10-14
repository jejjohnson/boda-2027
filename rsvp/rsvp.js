/* RSVP · formulario bilingüe que habla con el Apps Script (apps-script/Code.gs).
   Diseño: docs/rsvp-design.md
   · Sin RSVP_ENDPOINT en config.js la sección sigue oculta (salvo ?mock=1).
   · Cada invitación trae su código (?c=XXXXXX). Con el código se ACTUALIZA siempre la misma
     fila de la hoja: reenviar no duplica.
   · Todo texto va en ES y EN (spans data-lang); el CSS de la página muestra el idioma activo,
     así que cambiar de idioma no borra lo escrito. */
(function () {
  'use strict';

  const qs = new URLSearchParams(location.search);
  const MOCK = qs.get('mock') === '1';
  const ENDPOINT = (window.RSVP_ENDPOINT || '').trim();
  if (!ENDPOINT && !MOCK) return;

  const section = document.getElementById('rsvp');
  const app = document.getElementById('rsvp-app');
  if (!section || !app) return;

  /* ───────── utilidades ───────── */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = (es, en) => `<span data-lang="es">${es}</span><span data-lang="en">${en == null ? es : en}</span>`;
  const store = {
    get() { try { return localStorage.getItem('rsvp-code') || ''; } catch (e) { return ''; } },
    set(v) { try { localStorage.setItem('rsvp-code', v); } catch (e) { /* modo privado */ } },
  };
  const normCode = s => {
    s = String(s || '').trim();
    const m = s.match(/[?&]c=([A-Za-z0-9]+)/);   // se admite pegar el enlace entero
    return (m ? m[1] : s).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  };

  /* Etiquetas en inglés de los valores que guarda la hoja (en español). */
  const EN = {
    'Sí': 'Yes', 'No': 'No', 'Adulto': 'Adult', 'Infantil': 'Kids', 'Vegetariano': 'Vegetarian',
    'Ofrezco plazas': 'I can offer seats', 'Busco plaza': "I'm looking for a seat",
    'Trona': 'High chair', 'Cuna': 'Cot / crib', 'Menú infantil': "Kids' menu",
  };
  const lab = v => L(esc(v), esc(EN[v] || v));

  const fmtDate = (iso, lang) => new Date(iso + 'T12:00:00Z').toLocaleDateString(
    lang === 'en' ? 'en-US' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const plazoHTML = plazo => plazo
    ? L('Confirma antes del ' + fmtDate(plazo, 'es'), 'Please reply by ' + fmtDate(plazo, 'en'))
    : `<span class="tbc">${L('Fecha límite por confirmar', 'Reply-by date TBC')}</span>`;

  /* ───────── API (real o simulada) ───────── */
  const api = MOCK ? mockApi() : {
    async lookup(code) {
      const r = await fetch(`${ENDPOINT}?action=lookup&code=${encodeURIComponent(code)}`);
      return r.json();
    },
    async submit(payload) {
      // text/plain evita la petición previa CORS, que Apps Script no sabe contestar
      const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
      return r.json();
    },
  };

  /* ───────── activar la sección ───────── */
  section.hidden = false;
  const navLink = document.getElementById('nav-rsvp'); if (navLink) navLink.hidden = false;
  const soon = document.getElementById('pronto-rsvp'); if (soon) soon.hidden = true;
  const pronto = document.getElementById('pronto'); if (pronto) pronto.classList.add('alt');

  const urlCode = normCode(qs.get('c'));
  const start = urlCode || normCode(store.get());
  if (start) load(start, !!urlCode || location.hash === '#rsvp'); else renderCodeEntry();

  /* ───────── pantallas ───────── */
  function renderCodeEntry(errorHTML) {
    app.innerHTML = `
      <div class="card rsvp-code">
        <p>${L('Usa el enlace personal de tu invitación. Si no lo tienes a mano, escribe aquí el código de 6 letras que viene en ella.',
               "Please use the personal link from your invitation. Don't have it handy? Type the 6-character code printed on it.")}</p>
        <form id="rsvp-code-form" novalidate>
          <label for="rsvp-code-input">${L('Código', 'Code')}</label>
          <div class="rsvp-code-row">
            <input id="rsvp-code-input" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="K7Q2MX">
            <button class="btn" type="submit">${L('Seguir', 'Continue')}</button>
          </div>
        </form>
        ${errorHTML ? `<p class="rsvp-msg err" role="alert">${errorHTML}</p>` : ''}
      </div>`;
    document.getElementById('rsvp-code-form').addEventListener('submit', e => {
      e.preventDefault();
      const c = normCode(document.getElementById('rsvp-code-input').value);
      if (c) load(c, false);
    });
  }

  async function load(code, scroll) {
    app.innerHTML = `<p class="rsvp-msg" role="status">${L('Buscando tu invitación…', 'Finding your invitation…')}</p>`;
    let d;
    try { d = await api.lookup(code); } catch (e) { d = { ok: false, error: 'network' }; }
    if (!d.ok) {
      if (d.error === 'code_not_found') store.set('');
      renderCodeEntry(errorText(d.error));
    } else {
      store.set(code);
      if (!qs.get('lang') && typeof window.set === 'function') window.set(d.idioma);
      renderForm(code, d);
    }
    if (scroll) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function errorText(err) {
    return ({
      code_not_found: L('No encontramos ese código. Revisa la invitación o escríbenos (abajo del todo).',
                        "We couldn't find that code. Check your invitation or message us (bottom of the page)."),
      closed: L('El plazo para confirmar ya ha cerrado. Si necesitas cambiar algo, escríbenos.',
                'The RSVP deadline has passed. If you need to change something, please message us.'),
      busy: L('Hay mucho tráfico ahora mismo. Prueba de nuevo en unos minutos.', 'Lots of traffic right now. Please try again in a few minutes.'),
      invalid: L('Falta algo en el formulario. Revisa las respuestas marcadas.', 'Something is missing. Please check the highlighted answers.'),
    })[err] || L('No hemos podido conectar. Revisa tu conexión y prueba otra vez.', "We couldn't connect. Check your connection and try again.");
  }

  function radios(name, values, current, labelFn, extra) {
    return `<div class="radios${extra ? ' ' + extra : ''}">${values.map(v => `
      <label><input type="radio" name="${name}" value="${esc(v)}"${v === current ? ' checked' : ''}> ${(labelFn || lab)(v)}</label>`).join('')}</div>`;
  }

  function renderForm(code, d) {
    if (d.cerrado) {
      app.innerHTML = `<div class="card"><p class="rsvp-msg err">${errorText('closed')}</p></div>`;
      return;
    }
    const prev = d.respuesta || {};
    const prevP = id => (prev.personas || []).find(p => p.id === id) || {};
    const o = d.opciones;
    const busLabel = v => v === 'Sí' ? L('Sí, cogeré el autobús desde Requena', "Yes, I'll take the shuttle from Requena")
      : v === 'No' ? L('No, iré por mi cuenta', "No, I'll make my own way")
      : L('Sí, desde ' + esc(v), 'Yes, from ' + esc(v));
    const attendLabel = v => v === 'Sí' ? L('¡Sí, allí estaré!', "Yes, I'll be there!") : L('No podré ir', "Can't make it");

    if (!d.personas.length) {
      app.innerHTML = `<div class="card"><p class="rsvp-msg err">${L('Tu invitación aún no está lista. Escríbenos y lo arreglamos.', "Your invitation isn't set up yet. Message us and we'll sort it out.")}</p></div>`;
      return;
    }

    const people = d.personas.map(p => {
      const pp = prevP(p.id);
      const title = p.acompanante ? L('Acompañante', 'Plus-one') : esc(p.nombre);
      return `
      <fieldset class="card rsvp-person" data-id="${esc(p.id)}" data-plus="${p.acompanante ? 1 : 0}">
        <legend class="rsvp-name">${title}</legend>
        ${radios('asiste-' + esc(p.id), ['Sí', 'No'], pp.asiste, attendLabel)}
        <div class="if-yes" hidden>
          ${p.acompanante ? `
          <label>${L('Nombre de tu acompañante', "Your plus-one's name")}
            <input name="mas1" maxlength="120" autocomplete="off" value="${esc(pp.nombre_mas1)}"></label>` : ''}
          <fieldset><legend>${L('Menú', 'Menu')}</legend>
            ${radios('menu-' + esc(p.id), o.menu, pp.menu)}</fieldset>
          <label>${L('Alergias o intolerancias', 'Allergies or dietary needs')}
            <input name="alergias" maxlength="500" autocomplete="off" value="${esc(pp.alergias)}"></label>
        </div>
      </fieldset>`;
    }).join('');

    app.innerHTML = `
      <p class="rsvp-hello">${L('¡Hola, ' + esc(d.hogar) + '!', 'Hi, ' + esc(d.hogar) + '!')}</p>
      <p class="sub-h rsvp-deadline">${plazoHTML(d.plazo)}</p>
      ${d.respuesta ? `<p class="rsvp-msg ok">${L('Ya tenemos tu respuesta. Puedes cambiarla y volver a enviarla.', 'We already have your reply. You can change it and send it again.')}</p>` : ''}
      <form id="rsvp-form" novalidate>
        ${people}
        <div class="card rsvp-household if-any" hidden>
          <fieldset><legend>${L('Autobús', 'Shuttle bus')}</legend>
            ${radios('autobus', o.autobus, prev.autobus, busLabel, 'stack')}</fieldset>
          <fieldset><legend>${L('¿Coche compartido?', 'Carpooling?')}</legend>
            ${radios('coche', o.coche, prev.coche)}</fieldset>
          ${d.flags.privada && d.privada ? `
          <fieldset><legend class="rsvp-free">${L(esc(d.privada.es), esc(d.privada.en))}</legend>
            ${radios('privada', ['Sí', 'No'], prev.privada)}</fieldset>` : ''}
          ${d.flags.bebes ? `
          <fieldset><legend>${L('Para el bebé necesitaremos…', 'For the baby we will need…')}</legend>
            <div class="radios">${o.bebes.map(v => `
              <label><input type="checkbox" name="bebes" value="${esc(v)}"${(prev.bebes || []).includes(v) ? ' checked' : ''}> ${lab(v)}</label>`).join('')}</div>
          </fieldset>` : ''}
        </div>
        <label>${L('¿Algo más que quieras contarnos?', 'Anything else you want to tell us?')}
          <textarea name="mensaje" rows="3" maxlength="500">${esc(prev.mensaje)}</textarea></label>
        <input class="rsvp-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <div class="rsvp-actions">
          <button class="btn" type="submit">${L('Enviar', 'Send')}</button>
          <p class="rsvp-msg" id="rsvp-status" role="status" aria-live="polite"></p>
        </div>
      </form>`;

    const form = document.getElementById('rsvp-form');
    const sync = () => {
      let any = false;
      form.querySelectorAll('.rsvp-person').forEach(f => {
        const yes = (f.querySelector('input[type=radio]:checked') || {}).value === 'Sí';
        f.querySelector('.if-yes').hidden = !yes;
        any = any || yes;
      });
      form.querySelector('.if-any').hidden = !any;
    };
    form.addEventListener('change', e => { sync(); const f = e.target.closest('fieldset'); if (f) f.classList.remove('missing'); });
    sync();
    form.addEventListener('submit', e => { e.preventDefault(); send(code, d, form); });
  }

  async function send(code, d, form) {
    const status = document.getElementById('rsvp-status');
    const val = name => (form.querySelector(`input[name="${name}"]:checked`) || {}).value || '';
    const missing = [];
    form.querySelectorAll('.missing').forEach(x => x.classList.remove('missing'));

    const personas = [...form.querySelectorAll('.rsvp-person')].map(f => {
      const id = f.dataset.id, asiste = val('asiste-' + id);
      if (!asiste) missing.push(f);
      const p = { id, asiste };
      if (asiste === 'Sí') {
        p.menu = val('menu-' + id);
        if (!p.menu) missing.push(f.querySelector('.if-yes fieldset'));
        p.alergias = f.querySelector('input[name=alergias]').value;
        if (f.dataset.plus === '1') p.nombre_mas1 = f.querySelector('input[name=mas1]').value;
      }
      return p;
    });
    const payload = { code, idioma: document.body.classList.contains('en') ? 'en' : 'es', personas,
      mensaje: form.querySelector('[name=mensaje]').value, website: form.querySelector('[name=website]').value };
    if (personas.some(p => p.asiste === 'Sí')) {
      ['autobus', 'coche'].concat(form.querySelector('input[name=privada]') ? ['privada'] : []).forEach(n => {
        payload[n] = val(n);
        if (!payload[n]) missing.push(form.querySelector(`input[name=${n}]`).closest('fieldset'));
      });
      payload.bebes = [...form.querySelectorAll('input[name=bebes]:checked')].map(x => x.value);
    }

    const faltan = missing.filter(Boolean);
    if (faltan.length) {
      faltan.forEach(x => x.classList.add('missing'));
      status.className = 'rsvp-msg err';
      status.innerHTML = L('Falta alguna respuesta (marcada en rojo).', 'A few answers are missing (marked in red).');
      faltan[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    status.className = 'rsvp-msg';
    status.innerHTML = L('Enviando…', 'Sending…');
    let r;
    try { r = await api.submit(payload); } catch (e) { r = { ok: false, error: 'network' }; }
    btn.disabled = false;
    if (!r.ok) {
      status.className = 'rsvp-msg err';
      status.innerHTML = errorText(r.error);
      return;
    }
    renderThanks(code, d, payload);
  }

  function renderThanks(code, d, p) {
    const yes = p.personas.filter(x => x.asiste === 'Sí').length;
    app.innerHTML = `
      <div class="card rsvp-thanks">
        <p class="rsvp-hello">${yes ? L('¡Gracias! ¡Qué ganas!', 'Thank you! We can’t wait!') : L('¡Gracias por avisarnos!', 'Thanks for letting us know!')}</p>
        <p>${yes
          ? L(`Hemos apuntado a ${yes} de ${p.personas.length}.`, `We've got ${yes} of ${p.personas.length} down.`)
          : L('Te echaremos de menos.', "We'll miss you.")}</p>
        <p class="rsvp-msg">${L('Puedes cambiar tu respuesta con el mismo enlace', 'You can change your reply with the same link')}${
          d.plazo ? L(' hasta el ' + fmtDate(d.plazo, 'es'), ' until ' + fmtDate(d.plazo, 'en')) : ''}.</p>
        <button class="btn ghost" type="button" id="rsvp-edit">${L('Cambiar respuesta', 'Change my reply')}</button>
      </div>`;
    document.getElementById('rsvp-edit').addEventListener('click', () => load(code, false));
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ───────── modo de prueba: ?mock=1&c=TEST01 (no toca la hoja) ───────── */
  function mockApi() {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    let saved = null;
    return {
      async lookup(code) {
        await wait(400);
        if (code !== 'TEST01') return { ok: false, error: 'code_not_found' };
        return {
          ok: true, hogar: 'Familia Prueba', idioma: 'es',
          personas: [{ id: 'TEST01-1', nombre: 'Ana', acompanante: false },
                     { id: 'TEST01-2', nombre: 'Bruno', acompanante: false },
                     { id: 'TEST01-3', nombre: '+1', acompanante: true }],
          flags: { privada: true, bebes: true },
          privada: { es: 'Pregunta privada de prueba (el texto real vive solo en la hoja)', en: 'Private test question (the real text lives only in the Sheet)' },
          opciones: { menu: ['Adulto', 'Infantil', 'Vegetariano'], autobus: ['Sí', 'No'], coche: ['Ofrezco plazas', 'Busco plaza', 'No'], bebes: ['Trona', 'Cuna', 'Menú infantil'] },
          plazo: qs.get('plazo') || null, cerrado: qs.get('cerrado') === '1', respuesta: saved,
        };
      },
      async submit(p) {
        await wait(700);
        if (p.code !== 'TEST01') return { ok: false, error: 'code_not_found' };
        saved = { personas: p.personas.map(x => ({ id: x.id, asiste: x.asiste, menu: x.menu || '', alergias: x.alergias || '', nombre_mas1: x.nombre_mas1 || '' })),
                  autobus: p.autobus || '', coche: p.coche || '', privada: p.privada || '', bebes: p.bebes || [], mensaje: p.mensaje };
        console.info('[rsvp mock] payload', p);
        return { ok: true };
      },
    };
  }
})();
