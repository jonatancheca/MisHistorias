# Mis Historias para Ubuntu

Portable para Ubuntu 26.04 LTS x64. Incluye Node.js; no necesita instalar Node.js ni pnpm.

## Instalar como servicio

1. Extrae todo `app-linux-x64.tar.gz` en su carpeta definitiva. No ejecutes archivos dentro del archivo comprimido.
2. Entra en esa carpeta y ejecuta:

```bash
sudo ./install.sh
```

El instalador registra `mishistorias.service`, lo habilita al arrancar Ubuntu y ejecuta la
aplicación como usuario que invocó `sudo`, nunca como root. La aplicación escucha en
`http://localhost:3010` y en la red local.

La instalación no añade autenticación ni HTTPS por sí sola. Antes de exponerla en red, protégela
con Cloudflare Tunnel y Access y activa el modo multiusuario desde Ajustes.

Los datos quedan en `install1/.data`. Conserva esa carpeta al mover o respaldar la instalación.

## Actualizar

Desde la carpeta instalada:

```bash
sudo ./update.sh
```

El actualizador descarga la última release Linux x64, comprueba su checksum, conserva
`install1/.data`, reinicia únicamente `mishistorias.service` y restaura la versión anterior si
la nueva no supera `/api/health`.

Si descargaste `update.sh` desde Ajustes o GitHub Releases, indica la instalación:

```bash
sudo bash update.sh --install-root /ruta/permanente/MisHistorias
```

Para actualizar archivos sin volver a arrancar el servicio:

```bash
sudo ./update.sh --no-restart
```

## Recuperar Cloudflare Access

Con el modo multiusuario activo, una configuración Access ausente o inválida cierra la API. Si
no puedes corregirla desde Ajustes, detén el servicio y ejecuta desde la carpeta instalada:

```bash
sudo systemctl stop mishistorias.service
./node ./install1/access-config.mjs --team-domain https://equipo.cloudflareaccess.com --audience TU_AUDIENCE
sudo systemctl start mishistorias.service
```

El script solo modifica la configuración Access de la base local. No desactiva el aislamiento
ni expone una ruta de recuperación por HTTP.
