// EXEMPLO — requer que o OpenAPI real esteja em packages/api-contract/openapi.yaml.
// Orval moderno aceita cliente react-query, transport fetch e mocks MSW.
import { defineConfig } from 'orval';

export default defineConfig({
  erpApi: {
    input: { target: './packages/api-contract/openapi.yaml' },
    output: {
      mode: 'tags-split',
      target: './apps/web/src/api/generated',
      schemas: './apps/web/src/api/models',
      client: 'react-query',
      httpClient: 'fetch',
      mock: true,
    },
  },
});
