# Mei Virtual Assistant

**Versión:** `0.1.0-beta`

Mei es un experimento de asistente virtual **web-first** con cuerpo digital. En lugar de ser solamente una ventana de chat, Mei aparece como un personaje chibi original que observa, se mueve, escucha, habla, recuerda y ejecuta pequeñas acciones dentro de la experiencia web.

## Qué incluye esta beta

- Personaje chibi femenino original dibujado en SVG.
- Animaciones de reposo, saludo, pensamiento, baile, descanso, celebración, escucha y habla.
- Seguimiento de la mirada con el puntero.
- Personaje arrastrable horizontalmente en escritorio.
- Menú radial al tocar a Mei.
- Burbuja de diálogo contextual.
- Reconocimiento de voz mediante Web Speech API cuando el navegador lo soporta.
- Activación por nombre dentro de la escucha: di **“Mei”** seguido de la orden.
- Voz con `speechSynthesis`, priorizando una voz en español disponible en el navegador.
- Comandos de texto.
- Memoria local con `localStorage`.
- Misiones/tareas locales.
- Navegación controlada por Mei.
- Acciones rápidas y comportamiento proactivo.
- Tema oscuro/claro.
- PWA instalable y shell offline.
- Diseño responsive para escritorio y móvil.
- CI de humo para validar sintaxis y que el sitio sirva correctamente.

## Órdenes de prueba

- `Mei`
- `Hola Mei`
- `¿Qué puedes hacer?`
- `¿Qué hora es?`
- `Recuérdame revisar CardNest`
- `Recuerda que prefiero trabajar de noche`
- `Abre GitHub`
- `Abre CardNest`
- `Muéstrame misiones`
- `Muéstrame memoria`
- `Baila Mei`
- `Salúdame`
- `Modo claro`
- `Modo oscuro`

## Ejecutar localmente

No necesita compilación ni dependencias.

```bash
git clone https://github.com/spenceralejandro10/mei-virtual-assistant.git
cd mei-virtual-assistant
python -m http.server 4173
```

Abre `http://localhost:4173`.

> El micrófono depende del soporte y permisos del navegador. Chrome y Edge suelen ofrecer la implementación más completa de Web Speech API.

## Arquitectura

```text
Usuario
  │
  ├── Texto ─────────┐
  ├── Micrófono ─────┤
  └── Interacción ───┤
                     ▼
                Behavior Engine
                app.js
            ┌────────┼────────┐
            ▼        ▼        ▼
          Cuerpo   Memoria   Acciones
          SVG/CSS  local     navegador
            │
            ▼
        Voz + estados
```

La capa de comportamiento está separada conceptualmente del cuerpo. En futuras versiones, el bloque de respuesta local puede sustituirse o ampliarse con un motor de IA remoto o local sin rehacer el personaje.

## Privacidad de esta beta

Los recuerdos y misiones se guardan en el `localStorage` del navegador. Esta versión no envía conversaciones a un backend de IA. Los enlaces externos solo se abren cuando una orden explícita los activa.

## Estado

Esta beta es un punto de partida funcional. El motor conversacional general todavía no está conectado; por diseño, el código ya distingue entre **cuerpo**, **estado**, **memoria**, **voz**, **intenciones** y **acciones**, para permitir esa integración después.
