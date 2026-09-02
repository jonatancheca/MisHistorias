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

Para copiar una build local, `local-deploy` usa por defecto `../MisHistoriasInstall` respecto al
proyecto. Puede cambiarse con parámetro o variable de entorno:

```powershell
pnpm local-deploy -- --install-root 'D:\MisHistorias'
$env:MISHISTORIAS_INSTALL_ROOT = 'D:\MisHistorias'
pnpm local-deploy
```

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

## Release portable para Windows

Descarga `app.zip` desde la última release, extrae todo su contenido y ejecuta `start.bat`.
La release incluye Node.js 24.15.0 para Windows x64: no necesita instalar Node.js ni pnpm.
El navegador abre `http://localhost:3010` y los datos quedan en `install1\.data`.

## Release para Ubuntu

Descarga `app-linux-x64.tar.gz` desde la última release y extrae todo su contenido en una
carpeta permanente. Incluye Node.js 24.15.0 para Ubuntu 26.04 LTS x64. Desde esa carpeta:

Comando completo usando el asset de la última release de GitHub:

```bash
mkdir -p "$HOME/MisHistorias" && cd "$HOME/MisHistorias" && \
curl --fail --location --retry 3 \
  --output app-linux-x64.tar.gz \
  https://github.com/jonatancheca/MisHistorias/releases/latest/download/app-linux-x64.tar.gz && \
tar -xzf app-linux-x64.tar.gz && \
sudo ./install.sh
```

El instalador registra y arranca `mishistorias.service` como usuario que invocó `sudo`, nunca
como root. El servicio arranca con Ubuntu, escucha en el puerto 3010 y guarda los datos en
`install1/.data`.

Para actualizar:

```bash
sudo ./update.sh
```

El actualizador valida `app-linux-x64.tar.gz.sha256`, conserva `install1/.data`, reinicia solo
`mishistorias.service` y restaura la versión anterior si `/api/health` falla. Un `update.sh`
descargado en otra carpeta acepta `--install-root /ruta/permanente/MisHistorias`.

## Actualizar instalación local windows

Cada push a `main` crea portables para Windows x64 y Linux x64, sus checksums SHA-256 y los
actualizadores `update.ps1` y `update.sh`.
Para Windows, desde la carpeta extraída ejecuta:

```powershell
PowerShell -ExecutionPolicy Bypass -File .\update.ps1
```

Por defecto actualiza la carpeta que contiene `update.ps1`. Comprueba checksum, detiene solo
el servidor Node de esa instalación, sustituye archivos mediante staging y reinicia `start.bat`.
Las instalaciones antiguas siguen usando `go.bat` y Node.js del sistema. Conserva
`install1\.data` y no migra ni modifica su lanzador.
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
