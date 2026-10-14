# RSVP — Design Doc

**Status:** Implemented in draft PR, pending review · **Date:** 2026-10-14 · **Wedding:** 5 June 2027

> This repo is public. This doc, like the code, contains no guest data or private copy.

**Revision, same day:** the first version gave each household a personal link with a code. We dropped that: everyone gets **one general link** and finds themselves **by name**.

---

## 1. Problem

The website is a static, bilingual (ES/EN) page served by GitHub Pages from this **public** repo. A static page can show a form but cannot store answers. We need somewhere to keep RSVPs that:

- costs nothing and needs no server or database to maintain,
- lives in **our Google Drive**, next to the rest of the wedding stuff,
- works with **one link for everyone** (no per-guest links to manage),
- gives us **one record per invitation, never duplicates**, even when someone submits twice, or two people from the same family both answer,
- keeps **zero secrets and zero guest data** in this repo.

### Goals

| # | Goal |
|---|------|
| G1 | Guests answer from their phone in under 2 minutes, in ES or EN |
| G2 | One shared link. Guests find themselves by typing their name, with accents, case and small typos forgiven |
| G3 | One person answers for their whole household |
| G4 | Exactly one record per household. Resubmitting **updates**, it never appends |
| G5 | Nobody gets stuck: a guest who isn't found can still answer, and we match them by hand |
| G6 | No credentials, guest names or private copy in the repo |
| G7 | A per-household **private question** is shown only to the households marked for it |

### Non-Goals

- Accounts, passwords or Google sign-in for guests.
- A real database, a backend server, or paid form services.
- Strong identity checks. With one public link, anyone who knows a guest's name can answer for them (§6).

---

## 2. Architecture

```
┌────────────────────────────────┐
│  Guest's phone                 │
│  Same link for everyone:       │
│  …/boda-2027/#rsvp             │
└───────────────┬────────────────┘
                │ static HTML/JS (GitHub Pages)
                ▼
┌────────────────────────────────┐
│  #rsvp section · rsvp/rsvp.js  │
│  · ES/EN switch (existing)     │
│  · Knows only the endpoint URL │
└───────────────┬────────────────┘
                │ HTTPS  GET buscar / hogar · POST submit
                ▼
┌────────────────────────────────┐
│  Google Apps Script web app    │
│  apps-script/Code.gs           │
│  · Runs as us                  │
│  · Fuzzy name search           │
│  · Locks → upserts → unlocks   │
└───────────────┬────────────────┘
                │ SpreadsheetApp (inside Google)
                ▼
┌────────────────────────────────┐
│  Google Sheet "RSVP Boda 2027" │
│  (private, in our Drive)       │
│  PERSONAS · HOGARES ·          │
│  PENDIENTES · LOG · TEXTOS     │
└────────────────────────────────┘
```

**Why this stack.** Apps Script is free, lives in the same Google account as the Sheet, and needs no key handling. The script is *bound* to the Sheet, so it doesn't even need the Sheet's ID. The site stays a plain static page. The Sheet is the database, and the guest list we already keep becomes the thing guests search against.

### Alternatives Considered

| Option | Why not |
|---|---|
| Personal link per household (v1 of this doc) | Robust, but we don't want to manage one link per invitation |
| Google Forms embedded | Can't match against our list, so typed names pile up as duplicates. Monolingual |
| Formspree / Netlify Forms | Third party holds the data. No matching, no upsert |
| Supabase / Firebase | A real DB with keys and rules to manage. More than this needs |

---

## 3. How a Guest Finds Themselves

```
"Nombre: [Lucia]   Apellido: [garcia]"
        │
        ▼
Normalise both sides
  lowercase · strip accents · keep letters
  drop particles (de, del, la, y…)
        │
        ▼
Score every person on the list
  first name ≥ 0.88 similar   AND
  one surname ≥ 0.88 similar
        │
        ▼
Candidates within 0.08 of the best
   │
   ├─ none ──────▶ "We couldn't find you"
   │                 · try again
   │                 · reply anyway ─▶ open form (§5)
   │
   ├─ one  ──────▶ "¿Eres Lucía García?"
   │                 · yes ─▶ household form
   │                 · no  ─▶ search again
   │
   └─ 2–3  ──────▶ "¿Cuál eres?"
                     Lucía García · Con Pablo
                     Lucía García · Sin acompañantes
```

### The Matcher

Each person on the list has `NOMBRE`, `APELLIDOS` and an optional `ALIAS` column.

- **Similarity.** Jaro–Winkler on normalised words: 1 means identical, and small typos stay above 0.88 ("Garsia" ≈ "García", "Johnsonn" ≈ "Johnson").
- **First name** matches if any typed form is close to any of theirs. Each word counts on its own, so "Juan" finds "Juan Emmanuel". Compound names also count written together, so "Maricarmen" finds "María del Carmen". `ALIAS` covers nicknames that aren't spelling variants ("Pepe" → José, "Eman" → Juan Emmanuel).
- **Surname** matches if **one** typed surname is close to one of theirs, since most people type only the first. Typing both earns a bonus that breaks ties between two Lucía Garcías.
- **Both** must match. A first name alone or a surname alone returns nothing, so the search can't be used to list the guests.
- **+1 placeholder rows** are never searchable. Plus-ones are told to search for the person who invited them.

Thresholds live in `CONFIG` (`UMBRAL` 0.88, `EMPATE` 0.08) and are covered by tests (§10).

---

## 4. Dedup Strategy

The guest list is pre-loaded, so a matched guest never creates a row: they **update their household's row**.

```
Confirmed person (ID from PERSONAS)
        │
        ▼
   their HOGAR → household key
        │
        ▼
 Acquire script lock
        │
        ▼
 Validate: every person of the household,
 once each, nobody else; valid choices
        │
        ▼
 Overwrite HOGARES row + PERSONAS rows
 (RESPONDIÓ = who sent it, N.º ENVÍOS +1)
        │
        ▼
 Append full payload to LOG → release
```

- **Lucía answers, then Pablo answers** → both resolve to the same household and the last answer wins. `RESPONDIÓ` shows who sent it and LOG keeps both versions.
- **Same person twice, spelled differently** → both searches land on the same person, so it's the same row.
- **Two submissions at the same moment** → `LockService` serialises them.

### Guests Not on the List

They answer through an open form, and the result goes to **PENDIENTES**, keyed by their normalised typed name. "Zoé Zzz" and "zoe ZZZ" are the same key, so a second try updates the same row. We then read the row and link it to the right person by hand, with a `NOTA` column for that.

---

## 5. Data Model (Google Sheet)

Five tabs, created by running `setup` once. Headers are in Spanish to match the workbook. The script finds columns by header name, so columns can be reordered or extra ones added.

```
PERSONAS  (1 row per guest — the list we paste in)
│  ── filled by us ──
├─ HOGAR           Familia García     ← group; blank = their own household
├─ NOMBRE          Lucía
├─ APELLIDOS       García López       ← needed to be found
├─ ALIAS           Lucy; Lu           ← optional nicknames
├─ ACOMPAÑANTE     ✓ for "+1" slots
│  ── filled by the menu ──
├─ CÓDIGO          K7Q2MX             ← internal household key, never shown
├─ ID              K7Q2MX-1           ← internal person key
│  ── written by the script ──
├─ ASISTE · NOMBRE +1 · MENÚ · ALERGIAS

HOGARES  (1 row per household — created by the menu)
│  ── filled by us ──
├─ PREGUNTA PRIVADA  ✓ / blank         ← show the private question
├─ TIENE BEBÉS       ✓ / blank         ← show the baby-needs question
│  ── written by the script ──
├─ RESPONDIDO · RESPONDIÓ · ASISTEN (3 / 4)
├─ AUTOBÚS · COCHE COMPARTIDO · RESPUESTA PRIVADA · BEBÉS
└─ MENSAJE · ACTUALIZADO · N.º ENVÍOS

PENDIENTES  (not found on the list — to review by hand)
└─ CLAVE · NOMBRE ESCRITO · PERSONAS · ASISTEN · AUTOBÚS ·
   COCHE COMPARTIDO · MENSAJE · ACTUALIZADO · N.º ENVÍOS · NOTA

LOG     FECHA · TIPO · REFERENCIA · IDIOMA · DATOS (JSON)   ← append-only

TEXTOS  PREGUNTA_PRIVADA · <ES> · <EN>   ← private copy lives ONLY here
```

**Workflow.** We fill PERSONAS from the INVITADOS sheet of `GESTIÓN BODA 2027.xlsx`, adding surnames. Then *Boda → Preparar invitados* does the rest:

- a person with an empty `HOGAR` becomes their own household,
- every household gets a row in HOGARES,
- households and people get internal keys.

It also warns about people without a surname, who can't be found, and about identical names, which the site will disambiguate by household. It is safe to re-run after adding guests.

---

## 6. API

One deployed web app. Apps Script always answers HTTP 200, so success and errors travel in the JSON body.

```
GET ?action=buscar&nombre=Lucia&apellidos=garcia
└─▶ { ok, candidatos: [{id, etiqueta:"Lucía García", con:["Pablo"]}],
      opciones, plazo, cerrado }
      (con = household first names, only when several candidates)

GET ?action=hogar&id=K7Q2MX-1
└─▶ { ok, id, personas: [{id, nombre:"Lucía", acompanante}],
      flags:{privada, bebes}, privada: null | {es, en},
      respondido: true|false,          ← never the previous answers
      opciones, plazo, cerrado }

POST  Content-Type: text/plain      ← avoids the CORS preflight Apps Script can't answer
  { tipo:"hogar", id, personas:[{id, asiste, menu?, alergias?, nombre_mas1?}],
    autobus?, coche?, privada?, bebes?, mensaje, idioma, website }
  { tipo:"pendiente", nombre, apellidos, personas:[{nombre, asiste, menu?, alergias?}],
    autobus?, coche?, mensaje, idioma, website }
└─▶ { ok:true, envios, actualizado }
    { ok:false, error: "invalid" | "not_found" | "closed" | "busy" }
```

**Server-side validation.** The script never trusts the page:

- a household submission must contain **every** person of that household, once each, and nobody else,
- an open submission needs a first and last name and 1–8 named people,
- every choice must match the option lists in `CONFIG` (sent with each response, so page and validator agree),
- menu, bus and carpool are required only when someone is coming,
- the private and baby answers are dropped unless the household is marked,
- free text is trimmed, capped at 500 characters and stored as text, never as a formula,
- after `RSVP_DEADLINE` (a Script Property, date TBD) it answers `closed`.

---

## 7. Security & Privacy

There are **no credentials** anywhere in this design.

```
PUBLIC (this repo)                   PRIVATE (Google)
─────────────────────────────        ──────────────────────────────
Site HTML/CSS/JS                     The Sheet (names, answers)
The web-app endpoint URL             The private question text
Apps Script source (no secrets)      The authorisation given on deploy
This design doc                      Script Properties (deadline)
```

- **The endpoint URL is not a secret.** It allows searching by full name and submitting answers, never reading the Sheet.
- **Authorisation** happens once, when we click *Deploy*. The token stays with Google.

### Threats

| Threat | Mitigation |
|---|---|
| Someone answers as another guest | Accepted trade-off of one public link. Every submission is in LOG with who sent it (`RESPONDIÓ`), and we can see and fix it |
| Reading other guests' answers | Never returned. Lookups show only first names and whether the household already replied |
| Listing the guest list | Needs first name **and** surname to match. Search results show first name + first surname, plus household first names only on ties |
| Search abuse | 400 searches per 10 min across the site, then a "try again in a few minutes" message |
| Spam into PENDIENTES | One row per typed name (upsert), honeypot field, max 8 people per submission. We review the tab anyway |
| Private question leaking | Its text lives only in the TEXTOS tab, sent only to marked households |
| Guest data committed to repo | `.gitignore` blocks spreadsheet and guest-list exports |
| Formula injection via free text | Text starting with `= + - @` is stored as plain text |

---

## 8. Frontend Flow

```
Page loads
   │
   ▼
RSVP_ENDPOINT set (or ?mock=1)? ──no──▶ section hidden,
   │                                    "Próximamente" card stays
  yes
   ▼
Search: Nombre + Apellido
   │
   ▼
§3: one / several / none
   │
   ├─ household form
   │   · "¡Hola, Lucía y Pablo!" + reply-by date
   │   · one card per person: coming? → menu / allergies
   │     (+1 card → their name)
   │   · if anyone comes: bus, carpool,
   │     private question*, baby needs*      (*marked only)
   │   · "we already have a reply" note if respondido
   │
   └─ open form (not found)
       · first card = the typed name
       · "+ Add a person" / "Remove"
       · bus, carpool, message
   │
   ▼
Client check (missing answers in red) → POST
   │
   ▼
"¡Gracias!" + "Change my reply" (reopens with what they sent)
```

- **Bilingual without re-rendering.** Every string is rendered in both languages as `data-lang` spans, and the page's existing CSS shows the active one. Toggling ES/EN never wipes what the guest typed.
- **Ships dark.** Until `rsvp/config.js` has the endpoint, nothing changes on the live site.
- **No dependencies.** Plain JS and `fetch`, no build step.

---

## 9. Repo Layout

```
index.html              ← #rsvp section, nav link, script tags
rsvp/
├─ config.js            ← RSVP_ENDPOINT (public, not secret)
├─ rsvp.js              ← search, forms, submit, mock backend
└─ rsvp.css
apps-script/
├─ Code.gs              ← doGet / doPost / matcher / upsert / menu / selfTest
├─ appsscript.json      ← runs as owner, anyone can call
└─ README.md            ← 10-minute deploy guide (ES)
docs/
└─ rsvp-design.md       ← this doc
.gitignore              ← blocks guest exports
```

---

## 10. Testing

| Layer | How | What it covers |
|---|---|---|
| Script, in Google | `selfTest()` from the *Boda* menu, with the test household (Ana and Bruno Prueba) | Search, typos, no-match, household submit and resubmit (one row, +2 counter), invalid menu, missing person, unknown id, honeypot, open form upsert |
| Script, offline | Code.gs run in Node against an in-memory fake Sheet (done for this PR, 42 checks) | Above, plus a realistic list: ties between two Lucía Garcías and their tie-break, aliases, compound names, accents, surname-only and first-name-only searches return nothing, +1 never searchable, two family members answering the same household, deadline, rate limit |
| Page | `?mock=1` uses an in-page fake backend with a sample list. Try *Ana Prueba*, *Lucía García*, *Maika Ruis*, or any unknown name. Extra knobs: `&plazo=2027-04-15`, `&cerrado=1` | All screens, missing-answer marking, add/remove people, thanks + edit, ES/EN toggle keeps input, no overflow at 390 px and 1280 px |
| Page ↔ API | Headless browser with the endpoint faked (done for this PR) | Accents encoded in search, `text/plain` POST, exact payloads, "already replied" note |
| End to end | Real submit from a phone on mobile data | One row per household, `N.º ENVÍOS` increments on resubmit |

---

## 11. Open Questions

| # | Question | Default until decided |
|---|---|---|
| Q1 | RSVP deadline | "Fecha límite por confirmar". No server cut-off |
| Q2 | Final question list (the content pack has a 12-question draft) | The fields in §5 |
| Q3 | Menu options available at the venue | Adulto / Infantil / Vegetariano |
| Q4 | Requena bus stop labels | Bus question is plain Sí / No |
| Q5 | Email us on each submission? | Off. Would need an extra Google permission |
