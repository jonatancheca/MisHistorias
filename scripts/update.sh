#!/usr/bin/env bash

set -Eeuo pipefail

SERVICE_NAME='mishistorias.service'
PORT='3010'
ARCHIVE_NAME='app-linux-x64.tar.gz'
CHECKSUM_NAME='app-linux-x64.tar.gz.sha256'
DEFAULT_RELEASE_API='https://api.github.com/repos/jonatancheca/MisHistorias/releases/latest'
SYSTEMCTL="${MISHISTORIAS_SYSTEMCTL:-systemctl}"
HEALTH_URL="${MISHISTORIAS_HEALTH_URL:-http://127.0.0.1:$PORT/api/health}"
HEALTH_TIMEOUT_SECONDS="${MISHISTORIAS_HEALTH_TIMEOUT_SECONDS:-60}"

usage() {
  cat <<'EOF'
Uso: sudo ./update.sh [--install-root RUTA] [--no-restart] [--release-api URL]

Actualiza instalación Linux x64, conserva install1/.data y restaura versión
anterior si servidor actualizado no supera /api/health.
EOF
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  return 1
}

receive_asset() {
  local source="$1"
  local destination="$2"
  local timeout_seconds="$3"
  local accept_header="${4:-application/octet-stream}"
  if [[ -f "$source" ]]; then
    cp -- "$source" "$destination"
    return
  fi
  curl --fail --silent --show-error --location --retry 3 \
    --max-time "$timeout_seconds" \
    --header "Accept: $accept_header" \
    --header 'User-Agent: MisHistorias-updater' \
    --output "$destination" \
    "$source"
}

asset_url() {
  local release_file="$1"
  local asset_name="$2"
  "$node_binary" -e '
    const fs = require("node:fs");
    const [releaseFile, assetName] = process.argv.slice(1);
    const release = JSON.parse(fs.readFileSync(releaseFile, "utf8"));
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const matches = assets.filter((asset) => asset && asset.name === assetName && typeof asset.browser_download_url === "string");
    if (matches.length !== 1) process.exit(2);
    process.stdout.write(matches[0].browser_download_url);
  ' "$release_file" "$asset_name"
}

safe_remove_update_directory() {
  local target="$1"
  [[ -n "$target" && ( -e "$target" || -L "$target" ) ]] || return 0
  case "$target" in
    "$install_root"/.update-*) ;;
    *) fail "Ruta temporal insegura: $target" ;;
  esac
  [[ ! -L "$target" ]] || fail "Ruta temporal es enlace: $target"
  rm -rf -- "$target"
}

wait_for_health() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  local response=''
  while (( SECONDS < deadline )); do
    if response="$(curl --fail --silent --show-error --max-time 3 "$HEALTH_URL" 2>/dev/null)" &&
      printf '%s' "$response" | "$node_binary" -e '
        let input = "";
        process.stdin.on("data", (chunk) => { input += chunk; });
        process.stdin.on("end", () => {
          try { process.exit(JSON.parse(input).ok === true ? 0 : 1); }
          catch { process.exit(1); }
        });
      '
    then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

validate_archive() {
  local archive="$1"
  local entries_file="$work_directory/archive-entries.txt"
  local details_file="$work_directory/archive-details.txt"

  tar -tzf "$archive" > "$entries_file"
  tar -tvzf "$archive" > "$details_file"
  if grep -Eq '^[^d-]' "$details_file"; then
    fail 'Artefacto contiene enlaces o entradas especiales y no es seguro.'
  fi

  : > "$work_directory/normalized-entries.txt"
  while IFS= read -r entry; do
    entry="${entry#./}"
    [[ -n "$entry" && "$entry" != '.' ]] || continue
    [[ "$entry" != /* ]] || fail "Ruta absoluta en artefacto: $entry"
    case "/$entry/" in
      */../*) fail "Ruta fuera de artefacto: $entry" ;;
    esac
    printf '%s\n' "${entry%/}" >> "$work_directory/normalized-entries.txt"
  done < "$entries_file"

  local required_entries=(
    'node'
    'install.sh'
    'update.sh'
    'README.md'
    'NODE-LICENSE.txt'
    'install1/server/index.mjs'
    'install1/start-server.mjs'
  )
  local required_entry
  for required_entry in "${required_entries[@]}"; do
    grep -Fxq "$required_entry" "$work_directory/normalized-entries.txt" ||
      fail "$ARCHIVE_NAME no contiene $required_entry."
  done
}

install_root=''
no_restart='false'
release_api="${MISHISTORIAS_RELEASE_API:-$DEFAULT_RELEASE_API}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-root)
      [[ $# -ge 2 ]] || fail 'Falta valor para --install-root.'
      install_root="$2"
      shift 2
      ;;
    --no-restart)
      no_restart='true'
      shift
      ;;
    --release-api)
      [[ $# -ge 2 ]] || fail 'Falta valor para --release-api.'
      release_api="$2"
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

if [[ -z "$install_root" ]]; then
  install_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
fi
[[ -d "$install_root" ]] || fail "No existe instalación: $install_root"
install_root="$(cd -- "$install_root" >/dev/null 2>&1 && pwd -P)"
[[ "$install_root" != '/' ]] || fail 'InstallRoot debe ser carpeta concreta, nunca raíz del sistema.'
[[ ! -L "$install_root" ]] || fail 'InstallRoot no puede ser enlace.'

if [[ "$SYSTEMCTL" == 'systemctl' && ${EUID:-$(id -u)} -ne 0 ]]; then
  fail 'Ejecuta update.sh con sudo.'
fi
[[ "$HEALTH_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail 'Timeout de health no válido.'

node_binary="$install_root/node"
install_directory="$install_root/install1"
[[ -x "$node_binary" ]] || fail "No existe node ejecutable: $node_binary"
[[ -f "$install_directory/start-server.mjs" ]] || fail 'Instalación no contiene install1/start-server.mjs.'
[[ -f "$install_directory/server/index.mjs" ]] || fail 'Instalación no contiene install1/server/index.mjs.'
[[ -d "$install_directory/.data" ]] || fail 'Instalación no contiene install1/.data.'

existing_link="$(find "$install_directory" -type l -print -quit)"
[[ -z "$existing_link" ]] || fail "Instalación contiene enlace no permitido: $existing_link"

load_state="$("$SYSTEMCTL" show "$SERVICE_NAME" --property=LoadState --value)"
[[ "$load_state" == 'loaded' ]] || fail "Servicio no instalado: $SERVICE_NAME"

work_directory=''
previous_directory=''
failed_directory=''
old_moved='false'
new_installed='false'
data_moved='false'
staged_install_directory=''

cleanup() {
  set +e
  safe_remove_update_directory "$work_directory"
  safe_remove_update_directory "$failed_directory"
}

rollback() {
  set +e
  local rollback_failed='false'
  if ! "$SYSTEMCTL" stop "$SERVICE_NAME" >/dev/null 2>&1; then
    printf 'Rollback no pudo detener %s. Copia anterior conservada en: %s\n' \
      "$SERVICE_NAME" "$previous_directory" >&2
    return 1
  fi

  if [[ "$new_installed" == 'true' && -d "$install_directory" ]]; then
    if [[ -d "$install_directory/.data" && ! -e "$previous_directory/.data" ]]; then
      mv -- "$install_directory/.data" "$previous_directory/.data" || rollback_failed='true'
    fi
    mv -- "$install_directory" "$failed_directory" || rollback_failed='true'
  elif [[ "$data_moved" == 'true' && -d "$staged_install_directory/.data" && ! -e "$previous_directory/.data" ]]; then
    mv -- "$staged_install_directory/.data" "$previous_directory/.data" || rollback_failed='true'
  fi
  if [[ -d "$previous_directory" ]]; then
    mv -- "$previous_directory" "$install_directory" || rollback_failed='true'
  fi

  if [[ "$no_restart" == 'false' && "$rollback_failed" == 'false' ]]; then
    "$SYSTEMCTL" start "$SERVICE_NAME" || rollback_failed='true'
    wait_for_health || rollback_failed='true'
  fi
  if [[ "$rollback_failed" == 'true' ]]; then
    printf 'Rollback falló. Copia anterior conservada en: %s\n' "$previous_directory" >&2
    return 1
  fi
  return 0
}

on_error() {
  local exit_code=$?
  trap - ERR
  set +e
  printf 'Actualización falló.\n' >&2
  if [[ "$old_moved" == 'true' ]]; then
    rollback || exit_code=1
  fi
  cleanup
  exit "$exit_code"
}

trap on_error ERR
trap cleanup EXIT

work_directory="$(mktemp -d "$install_root/.update-work.XXXXXXXX")"
download_directory="$work_directory/download"
staging_directory="$work_directory/staging"
mkdir -p -- "$download_directory" "$staging_directory"

printf 'Consultando última release...\n'
release_file="$download_directory/release.json"
receive_asset "$release_api" "$release_file" 30 'application/vnd.github+json'
archive_source="$(asset_url "$release_file" "$ARCHIVE_NAME")" ||
  fail "Release no contiene exactamente un asset $ARCHIVE_NAME."
checksum_source="$(asset_url "$release_file" "$CHECKSUM_NAME")" ||
  fail "Release no contiene exactamente un asset $CHECKSUM_NAME."
[[ -n "$archive_source" ]] || fail "Asset $ARCHIVE_NAME no tiene URL."
[[ -n "$checksum_source" ]] || fail "Asset $CHECKSUM_NAME no tiene URL."

archive_path="$download_directory/$ARCHIVE_NAME"
checksum_path="$download_directory/$CHECKSUM_NAME"
receive_asset "$archive_source" "$archive_path" 300
receive_asset "$checksum_source" "$checksum_path" 30

expected_hash="$(awk 'NR == 1 { print toupper($1) }' "$checksum_path")"
[[ "$expected_hash" =~ ^[A-F0-9]{64}$ ]] || fail 'Checksum publicado no válido.'
actual_hash="$(sha256sum "$archive_path" | awk '{ print toupper($1) }')"
[[ "$actual_hash" == "$expected_hash" ]] || fail "Checksum de $ARCHIVE_NAME no coincide."

validate_archive "$archive_path"
tar --extract --gzip --file "$archive_path" --directory "$staging_directory" \
  --no-same-owner --no-same-permissions

staged_link="$(find "$staging_directory" -type l -print -quit)"
[[ -z "$staged_link" ]] || fail "Artefacto contiene enlace no permitido: $staged_link"
staged_install_directory="$staging_directory/install1"
[[ -f "$staged_install_directory/start-server.mjs" ]] || fail 'Artefacto incompleto.'
[[ -f "$staged_install_directory/server/index.mjs" ]] || fail 'Artefacto incompleto.'
[[ ! -e "$staged_install_directory/.data" ]] || fail 'Artefacto no debe contener install1/.data.'

operation_id="$(date +%s)-$$-$RANDOM"
previous_directory="$install_root/.update-previous-$operation_id"
failed_directory="$install_root/.update-failed-$operation_id"
[[ ! -e "$previous_directory" && ! -e "$failed_directory" ]] || fail 'Ruta temporal ya existe.'

"$SYSTEMCTL" stop "$SERVICE_NAME"
mv -- "$install_directory" "$previous_directory"
old_moved='true'
mv -- "$previous_directory/.data" "$staged_install_directory/.data"
data_moved='true'
mv -- "$staged_install_directory" "$install_directory"
new_installed='true'

if [[ "$no_restart" == 'false' ]]; then
  "$SYSTEMCTL" start "$SERVICE_NAME"
  wait_for_health || fail "Servidor actualizado no respondió correctamente en puerto $PORT."
fi

safe_remove_update_directory "$previous_directory"
previous_directory=''
printf 'Actualización completada.\n'
