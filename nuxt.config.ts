// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: process.env.PLAYWRIGHT_TEST !== '1' },
  $env: {
    production: {
      devtools: { enabled: false }
    },
    dev2: {
      devtools: { enabled: false }
    }
  },
  nitro: {
    rollupConfig: { external: ['node:sqlite'] }
  },
  ssr: false,
  modules: ['@pinia/nuxt', '@nuxt/eslint'],
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    public: {
      appVersion: process.env.NUXT_PUBLIC_APP_VERSION || 'dev',
      appCommit: process.env.NUXT_PUBLIC_APP_COMMIT || ''
    }
  },
  vite: {
    plugins: [tailwindcss()]
  },
  app: {
    head: {
      title: 'Mis Historias',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }]
    }
  }
})
