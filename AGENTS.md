# Instrucciones del repositorio

- Sé muy escueto.
- Usa siempre la skill `/caveman`.
- Pregunta las dudas antes de empezar.
- Cuando pida hacer una issue, haz commit, push y ciérrala al terminar.
- Trabaja siempre en la rama actual. Crea o cambia de rama solo cuando se pida expresamente.

## Datos de prueba

- Antes de empezar cada tarea, usa únicamente el navegador de pruebas y abre `http://localhost:3000/dev/test-data`.
- Ejecuta `Limpiar y cargar datos de prueba` antes de trabajar. Para tareas sobre estado vacío, ejecuta solo `Limpiar`. No hace falta pidas confirmación.
- La rutina limpia únicamente la colección normal. No se ha de limpiar nunca la colección privada.
- No borres datos de prueba uno a uno ni al terminar la tarea; la siguiente tarea hará una limpieza completa al empezar.

## Validación

- No ejecutes `pnpm build` salvo petición explícita del usuario.
- Tras cambios de código, ejecuta `pnpm lint`.
- Ejecuta `pnpm lint` y, cuando se pida explícitamente, `pnpm build` en una sesión controlada con timeout amplio (mínimo 15 minutos). Nunca les apliques el límite de 60 segundos del arranque web ni los canceles por falta temporal de salida.
- Si `pnpm lint` supera 60 segundos, déjalo continuar y revisa después si existen directorios raíz inesperados o artefactos generados que ESLint esté recorriendo.
- Para validar la aplicación, usa `pnpm dev` y comprobaciones reales en navegador.
- Antes de arrancar, comprueba si `http://localhost:3000` ya responde y reutiliza ese servidor.
- Si no responde, ejecuta siempre `pnpm dev` directamente en una sesión persistente controlada. No uses `Start-Process` ni otro lanzador en segundo plano: puede quedar bloqueado por política.
- Ejecuta exactamente `pnpm dev`; no añadas `-- --port 3000`, porque el script ya configura el servidor y esos argumentos pueden interpretarse como un directorio raíz.
- Espera HTTP 200 durante un máximo de 60 segundos. Este límite solo corresponde a la comprobación de arranque web.
- No esperes a que `pnpm dev` termine: es un servidor persistente, no un comando de validación finito.
- No permitas que Nuxt cambie silenciosamente al puerto 3001.
- Detén únicamente procesos iniciados durante la tarea.
- Para cambios responsive del editor, valida 320 px y 390 px sin overflow horizontal.
