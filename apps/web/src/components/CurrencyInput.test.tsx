import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CurrencyInput } from './CurrencyInput';

afterEach(cleanup);

/** Permite mudar o valor "de fora", como faz um lance recebido em tempo real, sem tirar o foco do campo. */
let setFromOutside: (cents: number | null) => void = () => {};

/** Usa o campo como as páginas usam: controlado, guardando o valor em centavos. */
function Harness({ entry, initial = null }: { entry?: 'cents' | 'reais'; initial?: number | null }) {
  const [cents, setCents] = useState<number | null>(initial);
  setFromOutside = setCents;
  return (
    <>
      <CurrencyInput entry={entry} value={cents} onChange={setCents} ariaLabel="Valor" />
      <output data-testid="cents">{String(cents)}</output>
      <button type="button" onClick={() => setCents(46_000)}>
        Mínimo
      </button>
    </>
  );
}

const field = () => screen.getByLabelText<HTMLInputElement>('Valor');
const cents = () => screen.getByTestId('cents').textContent;

describe('CurrencyInput no modo reais (campo de lance)', () => {
  it('"13" vale R$ 13,00 e é formatado ao sair do campo', async () => {
    render(<Harness entry="reais" />);
    await userEvent.type(field(), '13');
    expect(cents()).toBe('1300');
    await userEvent.tab();
    expect(field().value).toBe('13,00');
  });

  it('"13,5" vale R$ 13,50', async () => {
    render(<Harness entry="reais" />);
    await userEvent.type(field(), '13,5');
    expect(cents()).toBe('1350');
  });

  it('aceita colar "1.234,56"', async () => {
    render(<Harness entry="reais" />);
    await userEvent.click(field());
    await userEvent.paste('1.234,56');
    expect(cents()).toBe('123456');
  });

  it('substituir o valor sugerido por "500" vale R$ 500,00', async () => {
    render(<Harness entry="reais" initial={42_000} />);
    expect(field().value).toBe('420,00');
    await userEvent.clear(field());
    await userEvent.type(field(), '500');
    expect(cents()).toBe('50000');
  });

  it('valor vindo de fora (botão "Mínimo") aparece formatado mesmo durante a digitação', async () => {
    render(<Harness entry="reais" />);
    await userEvent.type(field(), '13');
    await userEvent.click(screen.getByRole('button', { name: 'Mínimo' }));
    expect(field().value).toBe('460,00');
    expect(cents()).toBe('46000');
  });

  it('valor vindo de fora com o campo ainda em foco (lance recebido em tempo real) substitui o texto', async () => {
    render(<Harness entry="reais" />);
    await userEvent.type(field(), '570');
    act(() => setFromOutside(60_000));
    expect(document.activeElement).toBe(field());
    expect(field().value).toBe('600,00');
    expect(cents()).toBe('60000');
  });

  it('apagar todo o campo deixa sem valor, e ele continua vazio ao sair', async () => {
    render(<Harness entry="reais" initial={42_000} />);
    await userEvent.clear(field());
    expect(cents()).toBe('null');
    expect(field().value).toBe('');
    await userEvent.tab();
    expect(field().value).toBe('');
    expect(cents()).toBe('null');
  });

  it('aceita ponto como decimal ("13.5"), para teclados de celular que não mostram vírgula', async () => {
    render(<Harness entry="reais" />);
    await userEvent.type(field(), '13.5');
    expect(cents()).toBe('1350');
  });

  it('usa o teclado decimal no celular', () => {
    render(<Harness entry="reais" />);
    expect(field().inputMode).toBe('decimal');
  });
});

describe('CurrencyInput no modo padrão (depósito e novo lote) continua igual', () => {
  it('os dígitos entram pela direita: "13" vale R$ 0,13', async () => {
    render(<Harness />);
    await userEvent.type(field(), '13');
    expect(cents()).toBe('13');
    expect(field().value).toBe('0,13');
    expect(field().inputMode).toBe('numeric');
  });
});
