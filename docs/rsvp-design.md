# RSVP — Design Doc

**Status:** Implemented in draft PR, pending review · **Date:** 2026-10-14 · **Wedding:** 5 June 2027

> This repo is public. This doc, like the code, contains no guest data, codes or private copy.

---

## 1. Problem

The website is a static, bilingual (ES/EN) page served by GitHub Pages from this **public** repo. A static page can show a form but cannot store answers. We need somewhere to keep RSVPs that:

- costs nothing and needs no server or database to maintain,
- lives in **our Google Drive**, so the answers sit next to the rest of the wedding stuff,
- gives us **one record per invitation, never duplicates**, even when someone submits twice or changes their mind in March,
- keeps **zero secrets and zero guest data** in this repo.

### Goals

| # | Goal |
|---|------|
| G1 | Guests answer from their phone in under 2 minutes, in ES or EN |
| G2 | Exactly one record per invitation. Resubmitting **updates**, it never appends |
| G3 | No credentials, no guest names, no codes, no private copy in the repo |
| G4 | Answers land in a Google Sheet whose labels line up with the INVITADOS sheet of the workbook |
| G5 | A per-household **private question** is shown only to the households marked for it |

### Non-Goals

- Accounts, passwords or Google sign-in for guests.
- A real database, a backend server, or paid form services.
- Table seating, payments or gifts.

---

## 2. Architecture

```
┌────────────────────────────────┐
│  Guest's phone                 │
│  Opens link from invitation:   │
│  …/boda-2027/?c=K7Q2MX#rsvp    │
└───────────────┬────────────────┘
                │ static HTML/JS (GitHub Pages)
                ▼
┌────────────────────────────────┐
│  #rsvp section · rsvp/rsvp.js  │
│  · ES/EN switch (existing)     │
│  · Reads ?c= from the URL      │
│  · Knows only the endpoint URL │
└───────────────┬────────────────┘
                │ HTTPS  GET lookup / POST submit
                ▼
┌────────────────────────────────┐
│  Google Apps Script web app    │
│  apps-script/Code.gs           │
│  · Runs as us                  │
│  · Validates code + payload    │
│  · Locks → upserts → unlocks   │
└───────────────┬────────────────┘
                │ SpreadsheetApp (inside Google)
                ▼
┌────────────────────────────────┐
│  Google Sheet "RSVP Boda 2027" │
│  (private, in our Drive)       │
│  HOGARES · PERSONAS · LOG ·    │
│  TEXTOS                        │
└────────────────────────────────┘
```

**Why this stack.** Apps Script is free, lives in the same Google account as the Sheet, and needs no key handling. The script is *bound* to the Sheet, so it doesn't even need the Sheet's ID. The site stays a plain static page. The Sheet is the database.

### Alternatives Considered

| Option | Why not |
|---|---|
| Google Forms embedded | Only dedupes by forcing Google sign-in. Monolingual. Cannot show a question to some households only |
| Formspree / Netlify Forms | Third party holds the guest data. Free tiers are capped. No upsert, so duplicates come back |
| Supabase / Firebase | A real DB with keys and rules to manage. More than this needs |
| Sheets API key in the page | A key in a public repo would be a write credential. Rejected outright |

---

## 3. Dedup Strategy: Invitation Codes

Each household gets a **6-character code** that is part of its personal invite link. The code is the primary key, and every write is an **upsert** on it.

```
Submission arrives with code
        │
        ▼
  Code exists in HOGARES?
        │
   no ──┴── yes
   │         │
   ▼         ▼
 Reject    Acquire script lock
             │
             ▼
     Validate every field
             │
             ▼
     Overwrite that household's
     HOGARES row + its PERSONAS rows
             │
             ▼
     Append full payload to LOG
     (history, never read by the site)
             │
             ▼
     Release lock → ok
```

- **Same household, second submission** → same row overwritten. `ACTUALIZADO` changes and `N.º ENVÍOS` goes up by one. Latest answer wins, and LOG keeps every version.
- **Two submissions at the same moment** (both partners on two phones) → `LockService` serialises them, so the second simply overwrites the first.
- **Code alphabet:** `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, which drops 0/O and 1/I/L so codes can be read aloud and typed. 31⁶ ≈ 887 M combinations for ~70 households.
- **Codes are generated in the Sheet** with the menu item *Boda → Generar códigos y enlaces*. It fills empty cells only, never changes an existing code, and writes each household's link into `ENLACE`. It can be re-run safely.

### Guests Without a Code

Someone may open the bare URL. The form asks them to use the link from their invitation and offers a box for the 6-character code. Pasting the whole link works too. There is no code-less submission path. That is the trade-off that keeps G2 strict.

The last code that worked is remembered in the browser, so coming back later to the plain URL opens their form directly.

---

## 4. Data Model (Google Sheet)

Four tabs, created by running `setup` once. Headers are in Spanish to match the workbook. The script finds columns by header name, so columns can be reordered or extra ones added.

```
HOGARES  (1 row per invitation)
│  ── filled by us ──
├─ HOGAR              Familia García       ← unique label, also used to greet them
├─ IDIOMA             es | en              ← initial language of their form
├─ PREGUNTA PRIVADA   ✓ / blank            ← show the private question
├─ TIENE BEBÉS        ✓ / blank            ← show the baby-needs question
│  ── filled by the menu ──
├─ CÓDIGO             K7Q2MX               ← primary key
├─ ENLACE             …/?c=K7Q2MX#rsvp     ← goes into the invitation
│  ── written by the script ──
├─ RESPONDIDO         ✓
├─ ASISTEN            3 / 4
├─ AUTOBÚS            Sí | No | <stop>     ← stop labels identical to the workbook dropdown
├─ COCHE COMPARTIDO   Ofrezco plazas | Busco plaza | No
├─ RESPUESTA PRIVADA  Sí | No
├─ BEBÉS              Trona, Cuna
├─ MENSAJE            free text
├─ ACTUALIZADO        timestamp
└─ N.º ENVÍOS         2

PERSONAS (1 row per invited person)
│  ── filled by us ──
├─ HOGAR              Familia García       ← links the person to the household
├─ NOMBRE             Lucía García         ← only the first word is ever sent to the page
├─ ACOMPAÑANTE        ✓ for "+1" slots     ← guest types the name
│  ── filled by the menu ──
├─ CÓDIGO             K7Q2MX
├─ ID                 K7Q2MX-1             ← stable person id
│  ── written by the script ──
├─ ASISTE             Sí | No
├─ NOMBRE +1
├─ MENÚ               Adulto | Infantil | Vegetariano
└─ ALERGIAS           free text

LOG     FECHA · CÓDIGO · IDIOMA · DATOS (JSON)   ← append-only

TEXTOS  CLAVE · ES · EN
        PREGUNTA_PRIVADA · <text> · <text>       ← private copy lives ONLY here
```

**Why HOGARES and PERSONAS.** Attendance and menu are per person, while bus and carpool are per household. Splitting them keeps each cell atomic, so counts like `COUNTIF(PERSONAS!F:F;"Sí")` just work and columns can be copied straight into INVITADOS. People are linked to their household by the `HOGAR` label, because codes don't exist yet when we type the list. The menu then copies the code across and warns about repeated labels or people without a household.

**Workbook link.** The RSVP Sheet does not replace `GESTIÓN BODA 2027.xlsx`. The `CONFIRMADO` and bus columns in INVITADOS get filled from it.

---

## 5. API

One deployed web app with two entry points. Apps Script always answers HTTP 200, so success and errors travel in the JSON body.

```
GET  {ENDPOINT}?action=lookup&code=K7Q2MX
│
└─▶ { ok: true,
      hogar: "Familia García", idioma: "es",
      personas: [{id:"K7Q2MX-1", nombre:"Lucía", acompanante:false}, …],
      flags: {privada:false, bebes:true},
      privada: null | {es, en},          ← only for marked households
      opciones: {menu, autobus, coche, bebes},
      plazo: "2027-04-15" | null, cerrado: false,
      respuesta: null | {…previous answers}   ← lets them edit }
    { ok:false, error:"code_not_found" | "busy" }

POST {ENDPOINT}
     Content-Type: text/plain      ← avoids the CORS preflight Apps Script can't answer
     body: { code, idioma, website /* honeypot */,
             personas: [{id, asiste, menu?, alergias?, nombre_mas1?}],
             autobus?, coche?, privada?, bebes?, mensaje }
│
└─▶ { ok:true, envios:2, actualizado:"…" }
    { ok:false, error:"invalid" | "code_not_found" | "closed" | "busy" }
```

The option lists live in `CONFIG` in Code.gs and are sent with every lookup, so the page and the validator can never disagree.

**Server-side validation.** The script never trusts the page:

- the code must exist,
- the submission must contain **every** person of that household, once each, and nobody else,
- every choice must match the allowed list exactly,
- menu, bus and carpool are required only when someone is coming,
- the private and baby answers are dropped unless the household is marked,
- free text is trimmed, capped at 500 characters and stored as text, never as a formula,
- after `RSVP_DEADLINE` (a Script Property, date TBD) it answers `closed`.

---

## 6. Security & Privacy

There are **no credentials** anywhere in this design.

```
PUBLIC (this repo)                   PRIVATE (Google)
─────────────────────────────        ──────────────────────────────
Site HTML/CSS/JS                     The Sheet (names, codes, answers)
The web-app endpoint URL             The private question text (TEXTOS)
Apps Script source (no secrets)      The authorisation given on deploy
This design doc                      Script Properties (deadline)
```

- **The endpoint URL is not a secret.** Knowing it lets someone submit with a valid code, not read the Sheet.
- **Authorisation** happens once, when we click *Deploy* and approve access to the Sheet. The token stays with Google, so there is nothing to rotate or leak.

### Threats

| Threat | Mitigation |
|---|---|
| Spam / junk rows | Unknown codes rejected. No insert path exists |
| Bots filling forms | Hidden honeypot field `website`. Non-empty → pretend success, write nothing |
| Guessing codes to read names | 887 M space. Lookup returns **first names only**. After 60 failed codes in 10 min, lookups pause for everyone (`busy`) |
| Someone forwards their link | They can only edit that household. Visible in LOG and `N.º ENVÍOS` |
| Private question leaking | Its text lives only in the TEXTOS tab and is sent only to marked households. Not in the repo, not in the page source |
| Guest data committed to repo | `.gitignore` blocks spreadsheet exports and guest-list files |
| Formula injection via free text | Text starting with `= + - @` is stored as plain text |

The pause after failed codes is global, so a determined bot could annoy real guests for ten minutes at a time. That's an acceptable trade for a wedding site. If it ever happens, raising `CONFIG.MAX_FALLOS` or adding a per-code delay are easy follow-ups.

---

## 7. Frontend Flow

```
Page loads
   │
   ▼
RSVP_ENDPOINT set (or ?mock=1)? ──no──▶ section stays hidden,
   │                                    "Próximamente" card stays
  yes
   ▼
Code from ?c= or remembered? ──no──▶ "Use the link in your invitation"
   │                                  + code box ──(entered)──┐
  yes                                                         │
   ▼  ◀────────────────────────────────────────────────────────┘
GET lookup
   │
   ├─ not found ─▶ message + code box
   │
   ▼
Render form
   · "¡Hola, Familia García!" + reply-by date (or "por confirmar")
   · one card per person: coming? → menu / allergies (+1 → name)
   · if anyone is coming: bus, carpool,
     private question (marked only), baby needs (marked only)
   · prefilled when they answered before
   │
   ▼
Client check (missing answers marked in red)
   │
   ▼
POST submit ─▶ "¡Gracias!" + "you can change it with the same link"
                   └─ "Change my reply" → lookup again, prefilled
```

- **Bilingual without re-rendering.** Every string is rendered in both languages as `data-lang` spans, and the page's existing CSS shows the active one. Toggling ES/EN never wipes what the guest typed.
- **Language default.** The household's `IDIOMA` sets the initial language unless the URL already has `?lang=`.
- **Ships dark.** Until `rsvp/config.js` has the endpoint, nothing changes on the live site. The section, nav link and the swap of the "Próximamente" RSVP card all switch on together.
- **No dependencies.** Plain JS and `fetch`, no build step, like the rest of the site.

---

## 8. Repo Layout

```
index.html              ← #rsvp section, nav link, script tags
rsvp/
├─ config.js            ← RSVP_ENDPOINT (public, not secret)
├─ rsvp.js              ← lookup, render, validate, submit, mock
└─ rsvp.css
apps-script/
├─ Code.gs              ← doGet / doPost / upsert / menu / selfTest
├─ appsscript.json      ← runs as owner, anyone can call
└─ README.md            ← 10-minute deploy guide (ES)
docs/
└─ rsvp-design.md       ← this doc
.gitignore              ← blocks guest exports
```

---

## 9. Deployment (One-Time, ~10 min)

```
1. Create Sheet "RSVP Boda 2027" in Drive
        │
2. Extensions → Apps Script → paste Code.gs
        │
3. Run setup → tabs, headers, TEST01 household
        │
4. Run selfTest → all ✓
        │
5. Fill HOGARES / PERSONAS · write the private
   question in TEXTOS
        │
6. Boda → Generar códigos y enlaces
        │
7. Deploy → Web app
   · Execute as: Me
   · Who has access: Anyone
        │
8. Paste the /exec URL into rsvp/config.js → push
        │
9. Test …/?c=TEST01#rsvp from a phone
```

Step-by-step in Spanish: [`apps-script/README.md`](../apps-script/README.md).

**Updating the script later.** Use *Manage deployments → Edit → New version*. That keeps **the same URL**. A *new deployment* would change the URL and break the site.

---

## 10. Testing

| Layer | How | What it covers |
|---|---|---|
| Script, in Google | `selfTest()` from the editor or the *Boda* menu, against TEST01 | Insert, resubmit updates the same row (+2 counter, one row), bad code, bad menu, foreign person id, honeypot, formula stored as text, lookup returns previous answer and first names only |
| Script, offline | Code.gs run in Node against an in-memory fake Sheet (done for this PR) | All of the above, plus code generation and idempotency, link format, private question only when marked, deadline, throttling, `doGet`/`doPost` plumbing |
| Page | `?mock=1&c=TEST01` uses an in-page fake backend. Extra knobs: `&plazo=2027-04-15`, `&cerrado=1` | Hidden without endpoint, code entry, pasted link, conditional sections, missing-answer marking, thanks + edit with prefill, ES/EN toggle keeps input, no overflow at 390 px and 1280 px |
| Page ↔ API | Headless browser with the endpoint faked (done for this PR) | Household language applied, `text/plain` POST, exact payload shape, error messages |
| End to end | Real submit from a phone on mobile data | One row only, `N.º ENVÍOS` increments on the second submit |

---

## 11. Open Questions

| # | Question | Default until decided |
|---|---|---|
| Q1 | RSVP deadline | "Fecha límite por confirmar". No server cut-off |
| Q2 | Final question list (the content pack has a 12-question draft) | The fields in §4 |
| Q3 | Menu options available at the venue | Adulto / Infantil / Vegetariano |
| Q4 | Requena bus stop labels | Bus question is plain Sí / No |
| Q5 | Email us on each submission? | Off. Would need an extra Google permission |
| Q6 | Own domain | GitHub Pages URL in `CONFIG.SITE_URL` |
