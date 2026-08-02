process.env.NODE_ENV ||= 'production'
process.env.HOST ||= '0.0.0.0'

await import('../.output/server/index.mjs')
