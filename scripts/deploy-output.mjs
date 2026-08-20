import { access, cp, mkdir, readdir, rm } from 'node:fs/promises'
import { parse, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectDirectory = fileURLToPath(new URL('../', import.meta.url))
const outputDirectory = resolve(projectDirectory, '.output')
const preservedEntries = new Set(['.data'])

function installRootArgument(args) {
  let value = null

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') continue

    if (argument === '--install-root') {
      if (value !== null) throw new Error('Usa --install-root una sola vez.')
      value = args[index + 1] ?? ''
      index += 1
      continue
    }

    if (argument?.startsWith('--install-root=')) {
      if (value !== null) throw new Error('Usa --install-root una sola vez.')
      value = argument.slice('--install-root='.length)
      continue
    }

    throw new Error(`Parámetro no reconocido: ${argument}`)
  }

  if (value !== null && !value.trim()) throw new Error('--install-root requiere una ruta.')
  return value
}

export function resolveInstallRoot(
  args = process.argv.slice(2),
  environment = process.env,
  baseDirectory = projectDirectory
) {
  const argumentRoot = installRootArgument(args)
  const environmentRoot = environment.MISHISTORIAS_INSTALL_ROOT?.trim()
  const configuredRoot = argumentRoot ?? environmentRoot ?? resolve(baseDirectory, '..', 'MisHistoriasInstall')
  const installRoot = resolve(baseDirectory, configuredRoot)

  if (installRoot === parse(installRoot).root) {
    throw new Error('La raíz de instalación no puede ser la raíz de una unidad.')
  }

  return installRoot
}

async function validateOutput() {
  await access(resolve(outputDirectory, 'server', 'index.mjs'))
  await access(resolve(outputDirectory, 'start-server.mjs'))
}

async function cleanInstallDirectory(installDirectory) {
  await mkdir(installDirectory, { recursive: true })

  const entries = await readdir(installDirectory, { withFileTypes: true })
  await Promise.all(
    entries
      .filter((entry) => !preservedEntries.has(entry.name))
      .map((entry) => rm(resolve(installDirectory, entry.name), { force: true, recursive: true }))
  )
}

async function copyOutput(installDirectory) {
  const entries = await readdir(outputDirectory, { withFileTypes: true })
  await Promise.all(
    entries.map((entry) =>
      cp(resolve(outputDirectory, entry.name), resolve(installDirectory, entry.name), {
        force: true,
        recursive: true
      })
    )
  )
}

export async function deployOutput(args = process.argv.slice(2), environment = process.env) {
  const installRoot = resolveInstallRoot(args, environment)
  const installDirectory = resolve(installRoot, 'install1')

  await validateOutput()
  await cleanInstallDirectory(installDirectory)
  await copyOutput(installDirectory)
  return installDirectory
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const installDirectory = await deployOutput()
    console.log(`Deployment completed: ${installDirectory}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Deployment failed: ${message}`)
    process.exitCode = 1
  }
}
