#!/usr/bin/env bash

set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
installer="$script_directory/install.sh"
updater="$script_directory/update.sh"
portable_readme="$script_directory/release-readme-linux.md"
node_command="$(command -v node || command -v node.exe)"
node_runtime="$("$node_command" -p 'process.execPath')"
if command -v cygpath >/dev/null 2>&1; then
  node_runtime="$(cygpath -u "$node_runtime")"
fi
temporary_base="${TMPDIR:-/tmp}"
test_root="$(mktemp -d "$temporary_base/mishistorias-linux-updater-test.XXXXXXXX")"
systemctl_log="$test_root/systemctl.log"
health_file="$test_root/health.json"
mock_systemctl="$test_root/systemctl"
if command -v cygpath >/dev/null 2>&1; then
  health_url="file:///$(cygpath -m "$health_file")"
else
  health_url="file://$health_file"
fi

cleanup() {
  local resolved
  resolved="$(cd -- "$(dirname -- "$test_root")" >/dev/null 2>&1 && pwd -P)/$(basename -- "$test_root")"
  case "$resolved" in
    "$temporary_base"/mishistorias-linux-updater-test.*) rm -rf -- "$resolved" ;;
    *) printf 'Ruta temporal insegura: %s\n' "$resolved" >&2 ;;
  esac
}
trap cleanup EXIT

fail_test() {
  printf 'Test falló: %s\n' "$*" >&2
  return 1
}

assert_file() {
  [[ -f "$1" ]] || fail_test "No existe archivo: $1"
}

assert_missing() {
  [[ ! -e "$1" ]] || fail_test "Existe ruta inesperada: $1"
}

assert_contains() {
  grep -Fq "$2" "$1" || fail_test "$1 no contiene: $2"
}

assert_not_contains() {
  if grep -Fq "$2" "$1"; then
    fail_test "$1 contiene texto inesperado: $2"
  fi
}

cat > "$mock_systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$MISHISTORIAS_SYSTEMCTL_LOG"
case "${1:-}" in
  show)
    printf 'loaded\n'
    ;;
  start)
    if [[ -n "${MISHISTORIAS_TEST_HEALTH_FILE:-}" ]]; then
      health='true'
      if [[ -f "${MISHISTORIAS_TEST_INSTALL_ROOT:-}/install1/new.txt" ]]; then
        health="${MISHISTORIAS_TEST_NEW_HEALTH:-true}"
      fi
      printf '{"ok":%s}\n' "$health" > "$MISHISTORIAS_TEST_HEALTH_FILE"
    fi
    ;;
esac
EOF
chmod 0755 "$mock_systemctl"

create_node_wrapper() {
  local destination="$1"
  printf '#!/usr/bin/env bash\nexec %q "$@"\n' "$node_runtime" > "$destination"
  chmod 0755 "$destination"
}

create_install_fixture() {
  local name="$1"
  fixture_root="$test_root/$name/installation"
  mkdir -p -- "$fixture_root/install1/server" "$fixture_root/install1/.data"
  printf '%s\n' '// old start' > "$fixture_root/install1/start-server.mjs"
  printf '%s\n' '// old server' > "$fixture_root/install1/server/index.mjs"
  printf '%s\n' 'old' > "$fixture_root/install1/old.txt"
  printf '%s\n' 'private data' > "$fixture_root/install1/.data/keep.txt"
  cp -- "$installer" "$fixture_root/install.sh"
  cp -- "$updater" "$fixture_root/update.sh"
  cp -- "$portable_readme" "$fixture_root/README.md"
  printf '%s\n' 'Node.js license fixture' > "$fixture_root/NODE-LICENSE.txt"
  create_node_wrapper "$fixture_root/node"
  chmod 0755 "$fixture_root/install.sh" "$fixture_root/update.sh"
}

create_release_fixture() {
  local name="$1"
  local link_kind="${2:-none}"
  release_root="$test_root/$name/release"
  portable_root="$release_root/portable"
  mkdir -p -- "$portable_root/install1/server"
  printf '%s\n' '// new start' > "$portable_root/install1/start-server.mjs"
  printf '%s\n' '// new server' > "$portable_root/install1/server/index.mjs"
  printf '%s\n' 'new' > "$portable_root/install1/new.txt"
  cp -- "$installer" "$portable_root/install.sh"
  cp -- "$updater" "$portable_root/update.sh"
  cp -- "$portable_readme" "$portable_root/README.md"
  printf '%s\n' 'Node.js license fixture' > "$portable_root/NODE-LICENSE.txt"
  create_node_wrapper "$portable_root/node"
  chmod 0755 "$portable_root/install.sh" "$portable_root/update.sh"

  if [[ "$link_kind" == 'hardlink' ]]; then
    ln "$portable_root/install1/new.txt" "$portable_root/install1/hardlink.txt"
  fi

  archive_path="$release_root/app-linux-x64.tar.gz"
  checksum_path="$release_root/app-linux-x64.tar.gz.sha256"
  release_file="$release_root/release.json"
  (cd "$portable_root" && tar -czf "$archive_path" .)
  (cd "$release_root" && sha256sum app-linux-x64.tar.gz > app-linux-x64.tar.gz.sha256)
  if command -v cygpath >/dev/null 2>&1; then
    archive_url="file:///$(cygpath -m "$archive_path")"
    checksum_url="file:///$(cygpath -m "$checksum_path")"
  else
    archive_url="file://$archive_path"
    checksum_url="file://$checksum_path"
  fi
  cat > "$release_file" <<EOF
{"tag_name":"main-test123","assets":[
  {"name":"app-linux-x64.tar.gz","browser_download_url":"$archive_url"},
  {"name":"app-linux-x64.tar.gz.sha256","browser_download_url":"$checksum_url"}
]}
EOF
}

run_update() {
  local new_health="${1:-true}"
  MISHISTORIAS_SYSTEMCTL="$mock_systemctl" \
  MISHISTORIAS_SYSTEMCTL_LOG="$systemctl_log" \
  MISHISTORIAS_TEST_INSTALL_ROOT="$fixture_root" \
  MISHISTORIAS_TEST_HEALTH_FILE="$health_file" \
  MISHISTORIAS_TEST_NEW_HEALTH="$new_health" \
  MISHISTORIAS_HEALTH_URL="$health_url" \
  MISHISTORIAS_HEALTH_TIMEOUT_SECONDS='2' \
    bash "$updater" --install-root "$fixture_root" --release-api "$release_file"
}

current_user="$(id -un)"
if [[ "$current_user" == 'root' ]]; then
  current_user='nobody'
fi
id "$current_user" >/dev/null 2>&1 || fail_test "No existe usuario de prueba: $current_user"

create_install_fixture 'installer spaces'
systemd_directory="$test_root/installer spaces/systemd"
mkdir -p -- "$systemd_directory"
: > "$systemctl_log"
MISHISTORIAS_SYSTEMD_DIRECTORY="$systemd_directory" \
MISHISTORIAS_SYSTEMCTL="$mock_systemctl" \
MISHISTORIAS_SYSTEMCTL_LOG="$systemctl_log" \
  bash "$fixture_root/install.sh" --user "$current_user"
service_file="$systemd_directory/mishistorias.service"
escaped_fixture_root="${fixture_root// /\\x20}"
assert_file "$service_file"
assert_contains "$service_file" "User=$current_user"
assert_contains "$service_file" 'Environment=PORT=3010'
assert_contains "$service_file" "WorkingDirectory=$escaped_fixture_root/install1"
assert_contains "$service_file" "ExecStart=$escaped_fixture_root/node $escaped_fixture_root/install1/start-server.mjs"
assert_not_contains "$service_file" 'WorkingDirectory="'
assert_not_contains "$service_file" 'ExecStart="'
assert_contains "$systemctl_log" 'enable --now mishistorias.service'

create_install_fixture 'success'
create_release_fixture 'success'
: > "$systemctl_log"
run_update 'true'
assert_file "$fixture_root/install1/new.txt"
assert_missing "$fixture_root/install1/old.txt"
assert_contains "$fixture_root/install1/.data/keep.txt" 'private data'
assert_contains "$systemctl_log" 'stop mishistorias.service'
assert_contains "$systemctl_log" 'start mishistorias.service'

create_install_fixture 'checksum'
create_release_fixture 'checksum'
printf '%064d  app-linux-x64.tar.gz\n' 0 > "$checksum_path"
: > "$systemctl_log"
if run_update 'true'; then
  fail_test 'Checksum inválido no canceló actualización.'
fi
assert_file "$fixture_root/install1/old.txt"
assert_contains "$fixture_root/install1/.data/keep.txt" 'private data'

create_install_fixture 'unsafe-link'
create_release_fixture 'unsafe-link' 'hardlink'
: > "$systemctl_log"
if run_update 'true'; then
  fail_test 'Artefacto con enlace no canceló actualización.'
fi
assert_file "$fixture_root/install1/old.txt"
assert_contains "$fixture_root/install1/.data/keep.txt" 'private data'

create_install_fixture 'health-rollback'
create_release_fixture 'health-rollback'
: > "$systemctl_log"
if run_update 'false'; then
  fail_test 'Health inválido no activó rollback.'
fi
assert_file "$fixture_root/install1/old.txt"
assert_missing "$fixture_root/install1/new.txt"
assert_contains "$fixture_root/install1/.data/keep.txt" 'private data'

printf 'Linux updater tests passed.\n'
