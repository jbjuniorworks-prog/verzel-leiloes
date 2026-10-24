/** BigInt do banco → number da API. Centavos cabem com folga em Number.MAX_SAFE_INTEGER. */
export function centsToNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`Valor fora do intervalo seguro: ${value}`);
  return result;
}

export const nullableCents = (value: bigint | null) => (value === null ? null : centsToNumber(value));

/** Limite por operação (R$ 10 milhões) — evita valores absurdos digitados por engano. */
export const MAX_AMOUNT_CENTS = 1_000_000_000;
