# Martelo: regras deste projeto

Complementam as regras gerais de trabalho. Aqui fica só o que é específico deste repositório.

## Fluxo

- Branch a partir da `main` atualizada, **um item por PR**. O usuário revisa e faz o merge (merge commit).
- A versão avaliada pela Verzel está na tag `entrega-teste` (`12e0b37`). Nunca mova nem apague essa tag.
- **A produção não está ligada ao GitHub.** O serviço `app` do projeto `verzel-leiloes` no Railway só muda com deploy manual pelo CLI, e só com pedido explícito. Merge na `main` não altera o site.

## Comandos

- `npm run db:up` sobe o Postgres local (porta 5433, com o banco `leilao_test` para os testes).
- Os mesmos passos do CI: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` e `npm run build`.
- `npm run dev` sobe a API (3333) e o front (5173).

## Dinheiro e concorrência

- Valores em centavos inteiros (`BigInt` no banco), nunca `float`.
- Toda operação que move saldo roda numa transação: trava o lote antes das carteiras, trava as carteiras em ordem de id (`lockWallets`) e só anuncia em tempo real depois do commit.

## Auditoria

- Mudou uma coluna de `lots` ou um evento da cadeia? No mesmo PR, atualize:
  - `checkConsistency` em `apps/api/src/modules/audit/audit.service.ts`;
  - um teste de adulteração em `apps/api/test/audit.test.ts`;
  - a tabela "Cobertura campo a campo" do README (seção 6).
- O navegador verifica só a cadeia. As checagens de consistência rodam só no servidor, e a chave pública vem da própria API. Não escreva o contrário.

## README

- As contagens de testes aparecem nas seções 1 e 11. Atualize-as quando a quantidade mudar.
