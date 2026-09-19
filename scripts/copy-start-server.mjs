import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDirectory = fileURLToPath(new URL('../', import.meta.url))
const outputDirectory = resolve(projectDirectory, '.output')

await mkdir(outputDirectory, { recursive: true })
await copyFile(
  resolve(projectDirectory, 'scripts/start-server.mjs'),
  resolve(outputDirectory, 'start-server.mjs')
)
await copyFile(
  resolve(projectDirectory, 'scripts/access-config.mjs'),
  resolve(outputDirectory, 'access-config.mjs')
)

console.log('Copied .output/start-server.mjs and .output/access-config.mjs')
