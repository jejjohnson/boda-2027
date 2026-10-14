/* RSVP · formulario bilingüe que habla con el Apps Script (apps-script/Code.gs).
   Diseño: docs/rsvp-design.md
   · Un solo enlace para todos: el invitado escribe su nombre y se le busca en la lista.
   · Responde por todo su hogar; siempre se actualiza la misma fila (reenviar no duplica).
   · Si no aparece, puede responder igualmente: va a una pestaña «PENDIENTES» para revisar.
   · Sin RSVP_ENDPOINT en config.js la sección sigue oculta (salvo ?mock=1).
   · Todo texto va en ES y EN (spans data-lang): cambiar de idioma no borra lo escrito. */
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
  const lang = () => document.body.classList.contains('en') ? 'en' : 'es';
  const $ = sel => app.querySelector(sel);

  /* Etiquetas en inglés de los valores que guarda la hoja (en español). */
  const EN = {
    'Sí': 'Yes', 'No': 'No', 'Adulto': 'Adult', 'Infantil': 'Kids', 'Vegetariano': 'Vegetarian',
    'Ofrezco plazas': 'I can offer seats', 'Busco plaza': "I'm looking for a seat",
    'Trona': 'High chair', 'Cuna': 'Cot / crib', 'Menú infantil': "Kids' menu",
  };
  const lab = v => L(esc(v), esc(EN[v] || v));
  const lista = (xs, y, and) => xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' ' + (and || y) + ' ' + xs[xs.length - 1];

  const fmtDate = (iso, l) => new Date(iso + 'T12:00:00Z').toLocaleDateString(
    l === 'en' ? 'en-US' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const plazoHTML = plazo => plazo
    ? L('Confirma antes del ' + fmtDate(plazo, 'es'), 'Please reply by ' + fmtDate(plazo, 'en'))
    : `<span class="tbc">${L('Fecha límite por confirmar', 'Reply-by date TBC')}</span>`;

  /* ───────── API (real o simulada) ───────── */
  const api = MOCK ? mockApi() : {
    async buscar(nombre, apellidos) {
      const r = await fetch(`${ENDPOINT}?action=buscar&nombre=${encodeURIComponent(nombre)}&apellidos=${encodeURIComponent(apellidos)}`);
      return r.json();
    },
    async hogar(id) {
      const r = await fetch(`${ENDPOINT}?action=hogar&id=${encodeURIComponent(id)}`);
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

  const state = { nombre: '', apellidos: '' };
  app.addEventListener('click', e => {   // «Quitar» en el formulario abierto
    const rm = e.target.closest('.rsvp-remove');
    if (rm) { rm.closest('.rsvp-person').remove(); $('#rsvp-form').dispatchEvent(new Event('change')); }
  });
  renderSearch();

  function errorText(err) {
    return ({
      closed: L('El plazo para confirmar ya ha cerrado. Si necesitas cambiar algo, escríbenos (abajo del todo).',
                'The RSVP deadline has passed. If you need to change something, please message us (bottom of the page).'),
      busy: L('Hay mucho tráfico ahora mismo. Prueba de nuevo en unos minutos.', 'Lots of traffic right now. Please try again in a few minutes.'),
      not_found: L('Algo ha cambiado en nuestra lista. Vuelve a buscar tu nombre.', 'Something changed in our list. Please search for your name again.'),
      invalid: L('Falta algo en el formulario. Revisa las respuestas marcadas.', 'Something is missing. Please check the highlighted answers.'),
    })[err] || L('No hemos podido conectar. Revisa tu conexión y prueba otra vez.', "We couldn't connect. Check your connection and try again.");
  }
  const go = () => section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const msg = (html, cls) => `<p class="rsvp-msg${cls ? ' ' + cls : ''}" role="${cls === 'err' ? 'alert' : 'status'}">${html}</p>`;

  /* ───────── 1 · buscar ───────── */
  function renderSearch(note) {
    app.innerHTML = `
      <form class="card rsvp-search" id="rsvp-search" novalidate>
        <p>${L('Escribe tu nombre y tu apellido. Respondes por todos los de tu invitación.',
               "Type your first and last name. You'll reply for everyone on your invitation.")}</p>
        <div class="rsvp-row2">
          <label>${L('Nombre', 'First name')}
            <input id="rsvp-nombre" name="nombre" autocomplete="given-name" maxlength="80" value="${esc(state.nombre)}"></label>
          <label>${L('Apellido', 'Last name')}
            <input id="rsvp-apellidos" name="apellidos" autocomplete="family-name" maxlength="80" value="${esc(state.apellidos)}"></label>
        </div>
        <button class="btn" type="submit">${L('Buscar mi invitación', 'Find my invitation')}</button>
        ${note || ''}
        <p class="rsvp-msg">${L('¿Vienes de acompañante? Busca el nombre de quien te invitó.', 'Coming as a plus-one? Search for the person who invited you.')}</p>
      </form>`;
    $('#rsvp-search').addEventListener('submit', e => {
      e.preventDefault();
      state.nombre = $('#rsvp-nombre').value.trim();
      state.apellidos = $('#rsvp-apellidos').value.trim();
      if (!state.nombre || !state.apellidos) {
        renderSearch(msg(L('Escribe nombre y apellido.', 'Please type both your first and last name.'), 'err'));
        return;
      }
      search();
    });
  }

  async function search() {
    app.innerHTML = msg(L('Buscando…', 'Searching…'));
    let d;
    try { d = await api.buscar(state.nombre, state.apellidos); } catch (e) { d = { ok: false, error: 'network' }; }
    if (!d.ok) return renderSearch(msg(errorText(d.error), 'err'));
    if (d.cerrado) { app.innerHTML = `<div class="card">${msg(errorText('closed'), 'err')}</div>`; return; }
    state.info = d;
    const c = d.candidatos;
    if (c.length === 1) return renderConfirm(c[0]);
    if (c.length > 1) return renderPick(c);
    renderNotFound();
  }

  /* ───────── 2 · ¿eres tú? ───────── */
  function renderConfirm(c) {
    app.innerHTML = `
      <div class="card rsvp-center">
        <p class="rsvp-q">${L('¿Eres', 'Are you')} <strong>${esc(c.etiqueta)}</strong>?</p>
        <div class="rsvp-btns">
          <button class="btn" type="button" id="rsvp-yes">${L('Sí, soy yo', "Yes, that's me")}</button>
          <button class="btn ghost" type="button" id="rsvp-no">${L('No, buscar otra vez', 'No, search again')}</button>
        </div>
      </div>`;
    $('#rsvp-yes').addEventListener('click', () => loadHousehold(c.id));
    $('#rsvp-no').addEventListener('click', () => renderSearch());
  }

  function renderPick(cs) {
    app.innerHTML = `
      <div class="card rsvp-center">
        <p class="rsvp-q">${L('Hay varias personas con ese nombre. ¿Cuál eres?', 'There are a few people with that name. Which one are you?')}</p>
        <div class="rsvp-pick">${cs.map((c, k) => `
          <button class="rsvp-choice" type="button" data-k="${k}"><strong>${esc(c.etiqueta)}</strong>${
            c.con.length ? `<span>${L('Con ' + esc(lista(c.con, 'y')), 'With ' + esc(lista(c.con, 'and')))}</span>` : `<span>${L('Sin acompañantes en la lista', 'No one else on the invitation')}</span>`}</button>`).join('')}
        </div>
        <button class="btn ghost" type="button" id="rsvp-none">${L('Ninguna de estas', 'None of these')}</button>
      </div>`;
    app.querySelectorAll('.rsvp-choice').forEach(b => b.addEventListener('click', () => loadHousehold(cs[+b.dataset.k].id)));
    $('#rsvp-none').addEventListener('click', () => renderSearch());
  }

  function renderNotFound() {
    app.innerHTML = `
      <div class="card rsvp-center">
        <p class="rsvp-q">${L('No te encontramos en la lista', "We couldn't find you on the list")}</p>
        <p>${L(`Hemos buscado «${esc(state.nombre)} ${esc(state.apellidos)}». Puede ser una errata, un apodo o que te tengamos con otro apellido. Prueba otra vez, o responde igualmente y lo revisamos nosotros.`,
               `We searched for "${esc(state.nombre)} ${esc(state.apellidos)}". It could be a typo, a nickname, or a different last name on our list. Try again, or reply anyway and we'll sort it out.`)}</p>
        <div class="rsvp-btns">
          <button class="btn" type="button" id="rsvp-again">${L('Probar otra vez', 'Try again')}</button>
          <button class="btn ghost" type="button" id="rsvp-anyway">${L('Responder igualmente', 'Reply anyway')}</button>
        </div>
      </div>`;
    $('#rsvp-again').addEventListener('click', () => renderSearch());
    $('#rsvp-anyway').addEventListener('click', () => renderOpen());
  }

  /* ───────── 3 · formulario ───────── */
  async function loadHousehold(id, prev) {
    app.innerHTML = msg(L('Abriendo tu invitación…', 'Opening your invitation…'));
    let d;
    try { d = await api.hogar(id); } catch (e) { d = { ok: false, error: 'network' }; }
    if (!d.ok) return renderSearch(msg(errorText(d.error), 'err'));
    if (d.cerrado) { app.innerHTML = `<div class="card">${msg(errorText('closed'), 'err')}</div>`; return; }
    renderHousehold(d, prev);
    go();
  }

  function radios(name, values, current, labelFn, extra) {
    return `<div class="radios${extra ? ' ' + extra : ''}">${values.map(v => `
      <label><input type="radio" name="${name}" value="${esc(v)}"${v === current ? ' checked' : ''}> ${(labelFn || lab)(v)}</label>`).join('')}</div>`;
  }
  const attendLabel = v => v === 'Sí' ? L('¡Sí, allí estaré!', "Yes, I'll be there!") : L('No podré ir', "Can't make it");
  const busLabel = v => v === 'Sí' ? L('Sí, cogeré el autobús desde Requena', "Yes, I'll take the shuttle from Requena")
    : v === 'No' ? L('No, iré por mi cuenta', "No, I'll make my own way")
    : L('Sí, desde ' + esc(v), 'Yes, from ' + esc(v));

  /* Tarjeta de una persona. key: identificador del campo; head: título o campo de nombre. */
  let seq = 0;
  function personCard(o, opts, p) {
    p = p || {};
    const key = 'p' + (++seq);
    return `
      <fieldset class="card rsvp-person" data-key="${key}"${o.id ? ` data-id="${esc(o.id)}"` : ''} data-plus="${o.plus ? 1 : 0}" data-free="${o.free ? 1 : 0}">
        ${o.free
          ? `<label>${L('Nombre y apellido', 'Full name')}
               <input name="nombre" maxlength="120" autocomplete="off" value="${esc(p.nombre || o.nombre || '')}"></label>`
          : `<legend class="rsvp-name">${o.plus ? L('Acompañante', 'Plus-one') : esc(o.nombre)}</legend>`}
        ${o.removable ? `<button type="button" class="rsvp-remove" aria-label="Quitar / Remove">${L('Quitar', 'Remove')}</button>` : ''}
        ${radios('asiste-' + key, ['Sí', 'No'], p.asiste, attendLabel)}
        <div class="if-yes" hidden>
          ${o.plus ? `
          <label>${L('Nombre de tu acompañante', "Your plus-one's name")}
            <input name="mas1" maxlength="120" autocomplete="off" value="${esc(p.nombre_mas1)}"></label>` : ''}
          <fieldset><legend>${L('Menú', 'Menu')}</legend>
            ${radios('menu-' + key, opts.menu, p.menu)}</fieldset>
          <label>${L('Alergias o intolerancias', 'Allergies or dietary needs')}
            <input name="alergias" maxlength="500" autocomplete="off" value="${esc(p.alergias)}"></label>
        </div>
      </fieldset>`;
  }

  function extrasHTML(opts, flags, privada, prev) {
    return `
      <div class="card rsvp-household if-any" hidden>
        <fieldset><legend>${L('Autobús', 'Shuttle bus')}</legend>
          ${radios('autobus', opts.autobus, prev.autobus, busLabel, 'stack')}</fieldset>
        <fieldset><legend>${L('¿Coche compartido?', 'Carpooling?')}</legend>
          ${radios('coche', opts.coche, prev.coche)}</fieldset>
        ${flags.privada && privada ? `
        <fieldset><legend class="rsvp-free">${L(esc(privada.es), esc(privada.en))}</legend>
          ${radios('privada', ['Sí', 'No'], prev.privada)}</fieldset>` : ''}
        ${flags.bebes ? `
        <fieldset><legend>${L('Para el bebé necesitaremos…', 'For the baby we will need…')}</legend>
          <div class="radios">${opts.bebes.map(v => `
            <label><input type="checkbox" name="bebes" value="${esc(v)}"${(prev.bebes || []).includes(v) ? ' checked' : ''}> ${lab(v)}</label>`).join('')}</div>
        </fieldset>` : ''}
      </div>
      <label>${L('¿Algo más que quieras contarnos?', 'Anything else you want to tell us?')}
        <textarea name="mensaje" rows="3" maxlength="500">${esc(prev.mensaje)}</textarea></label>
      <input class="rsvp-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <div class="rsvp-actions">
        <button class="btn" type="submit">${L('Enviar', 'Send')}</button>
        <p class="rsvp-msg" id="rsvp-status" role="status" aria-live="polite"></p>
      </div>`;
  }

  function renderHousehold(d, prev) {
    prev = prev || {};
    const prevP = id => (prev.personas || []).find(p => p.id === id);
    if (!d.personas.length) {
      app.innerHTML = `<div class="card">${msg(L('Tu invitación aún no está lista. Escríbenos y lo arreglamos.', "Your invitation isn't set up yet. Message us and we'll sort it out."), 'err')}</div>`;
      return;
    }
    const names = d.personas.filter(p => !p.acompanante).map(p => p.nombre);
    app.innerHTML = `
      <p class="rsvp-hello">${L('¡Hola, ' + esc(lista(names, 'y')) + '!', 'Hi, ' + esc(lista(names, 'and')) + '!')}</p>
      <p class="sub-h rsvp-deadline">${plazoHTML(d.plazo)}</p>
      ${d.respondido && !prev.personas ? msg(L('Ya tenemos una respuesta de vuestra invitación. Si envías otra, sustituye a la anterior.', 'We already have a reply for your invitation. Sending a new one replaces it.'), 'ok') : ''}
      <form id="rsvp-form" novalidate>
        ${d.personas.map(p => personCard({ id: p.id, nombre: p.nombre, plus: p.acompanante }, d.opciones, prevP(p.id))).join('')}
        ${extrasHTML(d.opciones, d.flags, d.privada, prev)}
      </form>`;
    wireForm(payload => Object.assign(payload, { tipo: 'hogar', id: d.id }),
             p => renderThanks(p, () => loadHousehold(d.id, p)));
  }

  function renderOpen(prev) {
    prev = prev || {};
    const info = state.info;
    const people = prev.personas || [{ nombre: (state.nombre + ' ' + state.apellidos).trim() }];
    app.innerHTML = `
      <p class="rsvp-hello">${L('¡Hola, ' + esc(state.nombre) + '!', 'Hi, ' + esc(state.nombre) + '!')}</p>
      <p class="sub-h rsvp-deadline">${plazoHTML(info.plazo)}</p>
      ${msg(L('Dinos quién viene contigo. Lo enlazaremos con nuestra lista a mano.', "Tell us who's coming with you. We'll match it to our list by hand."))}
      <form id="rsvp-form" novalidate>
        <div class="rsvp-people">${people.map((p, k) => personCard({ free: true, removable: k > 0 }, info.opciones, p)).join('')}</div>
        <button class="btn ghost rsvp-add" type="button" id="rsvp-add">${L('+ Añadir persona', '+ Add a person')}</button>
        ${extrasHTML(info.opciones, { privada: false, bebes: false }, null, prev)}
      </form>`;
    $('#rsvp-add').addEventListener('click', () => {
      const box = $('.rsvp-people');
      if (box.children.length >= 8) return;
      box.insertAdjacentHTML('beforeend', personCard({ free: true, removable: true }, info.opciones));
      box.lastElementChild.querySelector('input[name=nombre]').focus();
    });
    wireForm(payload => Object.assign(payload, { tipo: 'pendiente', nombre: state.nombre, apellidos: state.apellidos }),
             p => renderThanks(p, () => renderOpen(p)));
  }

  /* Mostrar/ocultar según quién viene, validar y enviar. */
  function wireForm(finish, onDone) {
    const form = $('#rsvp-form');
    const sync = () => {
      let any = false;
      form.querySelectorAll('.rsvp-person').forEach(f => {
        const yes = (f.querySelector(':scope > .radios input:checked') || {}).value === 'Sí';
        f.querySelector('.if-yes').hidden = !yes;
        any = any || yes;
      });
      form.querySelector('.if-any').hidden = !any;
    };
    form.addEventListener('change', e => { sync(); const f = e.target.closest && e.target.closest('fieldset'); if (f) f.classList.remove('missing'); });
    form.addEventListener('input', e => { const f = e.target.closest('.rsvp-person'); if (f) f.classList.remove('missing'); });
    sync();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const status = $('#rsvp-status');
      const val = name => (form.querySelector(`input[name="${name}"]:checked`) || {}).value || '';
      const missing = [];
      form.querySelectorAll('.missing').forEach(x => x.classList.remove('missing'));

      const personas = [...form.querySelectorAll('.rsvp-person')].map(f => {
        const key = f.dataset.key, asiste = val('asiste-' + key);
        const p = f.dataset.id ? { id: f.dataset.id, asiste } : { nombre: f.querySelector('input[name=nombre]').value.trim(), asiste };
        if (!asiste || (f.dataset.free === '1' && !p.nombre)) missing.push(f);
        if (asiste === 'Sí') {
          p.menu = val('menu-' + key);
          if (!p.menu) missing.push(f.querySelector('.if-yes fieldset'));
          p.alergias = f.querySelector('input[name=alergias]').value;
          if (f.dataset.plus === '1') p.nombre_mas1 = f.querySelector('input[name=mas1]').value;
        }
        return p;
      });
      const payload = { idioma: lang(), personas,
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
      finish(payload);
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      status.className = 'rsvp-msg';
      status.innerHTML = L('Enviando…', 'Sending…');
      let r;
      try { r = await api.submit(payload); } catch (err) { r = { ok: false, error: 'network' }; }
      btn.disabled = false;
      if (!r.ok) { status.className = 'rsvp-msg err'; status.innerHTML = errorText(r.error); return; }
      onDone(payload);
    });
  }

  /* ───────── 4 · gracias ───────── */
  function renderThanks(p, edit) {
    const yes = p.personas.filter(x => x.asiste === 'Sí').length;
    const plazo = state.info && state.info.plazo;
    app.innerHTML = `
      <div class="card rsvp-thanks">
        <p class="rsvp-hello">${yes ? L('¡Gracias! ¡Qué ganas!', 'Thank you! We can’t wait!') : L('¡Gracias por avisarnos!', 'Thanks for letting us know!')}</p>
        <p>${yes
          ? L(`Hemos apuntado a ${yes} de ${p.personas.length}.`, `We've got ${yes} of ${p.personas.length} down.`)
          : L('Te echaremos de menos.', "We'll miss you.")}</p>
        <p class="rsvp-msg">${L('Para cambiar algo, vuelve aquí y busca tu nombre otra vez', 'To change anything, come back and search for your name again')}${
          plazo ? L(' (hasta el ' + fmtDate(plazo, 'es') + ')', ' (until ' + fmtDate(plazo, 'en') + ')') : ''}.</p>
        <button class="btn ghost" type="button" id="rsvp-edit">${L('Cambiar respuesta', 'Change my reply')}</button>
      </div>`;
    $('#rsvp-edit').addEventListener('click', edit);
    go();
  }

  /* ───────── modo de prueba: ?mock=1 (no toca la hoja) ─────────
     Lista de ejemplo y la misma búsqueda aproximada que Code.gs (copia reducida). */
  function mockApi() {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const PART = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'i', 'da', 'do', 'van', 'von', 'e']);
    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const toks = s => norm(s).split(' ').filter(t => t && !PART.has(t));
    const jw = (a, b) => {
      if (a === b) return 1;
      const la = a.length, lb = b.length; if (!la || !lb) return 0;
      const w = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1), ma = [], mb = []; let m = 0;
      for (let i = 0; i < la; i++) for (let j = Math.max(0, i - w); j < Math.min(i + w + 1, lb); j++) { if (mb[j] || a[i] !== b[j]) continue; ma[i] = mb[j] = 1; m++; break; }
      if (!m) return 0;
      let t = 0, k = 0;
      for (let i = 0; i < la; i++) { if (!ma[i]) continue; while (!mb[k]) k++; if (a[i] !== b[k]) t++; k++; }
      const jr = (m / la + m / lb + (m - t / 2) / m) / 3; let p = 0;
      while (p < 4 && p < la && p < lb && a[p] === b[p]) p++;
      return jr + p * 0.1 * (1 - jr);
    };
    const best = (A, B) => Math.max(0, ...A.flatMap(a => B.map(b => jw(a, b))));
    const forms = t => t.length > 1 ? t.concat(t.join('')) : t;
    const H = {
      PRUEBA: { flags: { privada: true, bebes: true } }, GARCIA: { flags: { privada: false, bebes: true } },
      LGM: { flags: { privada: false, bebes: false } }, RUIZ: { flags: { privada: true, bebes: false } },
    };
    const P = [
      ['PRUEBA', 'Ana', 'Prueba Test'], ['PRUEBA', 'Bruno', 'Prueba Test'], ['PRUEBA', '+1', '', '', 1],
      ['GARCIA', 'Lucía', 'García López'], ['GARCIA', 'Pablo', 'García López'],
      ['LGM', 'Lucía', 'García Martín'],
      ['RUIZ', 'María del Carmen', 'Ruiz Pérez', 'Mari Carmen; Maika'], ['RUIZ', '+1', '', '', 1],
    ].map(([h, n, a, al, plus], k) => ({ h, id: h + '-' + (k + 1), n, a, plus: !!plus, nt: toks(n), at: toks(a), al: String(al || '').split(';').map(toks).filter(x => x.length) }));
    const base = () => ({ ok: true, opciones: { menu: ['Adulto', 'Infantil', 'Vegetariano'], autobus: ['Sí', 'No'], coche: ['Ofrezco plazas', 'Busco plaza', 'No'], bebes: ['Trona', 'Cuna', 'Menú infantil'] },
      plazo: qs.get('plazo') || null, cerrado: qs.get('cerrado') === '1' });
    const answered = {};
    return {
      async buscar(nombre, apellidos) {
        await wait(450);
        const qn = toks(nombre), qa = toks(apellidos);
        const hits = P.filter(p => !p.plus).map(p => {
          const sN = best(forms(qn), forms(p.nt).concat(...p.al.map(forms)));
          const per = qa.map(q => best([q], p.at));
          const sA = Math.max(...per, best([qa.join('')], [p.at.join('')]));
          if (sN < 0.88 || sA < 0.88) return null;
          return { p, s: sN + sA + 0.4 * per.reduce((x, y) => x + y, 0) / per.length };
        }).filter(Boolean).sort((x, y) => y.s - x.s);
        const top = hits.length ? hits[0].s : 0;
        const el = hits.filter(h => h.s >= top - 0.08).slice(0, 3);
        return Object.assign(base(), { candidatos: el.map(({ p }) => ({
          id: p.id, etiqueta: p.n + ' ' + p.a.split(' ')[0],
          con: el.length > 1 ? P.filter(o => o.h === p.h && o !== p && !o.plus).map(o => o.n.split(' ')[0]) : [],
        })) });
      },
      async hogar(id) {
        await wait(350);
        const me = P.find(p => p.id === id); if (!me) return { ok: false, error: 'not_found' };
        return Object.assign(base(), {
          id, personas: P.filter(p => p.h === me.h).map(p => ({ id: p.id, nombre: p.n.split(' ')[0], acompanante: p.plus })),
          flags: H[me.h].flags,
          privada: H[me.h].flags.privada ? { es: 'Pregunta privada de prueba (el texto real vive solo en la hoja)', en: 'Private test question (the real text lives only in the Sheet)' } : null,
          respondido: !!answered[me.h],
        });
      },
      async submit(p) {
        await wait(700);
        if (p.tipo === 'hogar') answered[(P.find(x => x.id === p.id) || {}).h] = true;
        console.info('[rsvp mock] payload', JSON.stringify(p));
        return { ok: true };
      },
    };
  }
})();
