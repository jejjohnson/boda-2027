# RSVP · Backend en Google Apps Script

El formulario de la web guarda las respuestas en una hoja de Google de nuestro Drive. Este
script hace de puente. **No hay contraseñas ni claves:** el script corre con nuestra cuenta de
Google y la hoja sigue siendo privada. Diseño completo: [`docs/rsvp-design.md`](../docs/rsvp-design.md).

```
Web (pública)  ──GET/POST──▶  Apps Script (corre como nosotros)  ──▶  Hoja «RSVP Boda 2027» (privada)
```

## Puesta en marcha (una vez, ~10 min)

1. **Crear la hoja.** En Drive: *Nuevo → Hojas de cálculo*. Nombre: `RSVP Boda 2027`.
2. **Pegar el script.** En la hoja: *Extensiones → Apps Script*. Borrar lo que haya en `Code.gs`
   y pegar [`Code.gs`](Code.gs). Guardar (⌘S).
3. **Preparar las pestañas.** En el editor, elegir la función `setup` y pulsar *Ejecutar*. Google
   pedirá permiso para que el script use **esta hoja** — aceptar. Se crean `HOGARES`,
   `PERSONAS`, `LOG` y `TEXTOS`, y un hogar de prueba `TEST01`.
4. **Probar.** Ejecutar `selfTest`. Todas las líneas deben salir con ✓.
5. **Publicar.** *Implementar → Nueva implementación → Tipo: Aplicación web*.
   - *Ejecutar como:* **Yo**
   - *Quién tiene acceso:* **Cualquier usuario**

   Copiar la URL que acaba en `/exec`.
6. **Conectar la web.** Pegar esa URL en [`rsvp/config.js`](../rsvp/config.js), commit y push.
   La sección RSVP aparece sola en cuanto hay URL.
7. **Probar de verdad.** Abrir `…/boda-2027/?c=TEST01#rsvp` en el móvil (con datos, no wifi),
   enviar dos veces y comprobar que en `HOGARES` sigue habiendo **una** fila con `N.º ENVÍOS` = 2.

## Rellenar invitados

```
HOGARES                         PERSONAS
───────────────────────         ──────────────────────────────
HOGAR        IDIOMA  …          HOGAR          NOMBRE    ACOMPAÑANTE
Familia García  en              Familia García  Lucía
Tía Carmen      es              Familia García  Pablo
                                Tía Carmen      Carmen
                                Tía Carmen      +1        ✓
```

- Una fila por **invitación** en `HOGARES` y una por **persona** en `PERSONAS`, enlazadas por el
  texto de `HOGAR` (tiene que ser **único**).
- `ACOMPAÑANTE` = ✓ en las plazas «+1»: el invitado escribe el nombre en el formulario.
- `TIENE BEBÉS` = ✓ para preguntar trona / cuna / menú infantil.
- `PREGUNTA PRIVADA` = ✓ para los hogares que deben ver la pregunta privada. El texto (ES/EN) se
  escribe en la pestaña `TEXTOS`, fila `PREGUNTA_PRIVADA`. **Nunca va en el repo.**
- Luego: menú **Boda → Generar códigos y enlaces**. Rellena `CÓDIGO`, `ENLACE` e `ID`, y avisa
  de hogares repetidos o personas sin hogar. Se puede repetir: nunca cambia un código ya dado.
- La columna `ENLACE` es lo que va en cada invitación.

Las columnas de la derecha (`RESPONDIDO`, `ASISTEN`, `AUTOBÚS`…) las escribe el script. Las
cabeceras se buscan por nombre: se pueden reordenar o añadir columnas propias.

## Ajustes

| Qué | Dónde |
|---|---|
| Paradas del autobús | `CONFIG.AUTOBUS` en `Code.gs` — mismas etiquetas que el desplegable del workbook, sin comas |
| Opciones de menú | `CONFIG.MENU` |
| Fecha límite | *Configuración del proyecto → Propiedades del script*: `RSVP_DEADLINE` = `2027-04-15` |
| Dominio propio | `CONFIG.SITE_URL`, y volver a *Generar códigos y enlaces* |

## Actualizar el script sin cambiar la URL

*Implementar → Gestionar implementaciones → ✏️ Editar → Versión: Nueva versión → Implementar*.

⚠️ No usar *Nueva implementación*: crea **otra** URL y la web dejaría de funcionar.

## Qué es público y qué no

| Público (repo) | Privado (Google) |
|---|---|
| Este script y la web | La hoja: nombres, códigos, respuestas |
| La URL `/exec` | El texto de la pregunta privada (`TEXTOS`) |
| | El permiso que dimos al publicar |

La URL `/exec` no es un secreto: permite **enviar** con un código válido, no **leer** la hoja.
