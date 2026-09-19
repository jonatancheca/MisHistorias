import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function argumentsFrom(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!name?.startsWith('--')) continue
    result[name.slice(2)] = argv[index + 1] ?? ''
    index += 1
  }
  return result
}

function configurationFrom(options) {
  let teamDomain
  try {
    teamDomain = new URL(String(options['team-domain'] ?? '').trim())
  } catch {
    throw new Error('El dominio del equipo no es una URL válida.')
  }
  if (
    teamDomain.protocol !== 'https:' || teamDomain.username || teamDomain.password ||
    teamDomain.port || teamDomain.pathname !== '/' || teamDomain.search || teamDomain.hash ||
    !teamDomain.hostname.endsWith('.cloudflareaccess.com')
  ) {
    throw new Error('Usa el origen HTTPS del equipo terminado en .cloudflareaccess.com.')
  }
  const audience = String(options.audience ?? '').trim()
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(audience)) {
    throw new Error('El audience de Cloudflare Access no es válido.')
  }
  return { teamDomain: teamDomain.origin, audience }
}

const options = argumentsFrom(process.argv.slice(2))
if (options.help !== undefined) {
  console.log('Uso: node access-config.mjs [--database ruta] --team-domain https://equipo.cloudflareaccess.com --audience TAG')
  process.exit(0)
}

try {
  const databasePath = options.database
    ? String(options.database)
    : fileURLToPath(new URL('./.data/mishistorias.sqlite', import.meta.url))
  const configuration = configurationFrom(options)
  if (!existsSync(databasePath)) throw new Error(`No existe la base SQLite: ${databasePath}`)

  const database = new DatabaseSync(databasePath)
  try {
    database.exec('BEGIN IMMEDIATE')
    const row = database.prepare(
      "SELECT value_json FROM settings WHERE key = 'app'"
    ).get()
    if (!row) throw new Error('La base no contiene los ajustes de Mis Historias.')
    const settings = JSON.parse(row.value_json)
    settings.accessTeamDomain = configuration.teamDomain
    settings.accessAudience = configuration.audience
    database.prepare(
      "UPDATE settings SET value_json = ? WHERE key = 'app'"
    ).run(JSON.stringify(settings))
    database.exec('COMMIT')
    const integrity = database.prepare('PRAGMA quick_check').get()
    if (integrity.quick_check !== 'ok') throw new Error('La comprobación SQLite no devolvió ok.')
  } catch (caught) {
    try { database.exec('ROLLBACK') } catch { /* Puede haber terminado antes del error. */ }
    throw caught
  } finally {
    database.close()
  }
  console.log(`Cloudflare Access actualizado en ${databasePath}`)
} catch (caught) {
  fail(caught instanceof Error ? caught.message : String(caught))
}
