import { execSync } from 'node:child_process';

/** Aplica as migrations no banco de testes antes de tudo. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://leilao:leilao@localhost:5433/leilao_test';
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: url } });
}
