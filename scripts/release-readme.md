# Mis Historias portable

## Arrancar

1. Extrae todo `app.zip` en una carpeta normal. No ejecutes archivos dentro del ZIP.
2. Haz doble clic en `start.bat`.
3. La aplicación abrirá `http://localhost:3010` en el navegador.

No necesitas instalar Node.js ni pnpm. Sí necesitas LM Studio accesible desde este equipo.
Los datos se guardan en `install1\.data`; conserva esa carpeta al mover la aplicación.

## Actualizar

Ejecuta desde esta carpeta:

```powershell
PowerShell -ExecutionPolicy Bypass -File .\update.ps1
```

El actualizador descarga la última release, comprueba su checksum, conserva `install1\.data`,
reinicia el servidor y restaura la versión anterior si la nueva no responde correctamente.

También puedes descargar el `update.ps1` más reciente desde Ajustes o desde la última release,
copiarlo sobre este archivo y ejecutarlo con el mismo comando.
