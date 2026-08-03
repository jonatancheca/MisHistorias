import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

process.env.NODE_ENV ||= 'production'
process.env.HOST ||= '0.0.0.0'
process.env.PORT ||= '3010'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const serverEntry = resolve(scriptDirectory, 'server/index.mjs')

await import(pathToFileURL(serverEntry).href)
