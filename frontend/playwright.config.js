import { defineConfig } from '@playwright/test'

process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',')
process.env.no_proxy = [process.env.no_proxy, '127.0.0.1', 'localhost'].filter(Boolean).join(',')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:18574',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'python3 ../tools/serve-browser-tests.py --port 18574',
    url: 'http://127.0.0.1:18574/api/games',
    reuseExistingServer: false,
    timeout: 30000,
  },
})
