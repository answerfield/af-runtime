import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['af-source'],
    // @answerfield/practice is optional and missing in the public export; the stub keeps the dynamic import resolvable.
    alias: { '@answerfield/practice': fileURLToPath(new URL('./test/practice-stub.ts', import.meta.url)) }
  },
  test: { include: ['test/**/*.test.ts'], environment: 'happy-dom' }
});
