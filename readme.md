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

## Comprobaciones

```powershell
pnpm test:storage
pnpm lint
```
