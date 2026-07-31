import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  },
  test: {
    // Only the Node-side code is unit tested; UI behaviour is covered by the
    // Playwright smoke test against the real app.
    environment: 'node',
    include: ['src/{shared,main}/**/*.test.ts']
  }
})
