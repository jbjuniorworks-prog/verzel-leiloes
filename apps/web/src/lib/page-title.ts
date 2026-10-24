import { useEffect } from 'react';

const DEFAULT_TITLE = 'Martelo · Casa de Leilões';

/** Título da aba do navegador (e do link compartilhado nos favoritos/histórico). */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} · Martelo`;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
