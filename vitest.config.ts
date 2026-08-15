import { defineConfig } from 'vitest/config'

// Two projects so the slow boot-the-real-app suite can be run or skipped on its own.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          // tests/renderer are still plain units (no DOM); they live apart only
          // because the web tsconfig is what knows how to read renderer code.
          include: ['tests/unit/**/*.test.ts', 'tests/renderer/**/*.test.ts']
        }
      },
      {
        test: {
          name: 'smoke',
          environment: 'node',
          include: ['tests/smoke/**/*.test.ts'],
          testTimeout: 60_000,
          fileParallelism: false
        }
      }
    ]
  }
})
