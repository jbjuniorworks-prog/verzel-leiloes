import { z } from 'zod';

// Valores usados só fora de produção, para o projeto subir sem configuração.
// Em produção, a ausência de qualquer segredo derruba a aplicação na largada.
const DEV_DEFAULTS = {
  JWT_SECRET: 'dev-jwt-secret-troque-em-producao-0123456789abcdef',
  AUDIT_PRIVATE_KEY: 'ZGV2LW9ubHktYXVkaXQta2V5LW5vdC1mb3ItcHJvZCE=',
  PSEUDONYM_SECRET: 'dev-pseudonym-secret-troque-em-producao',
};

const booleanish = z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  AUDIT_PRIVATE_KEY: z.string().refine((value) => Buffer.from(value, 'base64').length === 32, 'AUDIT_PRIVATE_KEY deve ser 32 bytes em base64'),
  PSEUDONYM_SECRET: z.string().min(16, 'PSEUDONYM_SECRET precisa de pelo menos 16 caracteres'),
  COOKIE_SECURE: booleanish.optional(),
  SEED_ON_BOOT: booleanish.default('false'),
  ALLOW_DEMO_SECRETS: booleanish.default('false'),
  SCRYFALL_BASE_URL: z.string().url().default('https://api.scryfall.com'),
  WEB_DIST_DIR: z.string().optional(),
  SETTLEMENT_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
});

function loadEnv() {
  const raw = { ...process.env };
  if (raw.NODE_ENV !== 'production') {
    for (const [key, value] of Object.entries(DEV_DEFAULTS)) raw[key] ??= value;
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${problems}`);
  }

  // Os segredos de demonstração estão no repositório: em produção eles permitiriam
  // forjar sessões e assinaturas da auditoria. Só o docker-compose local libera.
  const demoSecrets = Object.entries(DEV_DEFAULTS)
    .filter(([key, value]) => parsed.data[key as keyof typeof DEV_DEFAULTS] === value)
    .map(([key]) => key);
  if (parsed.data.NODE_ENV === 'production' && demoSecrets.length > 0 && !parsed.data.ALLOW_DEMO_SECRETS) {
    throw new Error(
      `${demoSecrets.join(', ')} estão com os valores públicos de demonstração. Gere segredos novos com "npm run keys:generate" ` +
        '(ou defina ALLOW_DEMO_SECRETS=true apenas para rodar localmente).',
    );
  }

  return {
    ...parsed.data,
    COOKIE_SECURE: parsed.data.COOKIE_SECURE ?? parsed.data.NODE_ENV === 'production',
  };
}

export const env = loadEnv();
export type Env = typeof env;
