import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Unit tests for pure functions only (no jsdom, no Firebase). The `@/` alias
// mirrors tsconfig ("@/*" -> "./*") so modules-under-test resolve their own
// `@/…` imports. Include is scoped to lib/ so route/component files are ignored.
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
})
