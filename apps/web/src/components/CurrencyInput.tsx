import { parseBRLToCents } from '@leilao/shared';
import clsx from 'clsx';
import { useState } from 'react';
import { inputClass } from './ui';

const format = (cents: number | null) => (cents === null ? '' : (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Texto em edição → centavos. Vírgula ou ponto no fim ainda contam como inteiro ("13," = R$ 13,00). */
const parseDraft = (draft: string) => parseBRLToCents(draft.replace(/[.,]$/, ''));

/** Só dígitos, pontos e uma vírgula, com no máximo dois dígitos depois dela. */
function sanitizeDraft(text: string) {
  const [integer = '', ...rest] = text.replace(/[^\d.,]/g, '').split(',');
  return rest.length === 0 ? integer.slice(0, 13) : `${integer.slice(0, 13)},${rest.join('').slice(0, 2)}`;
}

type Props = {
  value: number | null;
  onChange: (cents: number | null) => void;
  /**
   * 'cents' (padrão): campo estilo caixa eletrônico, os dígitos entram pela direita
   * ("1" → 0,01; "1500" → 15,00).
   * 'reais': digita-se em reais, com centavos depois da vírgula ("13" → 13,00; "13,5" → 13,50).
   */
  entry?: 'cents' | 'reais';
  id?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  large?: boolean;
};

/** Campo de dinheiro. O valor trafega sempre em centavos inteiros. */
export function CurrencyInput({ value, onChange, entry = 'cents', id, className, disabled, placeholder = '0,00', ariaLabel, large }: Props) {
  // Enquanto a pessoa digita no modo reais, o campo mostra o texto dela; fora disso, o valor formatado.
  const [draft, setDraft] = useState<string | null>(null);
  // Valor que veio de fora (botão "Mínimo", lance coberto) substitui o texto em edição.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (draft !== null && parseDraft(draft) !== value) setDraft(null);
  }

  const reais = entry === 'reais';
  return (
    <div className={clsx('relative', className)}>
      <span className={clsx('pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-medium text-stone-500', large ? 'text-lg' : 'text-sm')}>R$</span>
      <input
        id={id}
        inputMode={reais ? 'decimal' : 'numeric'}
        autoComplete="off"
        aria-label={ariaLabel}
        disabled={disabled}
        placeholder={placeholder}
        value={draft ?? format(value)}
        onChange={(event) => {
          if (reais) {
            const next = sanitizeDraft(event.target.value);
            setDraft(next);
            onChange(parseDraft(next));
            return;
          }
          const digits = event.target.value.replace(/\D/g, '').slice(0, 11);
          onChange(digits ? Number(digits) : null);
        }}
        onBlur={() => setDraft(null)}
        className={clsx(inputClass, 'pl-10 text-right font-semibold tabular-nums', large && 'h-14 text-2xl')}
      />
    </div>
  );
}
