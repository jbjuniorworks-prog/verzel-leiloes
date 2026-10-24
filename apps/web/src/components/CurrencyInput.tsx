import clsx from 'clsx';
import { inputClass } from './ui';

const format = (cents: number | null) => (cents === null ? '' : (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/**
 * Campo de dinheiro estilo caixa eletrônico: os dígitos entram pela direita
 * ("1" → 0,01; "1500" → 15,00). O valor trafega sempre em centavos inteiros.
 */
export function CurrencyInput({
  value,
  onChange,
  id,
  className,
  disabled,
  placeholder = '0,00',
  ariaLabel,
  large,
}: {
  value: number | null;
  onChange: (cents: number | null) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  large?: boolean;
}) {
  return (
    <div className={clsx('relative', className)}>
      <span className={clsx('pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-medium text-stone-500', large ? 'text-lg' : 'text-sm')}>R$</span>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        aria-label={ariaLabel}
        disabled={disabled}
        placeholder={placeholder}
        value={format(value)}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '').slice(0, 11);
          onChange(digits ? Number(digits) : null);
        }}
        className={clsx(inputClass, 'pl-10 text-right font-semibold tabular-nums', large && 'h-14 text-2xl')}
      />
    </div>
  );
}
