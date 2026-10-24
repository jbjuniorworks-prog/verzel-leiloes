/**
 * Gera src/seed/fixtures.json com os itens dos lotes de demonstração, já
 * normalizados. Assim o seed não depende da API externa para os dados (só tenta
 * baixar as imagens, com fallback). Uso: npx tsx --env-file=.env src/scripts/build-seed-fixtures.ts
 */
import { writeFileSync } from 'node:fs';
import { normalizeCard } from '../modules/catalog/scryfall';

const CARDS: Array<[name: string, set: string]> = [
  ['Black Lotus', '2ed'],
  ['Jace, the Mind Sculptor', 'wwk'],
  ['Lightning Bolt', 'leb'],
  ['Sol Ring', 'leb'],
  ['Time Walk', '2ed'],
  ['Ancestral Recall', '2ed'],
  ['Shivan Dragon', 'leb'],
  ['Tarmogoyf', 'fut'],
  ['Serra Angel', 'leb'],
  ['Mox Sapphire', '2ed'],
];

const items = [];
for (const [name, set] of CARDS) {
  const url = `https://api.scryfall.com/cards/named?${new URLSearchParams({ exact: name, set })}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'MarteloLeiloes/1.0', Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${name} (${set}): HTTP ${response.status}`);
  items.push(normalizeCard(await response.json()));
  await new Promise((resolve) => setTimeout(resolve, 120));
}
writeFileSync(new URL('../seed/fixtures.json', import.meta.url), `${JSON.stringify(items, null, 2)}\n`);
console.log(`${items.length} itens gravados em src/seed/fixtures.json`);
