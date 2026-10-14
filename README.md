# Boda Sara & Emmanuel · 5 junio 2027

Sitio estático, sin dependencias ni build. Todo lo que hay aquí es **público**.

| Ruta | Qué es |
|---|---|
| `index.html` | La web completa (bilingüe ES/EN, `?lang=en` abre en inglés) |
| `save-the-date/` | La tarjeta save-the-date y sus imágenes 1080×1920 para WhatsApp |
| `rsvp/` | Formulario RSVP de la web (oculto hasta poner la URL en `rsvp/config.js`) |
| `apps-script/` | Backend del RSVP en Google Apps Script + guía de puesta en marcha |
| `docs/rsvp-design.md` | Diseño del RSVP: arquitectura, datos, seguridad |

## Publicar

GitHub Pages sirve la rama `main` desde la raíz. Editar un archivo y hacer push = publicado en ~1 min.

```
git add -A && git commit -m "Actualizar horarios" && git push
```

## Reglas

- Nunca mencionar en público el alojamiento en la finca.
- Todo texto visible en ES **y** EN (`data-lang="es"` / `data-lang="en"`).
- Lo que no está decidido lleva la etiqueta «por confirmar», no se inventa.
- Los datos privados (lista de invitados, contratos) viven en la carpeta `2027_boda`, **no** en este repo.

## RSVP

Las respuestas van a una hoja de Google privada a través de un Apps Script: sin contraseñas ni
claves en el repo, y **una fila por invitación** (cada invitación lleva su código; reenviar
actualiza, no duplica). Puesta en marcha: [`apps-script/README.md`](apps-script/README.md).
Probar sin tocar la hoja: `?mock=1&c=TEST01`.

- Nunca subir aquí la lista de invitados ni los códigos (el `.gitignore` bloquea las exportaciones).
