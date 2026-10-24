import { defineConfig } from 'vitest/config';

// Testes de integração rodam contra um Postgres de verdade (banco leilao_test do
// docker-compose), porque o que mais importa aqui — locks, transações, CHECKs e
// triggers — não existe num mock.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://leilao:leilao@localhost:5433/leilao_test';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      SCRYFALL_BASE_URL: 'http://127.0.0.1:9',
    },
    globalSetup: ['./test/global-setup.ts'],
    // Os arquivos compartilham o mesmo banco: um de cada vez.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
