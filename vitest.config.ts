import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/db/**/*.test.ts'],
    environment: 'node',
    // Test DB khởi động Postgres (PGlite) — cần nhiều thời gian hơn mặc định.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // `npm run test:coverage` — tầng domain phải đạt ≥ 95% (docs/08 §1).
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts'],
      exclude: ['src/domain/**/*.test.ts', 'src/domain/types.ts', 'src/domain/index.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: { statements: 95, lines: 95, functions: 95, branches: 85 },
    },
  },
})
