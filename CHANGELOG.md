# Changelog

## 0.2.0-beta — 2026-09-21

Migración del prototipo 2D/CSS a un cuerpo 3D riggeado real.

### Añadido
- Integración del modelo Yinn como cuerpo 3D de Mei, convertido a GLB y servido localmente con Three.js.
- Descubrimiento automático de huesos/nodos del rig.
- Control procedural de cabeza, torso, brazos y piernas.
- Soporte para animaciones nativas cuando el modelo las expone.
- Estados 3D para saludo, pensamiento, baile, descanso, celebración, escucha y habla.
- Indicador de carga del cuerpo 3D y fallback de error.\n- Eliminado el bloqueo de contenido restringido del visor externo al autoalojar el modelo.

### Cambiado
- Mei deja de usar el cuerpo CSS provisional como representación principal.
- Versión actualizada a `0.2.0-beta`.


## 0.1.0-beta — 2026-09-21

Primera beta funcional.

### Añadido
- Cuerpo chibi SVG animado.
- Máquina de estados visual.
- Voz y reconocimiento de voz del navegador.
- Comandos, memoria local y misiones.
- Menú radial y burbuja contextual.
- Seguimiento visual del puntero y arrastre.
- Navegación interna y acciones web.
- Tema claro/oscuro.
- PWA y caché offline.
- Prueba CI de sintaxis y servidor HTTP.
