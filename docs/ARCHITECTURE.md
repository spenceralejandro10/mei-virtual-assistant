# Arquitectura de Mei v0.1.0-beta

## Objetivo

Construir un agente personificado para navegador: el personaje no es decoración, sino una superficie de interacción persistente.

## Capas

1. **Presentación** — HTML, CSS y SVG original.
2. **Cuerpo digital** — máquina de estados visuales: idle, wave, think, dance, sleep, celebrate, listen, speak.
3. **Entrada** — texto, puntero, teclado y reconocimiento de voz.
4. **Behavior Engine** — resolución de intenciones y selección de acciones.
5. **Memoria local** — perfil, recuerdos, misiones y preferencias persistidas en localStorage.
6. **Salida** — burbujas, animación, navegación, acciones web y speech synthesis.
7. **Adaptador de inteligencia futuro** — punto de extensión para un backend/modelo sin acoplarlo al cuerpo.

## Principios

- El cuerpo nunca depende de un proveedor concreto de IA.
- Ninguna clave secreta debe almacenarse en el frontend.
- Las acciones sensibles futuras deben usar permisos explícitos.
- Mei debe informar visualmente su estado: escuchando, pensando, hablando o ejecutando.
- Las capacidades deben degradarse con elegancia cuando una API del navegador no exista.
