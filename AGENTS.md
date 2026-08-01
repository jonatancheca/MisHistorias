# Instrucciones del repositorio

- Sé muy escueto.
- Usa siempre la skill `/caveman`.
- Pregunta las dudas antes de empezar.

## Datos de prueba

- Antes de empezar cada tarea, usa únicamente el navegador de pruebas y abre `http://localhost:3000/dev/test-data`.
- Ejecuta `Limpiar y cargar datos de prueba` antes de trabajar. Para tareas sobre estado vacío, ejecuta solo `Limpiar`.
- La rutina limpia únicamente la colección normal. No limpies nunca la colección privada.
- No borres datos de prueba uno a uno ni al terminar la tarea; la siguiente tarea hará una limpieza completa al empezar.

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
