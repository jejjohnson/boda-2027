# RSVP · Backend en Google Apps Script

El formulario de la web guarda las respuestas en una hoja de Google de nuestro Drive. Este
script hace de puente. **No hay contraseñas ni claves:** el script corre con nuestra cuenta de
Google y la hoja sigue siendo privada. Diseño completo: [`docs/rsvp-design.md`](../docs/rsvp-design.md).

```
Web (un enlace para todos)
        │  «Lucía García»
        ▼
Apps Script: busca el nombre en PERSONAS
        │  (sin acentos, mayúsculas ni erratas pequeñas)
        ▼
Responde por todo su hogar → se ACTUALIZA su fila
(si no aparece → PENDIENTES, para revisarlo a mano)
```

## Puesta en marcha (una vez, ~10 min)

1. **Crear la hoja.** En Drive: *Nuevo → Hojas de cálculo*. Nombre: `RSVP Boda 2027`.
2. **Pegar el script.** En la hoja: *Extensiones → Apps Script*. Borrar lo que haya en `Code.gs`
   y pegar [`Code.gs`](Code.gs). Guardar (⌘S).
3. **Preparar las pestañas.** En el editor, elegir la función `setup` y pulsar *Ejecutar*. Google
   pedirá permiso para que el script use **esta hoja**: aceptar. Se crean `PERSONAS`, `HOGARES`,
   `PENDIENTES`, `LOG` y `TEXTOS`, con un hogar de prueba (Ana y Bruno Prueba).
4. **Probar.** Ejecutar `selfTest`. Todas las líneas deben salir con ✓.
5. **Publicar.** *Implementar → Nueva implementación → Tipo: Aplicación web*.
   - *Ejecutar como:* **Yo**
   - *Quién tiene acceso:* **Cualquier usuario**

   Copiar la URL que acaba en `/exec`.
6. **Conectar la web.** Pegar esa URL en [`rsvp/config.js`](../rsvp/config.js), commit y push.
   La sección RSVP aparece sola en cuanto hay URL.
7. **Probar de verdad.** Abrir la web en el móvil (con datos, no wifi), buscar «Ana Prueba»,
   enviar dos veces y comprobar que en `HOGARES` sigue habiendo **una** fila con `N.º ENVÍOS` = 2.
   Después, borrar las filas de prueba.

## Rellenar invitados

Solo hay que rellenar **PERSONAS** (se puede pegar desde la pestaña INVITADOS del workbook):

```
HOGAR           NOMBRE            APELLIDOS       ALIAS        ACOMPAÑANTE
Familia García  Lucía             García López
Familia García  Pablo             García López
Familia García  +1                                             ✓
                María del Carmen  Ruiz Pérez      Mari Carmen; Maika
                José              Fernández       Pepe
```

- **HOGAR** agrupa a quienes van juntos: uno responde por todos. En blanco = va solo/a.
- **APELLIDOS** es imprescindible: sin apellido no se le puede encontrar. Basta con que el
  invitado escriba uno de ellos.
- **ALIAS** (opcional): apodos que no se parecen al nombre («Pepe», «Maika»), separados por `;`.
  Las tildes, mayúsculas y erratas pequeñas ya se toleran solas.
- **ACOMPAÑANTE** = ✓ en las plazas «+1»: el invitado escribe el nombre en el formulario. Los +1
  no se buscan; la web les dice que busquen a quien les invitó.

Luego: menú **Boda → Preparar invitados**. Crea las filas de `HOGARES`, pone las claves internas
y avisa de personas sin apellido o nombres repetidos. Se puede repetir siempre que se añadan
invitados.

En `HOGARES` se marcan dos cosas por hogar:

- `TIENE BEBÉS` = ✓ para preguntar trona / cuna / menú infantil.
- `PREGUNTA PRIVADA` = ✓ para los hogares que deben ver la pregunta privada. El texto (ES/EN) se
  escribe en la pestaña `TEXTOS`, fila `PREGUNTA_PRIVADA`. **Nunca va en el repo.**

## Leer las respuestas

| Pestaña | Qué mirar |
|---|---|
| `HOGARES` | `RESPONDIDO`, `ASISTEN` (3 / 4), `RESPONDIÓ` (quién envió), autobús, coche… Filtrar por `RESPONDIDO` vacío = quién falta |
| `PERSONAS` | Una fila por invitado: `ASISTE`, `MENÚ`, `ALERGIAS`, nombre del +1 |
| `PENDIENTES` | Gente que no encontramos. Ver quién es, apuntarlo en `NOTA` y pasarlo a mano |
| `LOG` | Historial de todos los envíos, por si alguien cambia algo y hay que mirar |

## Ajustes

| Qué | Dónde |
|---|---|
| Paradas del autobús | `CONFIG.AUTOBUS` en `Code.gs`, mismas etiquetas que el desplegable del workbook, sin comas |
| Opciones de menú | `CONFIG.MENU` |
| Fecha límite | *Configuración del proyecto → Propiedades del script*: `RSVP_DEADLINE` = `2027-04-15` |
| Tolerancia de la búsqueda | `CONFIG.UMBRAL` (0.88). Más bajo = más permisivo con erratas, más falsos parecidos |

## Actualizar el script sin cambiar la URL

*Implementar → Gestionar implementaciones → ✏️ Editar → Versión: Nueva versión → Implementar*.

⚠️ No usar *Nueva implementación*: crea **otra** URL y la web dejaría de funcionar.

## Qué es público y qué no

| Público (repo) | Privado (Google) |
|---|---|
| Este script y la web | La hoja: nombres y respuestas |
| La URL `/exec` | El texto de la pregunta privada (`TEXTOS`) |
| | El permiso que dimos al publicar |

La URL `/exec` permite **buscar** por nombre y apellido completos y **enviar** respuestas.
Nunca deja **leer** la hoja ni las respuestas de nadie.
