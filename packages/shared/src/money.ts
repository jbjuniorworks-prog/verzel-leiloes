// Todo valor monetário trafega em centavos inteiros (nunca float) para evitar
// erros de arredondamento. A formatação para R$ acontece só na borda (UI/mensagens).

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBRL(cents: number): string {
  return brl.format(cents / 100);
}

/**
 * Converte o que o usuário digitou ("1.234,56", "1234.5", "R$ 10") em centavos.
 * Retorna null se não for um valor positivo válido.
 */
export function parseBRLToCents(input: string): number | null {
  const cleaned = input.replace(/[R$\s]/g, '');
  if (!cleaned) return null;

  let normalized = cleaned;
  if (cleaned.includes(',')) {
    // Formato brasileiro: ponto é milhar, vírgula é decimal.
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    // "1.234" ou "1.234.567": pontos como separador de milhar.
    normalized = cleaned.replace(/\./g, '');
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
