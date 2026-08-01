# Instrucciones del repositorio

- Sé muy escueto.
- Usa siempre la skill `/caveman`.
- Pregunta las dudas antes de empezar.

## Validación

- No ejecutes `pnpm build` salvo petición explícita del usuario.
- Tras cambios de código, ejecuta `pnpm lint`.
- Para validar la aplicación, usa `pnpm dev` y comprobaciones reales en navegador.
- Antes de arrancar, comprueba si `http://localhost:3000` ya responde y reutiliza ese servidor.
- Si no responde, arranca `pnpm dev` como proceso no bloqueante y espera HTTP 200 durante un máximo de 60 segundos.
- No esperes a que `pnpm dev` termine: es un servidor persistente, no un comando de validación finito.
- No permitas que Nuxt cambie silenciosamente al puerto 3001.
- Detén únicamente procesos iniciados durante la tarea.
- Para cambios responsive del editor, valida 320 px y 390 px sin overflow horizontal.
