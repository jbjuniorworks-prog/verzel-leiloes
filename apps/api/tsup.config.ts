import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/seed/run.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // O pacote compartilhado é TypeScript puro dentro do monorepo: entra no bundle.
  noExternal: ['@leilao/shared'],
});
