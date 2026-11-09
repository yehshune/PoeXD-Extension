import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup/browser-locale.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'utils/official-category-resolver.ts',
        'components/sidebar/mapping-registry.ts',
        'components/sidebar/utils.ts',
        'utils/storage-contracts.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
});
