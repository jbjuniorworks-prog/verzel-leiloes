import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParticipationDTO, ParticipationOutcome } from '@leilao/shared';
import { api } from '../lib/api';
import { MyBidsPage } from './MyBidsPage';

vi.mock('../lib/api', () => ({ api: vi.fn() }));

afterEach(cleanup);

function participation(number: number, outcome: ParticipationOutcome): ParticipationDTO {
  const ended = outcome === 'WON' || outcome === 'LOST';
  return {
    lot: {
      id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
      number,
      title: `Carta do lote ${number}`,
      subtitle: null,
      category: null,
      imageUrl: null,
      status: ended ? 'ENDED' : outcome === 'CANCELLED' ? 'CANCELLED' : 'LIVE',
      startsAt: '2026-11-01T12:00:00.000Z',
      endsAt: ended ? '2026-11-02T12:00:00.000Z' : '2099-01-01T12:00:00.000Z',
      startingPriceCents: 1_000,
      minIncrementCents: 100,
      currentPriceCents: 1_000,
      bidCount: 1,
      sellerName: 'Casa Martelo',
      result: outcome === 'WON' || outcome === 'LOST' ? 'SOLD' : null,
    },
    pseudonym: 'L-00000000',
    myHighestBidCents: 1_000,
    myBidCount: 1,
    lastBidAt: '2026-11-01T13:00:00.000Z',
    outcome,
    receiptCode: outcome === 'WON' ? 'codigoDoComprovante' : null,
  };
}

async function renderPage(data: ParticipationDTO[]) {
  vi.mocked(api).mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MyBidsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('tablist');
  return client;
}

const selectedTab = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent;

describe('Meus arremates: aba inicial', () => {
  it('quem só tem arremate abre em "Arrematados", com o lote visível', async () => {
    await renderPage([participation(11, 'WON')]);
    expect(selectedTab()).toMatch(/^Arrematados/);
    expect(screen.getByText('Carta do lote 11')).toBeTruthy();
    expect(screen.queryByText('Nada por aqui ainda')).toBeNull();
  });

  it('com lances em andamento e arremates, continua abrindo em "Em andamento"', async () => {
    await renderPage([participation(11, 'WON'), participation(12, 'LEADING')]);
    expect(selectedTab()).toMatch(/^Em andamento/);
    expect(screen.getByText('Carta do lote 12')).toBeTruthy();
  });

  it('sem nenhuma participação, abre em "Em andamento" com "Nada por aqui ainda"', async () => {
    await renderPage([]);
    expect(selectedTab()).toMatch(/^Em andamento/);
    expect(screen.getByText('Nada por aqui ainda')).toBeTruthy();
  });

  it('a aba escolhida pela pessoa não muda quando os dados atualizam', async () => {
    const client = await renderPage([participation(11, 'WON'), participation(12, 'LEADING')]);
    await userEvent.click(screen.getByRole('tab', { name: /^Encerrados/ }));
    act(() => client.setQueryData(['participations'], [participation(11, 'WON'), participation(12, 'OUTBID'), participation(13, 'LEADING')]));
    // Espera os dados novos chegarem à tela (a contagem muda) antes de conferir a aba.
    await screen.findByRole('tab', { name: 'Em andamento 2' });
    expect(selectedTab()).toMatch(/^Encerrados/);
  });

  it('a escolha automática vale só para a abertura: dados novos não trocam a aba', async () => {
    const client = await renderPage([participation(11, 'WON')]);
    expect(selectedTab()).toMatch(/^Arrematados/);
    act(() => client.setQueryData(['participations'], [participation(11, 'WON'), participation(12, 'LEADING')]));
    await screen.findByRole('tab', { name: 'Em andamento 1' });
    expect(selectedTab()).toMatch(/^Arrematados/);
  });
});
