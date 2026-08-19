# Mis Historias

Aplicación Nuxt para crear historias con un servidor LM Studio local. Los datos se guardan en
SQLite y se comparten con los navegadores que acceden al mismo servidor.

## Requisitos

- Node.js 24.15 o posterior.
- pnpm.
- LM Studio accesible desde el equipo que ejecuta Mis Historias.

## Desarrollo

```powershell
pnpm install
pnpm dev
```

La aplicación escucha en `http://localhost:3000` y en las interfaces de red local.

## Uso normal

```powershell
pnpm install
pnpm serve
```

`pnpm serve` compila y arranca frontend y API. Mantén la terminal abierta mientras uses la app.

SQLite se crea por defecto en `.data/mishistorias.sqlite`. Para usar otra ruta:

```powershell
$env:NUXT_SQLITE_PATH = 'D:\MisHistorias\mishistorias.sqlite'
pnpm serve
```

No hay autenticación ni HTTPS. Cualquier equipo con acceso a la dirección LAN puede leer,
modificar o borrar los datos, incluida la colección privada.

## Actualizar instalación local

Cada push a `main` crea una release con `app.zip`, su checksum SHA-256 y `update.ps1`.
Descarga el actualizador desde la última release y ejecútalo:

```powershell
PowerShell -ExecutionPolicy Bypass -File .\update.ps1
```

Por defecto actualiza `C:\local\MisHistoriasInstall\install1`. Comprueba checksum, detiene solo
el servidor Node de esa instalación, sustituye archivos mediante staging y reinicia `go.bat`.
No modifica `C:\local\MisHistoriasInstall\.data` y conserva también `install1\.data` si existe.
Si la nueva versión no supera `/api/health`, restaura la instalación anterior.

Para otra ubicación o para no reiniciar:

```powershell
PowerShell -ExecutionPolicy Bypass -File .\update.ps1 -InstallRoot 'D:\MisHistorias' -NoRestart
```

La app comprueba nuevas releases al arrancar. Ajustes permite repetir la comprobación y descargar
el actualizador más reciente.

## Comprobaciones

```powershell
pnpm test:storage
pnpm lint
```
