import { access, cp, mkdir, readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDirectory = fileURLToPath(new URL('../', import.meta.url))
const outputDirectory = resolve(projectDirectory, '.output')
const installDirectory = 'C:\\local\\MisHistoriasInstall\\install1'
const preservedEntries = new Set(['.data'])

async function validateOutput() {
  await access(resolve(outputDirectory, 'server', 'index.mjs'))
  await access(resolve(outputDirectory, 'start-server.mjs'))
}

async function cleanInstallDirectory() {
  await mkdir(installDirectory, { recursive: true })

  const entries = await readdir(installDirectory, { withFileTypes: true })
  await Promise.all(
    entries
      .filter((entry) => !preservedEntries.has(entry.name))
      .map((entry) => rm(resolve(installDirectory, entry.name), { force: true, recursive: true }))
  )
}

async function copyOutput() {
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

try {
  await validateOutput()
  await cleanInstallDirectory()
  await copyOutput()
  console.log(`Deployment completed: ${installDirectory}`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Deployment failed: ${message}`)
  process.exitCode = 1
}
