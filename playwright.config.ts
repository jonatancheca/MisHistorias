import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const port = 3100
const baseURL = `http://localhost:${port}`
const databasePath = resolve(
  '.data',
  `playwright-${Date.now()}-${process.pid}.sqlite`
)

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['line'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command: 'pnpm dev',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NUXT_IGNORE_LOCK: '1',
      NUXT_PORT: String(port),
      NUXT_SQLITE_PATH: databasePath,
      PLAYWRIGHT_TEST: '1'
    }
  }
})
