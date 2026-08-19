import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SAMPLE_RATE = 22_050

function randomSource(seed) {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

function empty(duration) {
  return new Float64Array(Math.ceil(duration * SAMPLE_RATE))
}

function addTone(samples, start, duration, fromHz, amplitude, toHz = fromHz) {
  const first = Math.floor(start * SAMPLE_RATE)
  const count = Math.min(samples.length - first, Math.floor(duration * SAMPLE_RATE))
  let phase = 0
  for (let index = 0; index < count; index += 1) {
    const progress = index / Math.max(1, count - 1)
    const frequency = fromHz + (toHz - fromHz) * progress
    phase += (Math.PI * 2 * frequency) / SAMPLE_RATE
    const envelope = Math.sin(Math.PI * progress) ** 0.35 * (1 - progress * 0.45)
    samples[first + index] += Math.sin(phase) * amplitude * envelope
  }
}

function addThump(samples, start, amplitude, random) {
  const first = Math.floor(start * SAMPLE_RATE)
  const count = Math.min(samples.length - first, Math.floor(0.22 * SAMPLE_RATE))
  let filtered = 0
  for (let index = 0; index < count; index += 1) {
    const time = index / SAMPLE_RATE
    const decay = Math.exp(-time * 22)
    filtered = filtered * 0.78 + (random() * 2 - 1) * 0.22
    const tone = Math.sin(Math.PI * 2 * (82 - time * 190) * time)
    samples[first + index] += (tone * 0.78 + filtered * 0.22) * amplitude * decay
  }
}

function addFilteredNoise(samples, start, duration, amplitude, random, smoothing, envelope) {
  const first = Math.floor(start * SAMPLE_RATE)
  const count = Math.min(samples.length - first, Math.floor(duration * SAMPLE_RATE))
  let filtered = 0
  for (let index = 0; index < count; index += 1) {
    const progress = index / Math.max(1, count - 1)
    filtered = filtered * smoothing + (random() * 2 - 1) * (1 - smoothing)
    samples[first + index] += filtered * amplitude * envelope(progress)
  }
}

function steps() {
  const samples = empty(2.25)
  const random = randomSource(0x7601)
  for (const [index, start] of [0.12, 0.55, 0.98, 1.43, 1.88].entries()) {
    addThump(samples, start, index % 2 ? 0.78 : 0.92, random)
  }
  return samples
}

function openDoor() {
  const samples = empty(2.5)
  const random = randomSource(0x7602)
  addThump(samples, 0.08, 0.48, random)
  addFilteredNoise(samples, 0.22, 1.95, 0.46, random, 0.91, (progress) =>
    Math.sin(Math.PI * progress) * (0.55 + Math.sin(progress * Math.PI * 19) * 0.25)
  )
  addTone(samples, 0.25, 1.9, 92, 0.34, 178)
  addTone(samples, 0.32, 1.75, 205, 0.16, 126)
  addThump(samples, 2.14, 0.34, random)
  return samples
}

function closeDoor() {
  const samples = empty(2.15)
  const random = randomSource(0x7603)
  addFilteredNoise(samples, 0.05, 1.25, 0.34, random, 0.9, (progress) =>
    Math.sin(Math.PI * progress)
  )
  addTone(samples, 0.05, 1.2, 176, 0.28, 92)
  addThump(samples, 1.34, 1.3, random)
  addThump(samples, 1.39, 0.58, random)
  return samples
}

function doorbell() {
  const samples = empty(2.35)
  for (const frequency of [783.99, 987.77, 1_175]) addTone(samples, 0.08, 0.72, frequency, 0.2)
  for (const frequency of [523.25, 659.25, 783.99]) addTone(samples, 0.92, 1.1, frequency, 0.22)
  return samples
}

function doorKnocks() {
  const samples = empty(1.85)
  const random = randomSource(0x7605)
  for (const start of [0.18, 0.68, 1.2]) {
    addThump(samples, start, 1.08, random)
    addTone(samples, start, 0.16, 126, 0.38, 72)
  }
  return samples
}

function rain() {
  const samples = empty(3.4)
  const random = randomSource(0x7606)
  addFilteredNoise(samples, 0, 3.4, 0.66, random, 0.34, (progress) =>
    Math.min(1, progress * 8, (1 - progress) * 8)
  )
  for (let drop = 0; drop < 70; drop += 1) {
    const start = random() * 3.3
    addTone(samples, start, 0.018 + random() * 0.035, 1_100 + random() * 2_600, 0.05 + random() * 0.08)
  }
  return samples
}

function wind() {
  const samples = empty(3.8)
  const random = randomSource(0x7607)
  addFilteredNoise(samples, 0, 3.8, 1.4, random, 0.985, (progress) => {
    const fade = Math.min(1, progress * 5, (1 - progress) * 5)
    return fade * (0.35 + Math.sin(progress * Math.PI * 5) ** 2 * 0.65)
  })
  addTone(samples, 0.4, 2.9, 145, 0.11, 210)
  return samples
}

function thunder() {
  const samples = empty(4.1)
  const random = randomSource(0x7608)
  addFilteredNoise(samples, 0.04, 0.22, 1.5, random, 0.18, (progress) =>
    Math.exp(-progress * 4)
  )
  addFilteredNoise(samples, 0.12, 3.75, 2.4, random, 0.995, (progress) =>
    Math.exp(-progress * 3.2) * (0.55 + Math.sin(progress * Math.PI * 11) ** 2 * 0.45)
  )
  addTone(samples, 0.1, 3.2, 58, 0.48, 31)
  return samples
}

function fire() {
  const samples = empty(3.5)
  const random = randomSource(0x7609)
  addFilteredNoise(samples, 0, 3.5, 0.72, random, 0.93, (progress) =>
    Math.min(1, progress * 7, (1 - progress) * 7) * (0.65 + Math.sin(progress * Math.PI * 17) ** 2 * 0.35)
  )
  for (let pop = 0; pop < 34; pop += 1) {
    addThump(samples, 0.08 + random() * 3.3, 0.12 + random() * 0.32, random)
  }
  return samples
}

function crowd() {
  const samples = empty(4)
  const random = randomSource(0x7610)
  addFilteredNoise(samples, 0, 4, 0.72, random, 0.97, (progress) =>
    Math.min(1, progress * 6, (1 - progress) * 6)
  )
  for (let voice = 0; voice < 18; voice += 1) {
    const start = random() * 0.7
    const duration = 2.7 + random() * 0.9
    const frequency = 95 + random() * 210
    addTone(samples, start, duration, frequency, 0.035 + random() * 0.035, frequency * (0.82 + random() * 0.38))
  }
  return samples
}

const DEFINITIONS = [
  ['pasos.wav', steps],
  ['abrir-puerta.wav', openDoor],
  ['cerrar-puerta.wav', closeDoor],
  ['timbre.wav', doorbell],
  ['golpes-puerta.wav', doorKnocks],
  ['lluvia.wav', rain],
  ['viento.wav', wind],
  ['trueno.wav', thunder],
  ['fuego.wav', fire],
  ['multitud.wav', crowd]
]

function wavBuffer(samples) {
  const bytes = Buffer.alloc(44 + samples.length * 2)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVE', 8, 'ascii')
  bytes.write('fmt ', 12, 'ascii')
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(SAMPLE_RATE, 24)
  bytes.writeUInt32LE(SAMPLE_RATE * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36, 'ascii')
  bytes.writeUInt32LE(samples.length * 2, 40)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
    bytes.writeInt16LE(Math.round(sample * 32_767), 44 + index * 2)
  }
  return bytes
}

export async function generateDefaultSounds(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true })
  const generated = []
  for (const [name, synthesize] of DEFINITIONS) {
    const bytes = wavBuffer(synthesize())
    const path = resolve(outputDirectory, name)
    await writeFile(path, bytes)
    generated.push({ name, path, bytes })
  }
  return generated
}

const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const outputDirectory = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(dirname(scriptPath), '..', 'public', 'sounds', 'default')
  const generated = await generateDefaultSounds(outputDirectory)
  console.log(`Generados ${generated.length} sonidos en ${outputDirectory}`)
}
