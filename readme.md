# Mis Historias

Aplicación Nuxt para crear historias con un servidor LM Studio local. Los datos se guardan en
SQLite y se comparten con los navegadores que acceden al mismo servidor.

## Requisitos

- Node.js 24.15 o posterior.
- pnpm.
- LM Studio accesible desde el equipo que ejecuta Mis Historias.

## Desarrollo

Trabaja siempre en la rama actual. Crea o cambia de rama solo cuando se pida expresamente.

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

Detén primero el servidor abierto mediante `go.bat`. Desde la carpeta del proyecto ejecuta:

```powershell
pnpm run deploy
```

El comando compila la aplicación y copia el contenido completo de `.output` a
`C:\local\MisHistoriasInstall\install1`. Elimina artefactos antiguos de la aplicación, pero
conserva `install1\.data`. Tampoco modifica `C:\local\MisHistoriasInstall\.data` ni `go.bat`.

Cuando termine, reinicia la aplicación con:

```powershell
C:\local\MisHistoriasInstall\go.bat
```

Usa `pnpm run deploy` con `run`: `pnpm upgrade` actualiza dependencias y `pnpm deploy` es otro
comando propio de pnpm 11.

## Comprobaciones

```powershell
pnpm test:storage
pnpm lint
```
