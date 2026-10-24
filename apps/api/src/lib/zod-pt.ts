import { z, ZodIssueCode, type ZodErrorMap } from 'zod';

/** Nome amigável dos campos validados, para a mensagem dizer qual campo está errado. */
const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  email: 'E-mail',
  password: 'Senha',
  role: 'Perfil',
  title: 'Título',
  description: 'Descrição',
  reason: 'Motivo',
  q: 'Busca',
  category: 'Raridade',
  status: 'Situação',
  sort: 'Ordenação',
  page: 'Página',
  minPrice: 'Preço mínimo',
  maxPrice: 'Preço máximo',
};

/**
 * Mensagens padrão do Zod em português. Só entra em ação onde o schema não
 * definiu mensagem própria (ex.: `.max(80)` sem texto) — o resto continua igual.
 */
const ptBRErrorMap: ZodErrorMap = (issue, ctx) => {
  const label = FIELD_LABELS[String(issue.path.at(-1))];
  const prefix = label ? `${label}: ` : '';
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') return { message: `${prefix}campo obrigatório.` };
      if (issue.expected === 'integer') return { message: `${prefix}use um número inteiro.` };
      if (issue.expected === 'number') return { message: `${prefix}informe um número.` };
      return { message: `${prefix}formato inválido.` };
    case ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: `${prefix}use pelo menos ${issue.minimum} caractere(s).` };
      if (issue.type === 'number') return { message: `${prefix}o mínimo é ${issue.minimum}.` };
      break;
    case ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `${prefix}use no máximo ${issue.maximum} caracteres.` };
      if (issue.type === 'number') return { message: `${prefix}o máximo é ${issue.maximum}.` };
      break;
    case ZodIssueCode.invalid_enum_value:
      return { message: `${prefix}valor inválido. Opções: ${issue.options.join(', ')}.` };
    case ZodIssueCode.invalid_string:
      return { message: `${prefix}formato inválido.` };
    case ZodIssueCode.invalid_date:
      return { message: `${prefix}data inválida.` };
  }
  return { message: `${prefix}${ctx.defaultError}` };
};

z.setErrorMap(ptBRErrorMap);
