# Mis Historias

Mis Historias permite definir personajes narrativos y su identidad visual para reutilizarlos en historias e imágenes.

## Lenguaje

**Prompt del personaje**:
Descripción de personalidad, voz, motivaciones y límites que guía su comportamiento dentro de una historia.
_Evitar_: Prompt visual, prompt de imagen

**Prompt visual base**:
Descripción reutilizable de identidad visible estable y atuendo característico de un personaje.
_Evitar_: Prompt del personaje, prefijo del prompt

**Prompt de imagen**:
Descripción de pose, emoción y situación deseadas para una imagen concreta.
_Evitar_: Prompt visual base

**Notas para el prompt**:
Texto libre que orienta la creación de un prompt de imagen para un personaje. Puede estar escrito en castellano y se conserva como último borrador del personaje, separado del prompt de imagen en inglés.
_Evitar_: Prompt de imagen, prompt visual base

**Orden de imágenes del personaje**:
Secuencia persistente de las imágenes de un personaje, compartida por el editor, los visores y los selectores. Es independiente de la imagen predeterminada, se conserva al copiar o transferir el personaje y coloca las imágenes nuevas al final.
_Evitar_: Orden de creación, imagen predeterminada

**Lote de generación de imágenes**:
Conjunto de imágenes de un personaje producido por una misma ejecución de generación manual. Cada resultado terminado pertenece al lote al quedar guardado, aunque se borre después o la ejecución se cancele.
_Evitar_: Galería completa, imagen pendiente

**Foto de referencia**:
Imagen temporal usada para deducir un prompt visual base, distinta de una imagen de galería del personaje.
_Evitar_: Imagen del personaje, imagen predeterminada

**Colección pública**:
Colección editable de cada Propietario, también llamada colección normal y contrapuesta a la colección privada. Pública describe su ámbito funcional; no implica contenido global, anónimo, compartido entre propietarios ni accesible desde Internet.
_Evitar_: Colección global, colección compartida, acceso público

**Historia archivada**:
Historia conservada fuera del catálogo activo sin quedar finalizada ni bloqueada. Mantiene todo su contenido, puede abrirse, editarse y continuarse, y su condición archivada forma parte de ella.
_Evitar_: Historia eliminada, historia finalizada, historia de solo lectura

**Modo demo**:
Vista de presentación de una selección de la colección privada. No es una colección independiente ni un acceso público; una historia visible concede dentro de ella acceso contextual a los recursos que utiliza.
_Evitar_: Colección demo, modo público

**Visible en modo demo**:
Condición explícita que permite mostrar un personaje, fondo o historia privados en el modo demo. Fuera del contexto de una historia no concede visibilidad a otros recursos relacionados.
_Evitar_: Público, compartido

**Backup SQLite**:
Copia completa y restaurable de colección normal, colección privada, ajustes y secretos de una instalación de Mis Historias.
_Evitar_: Exportación JSON, copia parcial

**Secreto operativo**:
Credencial de LLM o SwarmUI que el servidor conserva para realizar llamadas salientes. La API de ajustes solo permite crear, reemplazar o borrar su valor y consultar si está configurado; nunca devuelve el valor guardado. Las trazas ocultan campos, patrones y valores de credenciales reconocibles. Los backups SQLite completos constituyen una excepción administrativa y sí conservan los secretos.
_Evitar_: Ajuste público, token visible, valor recuperable

**Usuario Access**:
Persona autenticada por Cloudflare Access cuya identidad separa sus colecciones y preferencias de las del resto.
_Evitar_: Usuario local, cuenta de Mis Historias

**Propietario**:
Usuario Access al que pertenece un recurso normal o privado y que puede modificarlo.
_Evitar_: Autor, administrador

**Administrador de la instancia**:
Primer Usuario Access que activa el modo multiusuario y conserva las operaciones globales de configuración y backup sin obtener acceso ordinario al contenido ajeno. Puede consultar el contenido textual truncado de las trazas de error operativas de cualquier usuario para diagnosticar fallos, con las credenciales reconocibles ocultas.
_Evitar_: Propietario global, superusuario de contenido

**Traza de error operativa**:
Registro persistente de un fallo del LLM, de una integración externa o de la operación interna de la instancia, consultable por el administrador o en modo de usuario único. Incluye la llamada y respuesta textuales, con campos, patrones y valores de credenciales reconocibles ocultos, además de truncado y omisión de binarios y data URLs; no incluye errores esperados de validación ni cancelaciones.
_Evitar_: Traza LLM de historia, historial de actividad, auditoría de usuario

**Recurso demo compartido**:
Historia, personaje o fondo privado visible para otros Usuarios Access en modo privado o demo, junto con las imágenes y sonidos necesarios para consultarlo, sin conceder propiedad ni permiso de edición.
_Evitar_: Recurso público, recurso sin propietario

**Elenco activo**:
Personajes que participan en las nuevas respuestas de una historia, en el orden en que fueron añadidos.
_Evitar_: Todos los personajes personalizados, catálogo de personajes

**Personalización recordada**:
Instantánea de nombre, color, prompt y etiquetas que una historia conserva para un personaje, aunque no pertenezca al elenco activo.
_Evitar_: Personaje eliminado, personalización global
