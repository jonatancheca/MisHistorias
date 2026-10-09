# Listado y validación de backups SQLite

La pantalla de Ajustes lista las copias locales de la instancia. Solo el administrador de la instancia puede listarlas, crearlas, subirlas, descargarlas o restaurarlas. Los archivos contienen ambas colecciones, ajustes y secretos.

## Qué hace el listado

1. Ajustes solicita GET /api/backups en segundo plano al abrirse; abrir el diálogo vuelve a refrescar el listado.
2. El servidor comprueba los permisos y lanza un worker. Las peticiones simultáneas de la misma carpeta comparten trabajo; las posteriores vuelven a leer los archivos para detectar cambios externos.
3. El worker recorre la carpeta backups junto a la base activa y selecciona archivos regulares con el prefijo de esa base y extensión .sqlite, excluyendo enlaces simbólicos y directorios.
4. Lee tamaño y fecha de modificación. Abre cada SQLite solo en lectura y consulta user_version y sqlite_schema para comprobar versión admitida, esquema no vacío y presencia de alguna tabla reconocida de Mis Historias. No lee todas las tablas ni los BLOB de imágenes y sonidos, y no ejecuta quick_check.
5. Clasifica cada copia como manual, subida, anterior a restauración o de migración y devuelve nombre, clase, fecha, tamaño, versión y compatibilidad, ordenadas de más reciente a más antigua.
6. Ajustes muestra el último backup compatible y el diálogo permite descargar cualquier archivo listado; Restaurar solo está disponible para copias compatibles.

Compatibilidad no garantiza integridad ni que estén presentes todas las tablas necesarias para restaurar. El diálogo explica esta diferencia y la restauración comprueba el archivo completo antes de cambiar la base actual.

## Por qué tardaba

El listado anterior ejecutaba PRAGMA quick_check para cada copia, secuencialmente. Esta comprobación recorre la estructura y los datos SQLite, por lo que su coste depende del volumen total de los archivos, no solo de cuántos hay. El worker evitaba bloquear Ajustes, pero el listado esperaba a que terminaran todas las inspecciones. Cada solicitud posterior repetía la comprobación completa.

La descarga también buscaba el archivo mediante un listado completo síncrono, comprobando todos los backups de nuevo. Ahora comprueba el nombre y los metadatos de una única copia; rechaza rutas externas, nombres de otra base, extensiones ajenas, enlaces simbólicos y directorios.

## Validación al escribir o restaurar

- Crear conserva VACUUM INTO y la comprobación completa de la copia temporal antes de publicarla.
- Subir conserva la comprobación completa del origen y de la copia temporal antes de publicarla.
- Restaurar comprueba íntegramente el archivo elegido antes de crear la copia de seguridad previa. Después comprueba la copia temporal y su versión, conserva la configuración Access actual y vuelve a comprobar SQLite antes de reemplazar la base. Un archivo corrupto se rechaza aunque su esquema todavía parezca compatible.

## Medición local del 9 de octubre de 2026

Antes del cambio: 33 copias, 2.157.080.576 bytes (2,01 GiB); GET /api/backups tardó 3,116 segundos. No se reprodujo en local el minuto comunicado en la issue.

Una medición directa posterior, con el disco ya utilizado, separó 2 ms de metadatos, 20 ms de apertura y consultas de esquema y 1.131 ms de comprobación completa. Esas fases se midieron fuera de la petición HTTP y no deben sumarse ni compararse como una ejecución idéntica de la API. La caché del sistema y el almacenamiento pueden cambiar los tiempos.

Después del cambio, con los mismos 33 archivos y volumen: tres solicitudes GET /api/backups tardaron 172, 73 y 75 ms. Durante la comprobación final en navegador, con 37 copias tras las pruebas de creación y restauración, la petición tardó 139 ms. Son mediciones de este entorno local, no una garantía para otros discos o instalaciones.

Validación: pnpm lint, tipos de los proyectos Nuxt de aplicación y servidor, 72 pruebas SQLite y 4 pruebas Chromium. Las pruebas cubren listado pendiente, reintento tras fallo, compatibilidad sin prometer integridad, descarga con progreso, subida y restauración. Una copia con el esquema legible y datos corruptos aparece como compatible, pero subirla o restaurarla falla sin crear copia previa ni modificar la base actual. Se comprueba también el rechazo de rutas externas, directorios y enlaces, y que la descarga no recorra el listado completo.

El diálogo se comprobó a 320, 390, 640, 768 y 1280 px sin overflow horizontal ni botones fuera de pantalla. Las capturas quedan en .data, ignorado por Git.

Seguimiento: [issue #262](https://github.com/jonatancheca/MisHistorias/issues/262).
