import clsx from 'clsx';
import type { ReactNode } from 'react';

const COLORS: Record<string, { name: string; className: string }> = {
  W: { name: 'branca', className: 'bg-amber-100 text-amber-950 ring-amber-300' },
  U: { name: 'azul', className: 'bg-sky-600 text-white ring-sky-700' },
  B: { name: 'preta', className: 'bg-stone-900 text-white ring-stone-500' },
  R: { name: 'vermelha', className: 'bg-red-600 text-white ring-red-700' },
  G: { name: 'verde', className: 'bg-emerald-600 text-white ring-emerald-700' },
};
const NEUTRAL = 'bg-stone-300 text-stone-900 ring-stone-400 dark:bg-stone-600 dark:text-white dark:ring-stone-500';

function symbolInfo(code: string): { glyph: string; label: string; className: string } {
  if (code === 'T') return { glyph: '↷', label: 'virar a carta', className: NEUTRAL };
  if (code === 'Q') return { glyph: '↶', label: 'desvirar a carta', className: NEUTRAL };
  if (code === 'C') return { glyph: 'C', label: 'mana incolor', className: NEUTRAL };
  if (/^\d+$/.test(code) || code === 'X') return { glyph: code, label: `${code} de mana genérica`, className: NEUTRAL };
  const color = COLORS[code];
  if (color) return { glyph: code, label: `mana ${color.name}`, className: color.className };
  // Híbridos e afins ({W/U}, {2/W}, {G/P}): primeira cor manda no visual.
  const parts = code.split('/');
  const names = parts.filter((part) => part !== 'P').map((part) => COLORS[part]?.name ?? part);
  const label = `mana ${names.join(' ou ')}${parts.includes('P') ? ' (phyrexiana)' : ''}`;
  return { glyph: code, label, className: COLORS[parts[0]!]?.className ?? NEUTRAL };
}

/**
 * Texto de carta do Magic como o Scryfall entrega: os símbolos vêm entre chaves
 * ({T}, {2}, {U}…). Aqui eles viram selos, como na carta impressa — chaves soltas
 * pareceriam um template que não foi preenchido.
 */
export function CardText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(/\{([^{}]{1,5})\}/g)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const { glyph, label, className } = symbolInfo(match[1]!.toUpperCase());
    parts.push(
      <span
        key={match.index}
        role="img"
        aria-label={label}
        title={label}
        className={clsx(
          'mx-px inline-flex h-[1.45em] min-w-[1.45em] items-center justify-center rounded-full px-[0.3em] align-[-0.3em] text-[0.8em] leading-none font-bold ring-1',
          className,
        )}
      >
        {glyph}
      </span>,
    );
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
