#!/usr/bin/env bash

set -Eeuo pipefail

SERVICE_NAME='mishistorias.service'
PORT='3010'
SYSTEMD_DIRECTORY="${MISHISTORIAS_SYSTEMD_DIRECTORY:-/etc/systemd/system}"
SYSTEMCTL="${MISHISTORIAS_SYSTEMCTL:-systemctl}"

usage() {
  cat <<'EOF'
Uso: sudo ./install.sh [--user USUARIO]

Registra la carpeta extraída como servicio systemd mishistorias.service.
EOF
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  return 1
}

systemd_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//%/%%}"
  printf '"%s"' "$value"
}

service_user=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)
      [[ $# -ge 2 ]] || fail 'Falta valor para --user.'
      service_user="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Argumento no reconocido: $1"
      ;;
  esac
done

if [[ "$SYSTEMD_DIRECTORY" == '/etc/systemd/system' && ${EUID:-$(id -u)} -ne 0 ]]; then
  fail 'Ejecuta install.sh con sudo.'
fi

if [[ -z "$service_user" ]]; then
  service_user="${SUDO_USER:-$(id -un)}"
fi
if [[ -z "$service_user" || "$service_user" == 'root' ]]; then
  fail 'No se ejecutará Mis Historias como root. Usa --user USUARIO.'
fi
id "$service_user" >/dev/null 2>&1 || fail "No existe usuario: $service_user"

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
install_directory="$script_directory/install1"

required_files=(
  "$script_directory/node"
  "$script_directory/update.sh"
  "$script_directory/README.md"
  "$script_directory/NODE-LICENSE.txt"
  "$install_directory/start-server.mjs"
  "$install_directory/server/index.mjs"
)
for required_file in "${required_files[@]}"; do
  [[ -f "$required_file" ]] || fail "No existe archivo requerido: $required_file"
done
[[ -x "$script_directory/node" ]] || fail 'node no tiene permiso de ejecución.'
[[ -x "$script_directory/update.sh" ]] || fail 'update.sh no tiene permiso de ejecución.'

data_directory="$install_directory/.data"
if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
  service_group="$(id -gn "$service_user")"
  install -d -m 0750 -o "$service_user" -g "$service_group" "$data_directory"
else
  mkdir -p -- "$data_directory"
  chmod 0750 "$data_directory" 2>/dev/null || true
fi

mkdir -p -- "$SYSTEMD_DIRECTORY"
service_path="$SYSTEMD_DIRECTORY/$SERVICE_NAME"
temporary_service="$service_path.tmp.$$"
trap 'rm -f -- "$temporary_service"' EXIT

quoted_working_directory="$(systemd_quote "$install_directory")"
quoted_node="$(systemd_quote "$script_directory/node")"
quoted_start="$(systemd_quote "$install_directory/start-server.mjs")"

cat > "$temporary_service" <<EOF
[Unit]
Description=Mis Historias
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=$service_user
WorkingDirectory=$quoted_working_directory
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=$PORT
ExecStart=$quoted_node $quoted_start
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

chmod 0644 "$temporary_service"
mv -f -- "$temporary_service" "$service_path"
"$SYSTEMCTL" daemon-reload
"$SYSTEMCTL" enable --now "$SERVICE_NAME"
"$SYSTEMCTL" is-active --quiet "$SERVICE_NAME"

printf 'Servicio instalado: %s\n' "$SERVICE_NAME"
printf 'Aplicación: http://localhost:%s\n' "$PORT"
