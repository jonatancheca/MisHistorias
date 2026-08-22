import { requireSessionUser } from '../../../utils/nsfwAuth.ts'
import { getUsageSummary } from '../../../utils/nsfwProduct.ts'

export default defineEventHandler((event) => {
  const user = requireSessionUser(event)
  const usage = getUsageSummary(user.id)
  const byProfile = {
    quick: usage.filter((row) => row.generationProfile === 'quick'),
    quality: usage.filter((row) => row.generationProfile === 'quality')
  }

  function percentile(values: number[], p: number) {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
    return sorted[index]!
  }

  function stats(rows: typeof usage) {
    const latencies = rows.map((row) => row.latencyMs).filter((value) => value > 0)
    return {
      count: rows.length,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      maxMs: latencies.length ? Math.max(...latencies) : null
    }
  }

  return {
    measuredAt: Date.now(),
    targets: {
      quickP50Ms: 20000,
      qualityP50Ms: 50000,
      firstTextP50Ms: 3000,
      timeoutMs: 120000
    },
    quick: stats(byProfile.quick),
    quality: stats(byProfile.quality),
    recent: usage.slice(0, 20)
  }
})
