# Instrucciones del repositorio

- Usa siempre la skill `/caveman`.
- Pregunta las dudas antes de empezar.
- Cuando pida hacer una issue, haz commit, push y ciérrala al terminar.
- Si durante la resolución de dudas se cambia el planteamiento de la tarea de la issue entonces al acabar modificar la issue indicando esos cambios, remplazando el texto original
- Trabaja siempre en la rama actual. Crea o cambia de rama solo cuando se pida expresamente.

## Datos de prueba

- Antes de empezar cada tarea si necesitas hacer pruebas de crear datos entonces levantar la web y hacer un post a 'http://localhost:3000/api/data/clear?scope=normal' para montar el entorno de datos de pruebas, puedes hacerlo siempre que quieras sin pedir confirmación. Es una base de datos de pruebas, no hay peligro.
- No hace falta que borres datos de prueba uno a uno ni al terminar la tarea; la siguiente tarea ya hará una limpieza completa al empezar.

## Validación

- No ejecutes `pnpm build` salvo petición explícita del usuario, si has de ejecutarlo hazlo en una sesión controlada con timeout amplio (mínimo 15 minutos). Nunca les apliques el límite de 60 segundos del arranque web ni los canceles por falta temporal de salida.
- Tras cambios de código, ejecuta `pnpm lint`.
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
