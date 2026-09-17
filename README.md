# Boda Sara & Emmanuel · 5 junio 2027

Sitio estático, sin dependencias ni build. Todo lo que hay aquí es **público**.

| Ruta | Qué es |
|---|---|
| `index.html` | La web completa (bilingüe ES/EN, `?lang=en` abre en inglés) |
| `save-the-date/` | La tarjeta save-the-date y sus imágenes 1080×1920 para WhatsApp |

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

El formulario RSVP es una demo en GitHub Pages (no envía nada). Ver `PLAN_HOSTING_RSVP.md` en la carpeta del proyecto.
