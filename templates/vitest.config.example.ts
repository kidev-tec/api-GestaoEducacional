// EXEMPLO — adaptar à versão do Vitest e aos caminhos reais após scaffold.
// Nunca incluir isto no runtime de produção.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      enabled: true,
      include: ['packages/domain/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.d.ts', '**/*.generated.*', '**/generated/**',
        '**/*.stories.*', '**/__fixtures__/**', '**/__mocks__/**',
      ],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        // Core crítico: sempre por arquivo individual, quatro métricas = 100.
        'packages/domain/src/{identity,tenancy,authorization,finance,enrollment,entitlements}/**/*.{ts,tsx}': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
          perFile: true,
        },
      },
    },
  },
});
