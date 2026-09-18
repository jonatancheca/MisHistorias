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

**Foto de referencia**:
Imagen temporal usada para deducir un prompt visual base, distinta de una imagen de galería del personaje.
_Evitar_: Imagen del personaje, imagen predeterminada

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
