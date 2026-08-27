import type { ImageGenerationMetadata } from '../types/index.ts'

export function readImageGeneration(value: unknown): ImageGenerationMetadata | undefined {
  if (value === undefined || value === null) return undefined
  const metadata = value as ImageGenerationMetadata
  if (typeof value !== 'object' || Array.isArray(value) ||
    !Number.isSafeInteger(metadata.seed) || metadata.seed < 0 ||
    (metadata.variationSeed !== undefined &&
      (!Number.isInteger(metadata.variationSeed) || metadata.variationSeed < 0 || metadata.variationSeed > 0xffffffff)) ||
    (metadata.variationSeed === undefined ? metadata.variationSeedStrength !== undefined :
      typeof metadata.variationSeedStrength !== 'number' || !Number.isFinite(metadata.variationSeedStrength) ||
      metadata.variationSeedStrength <= 0 || metadata.variationSeedStrength > 1)) {
    throw new Error('Metadatos de generación no válidos')
  }
  return {
    seed: metadata.seed,
    ...(metadata.variationSeed !== undefined ? {
      variationSeed: metadata.variationSeed,
      variationSeedStrength: metadata.variationSeedStrength
    } : {})
  }
}
