# Uso de IA neste projeto

Este projeto foi desenvolvido com uso intenso de IA. Este documento registra o que a IA fez, o que eu fiz, o que esse processo deixou passar e como passei a trabalhar depois do feedback da avaliação.

## Ferramentas

- **Claude Code** (Anthropic, modelo Claude Opus 5.5): escreveu o código, os testes e a documentação, rodou os testes e fez os deploys pelo terminal, sempre com a minha autorização. Os commits que ele escreveu levam a linha `Co-Authored-By: Claude Opus 5.5`.
- **ChatGPT** (OpenAI), **como revisor** (a partir do feedback): revisava o escopo proposto e o diff de cada PR antes da minha aprovação.

## A entrega original (24/10/2026)

Os 11 commits da entrega ficam entre 01h07 e 15h19 do mesmo dia. O primeiro traz o projeto inteiro: 113 arquivos e cerca de 16 mil linhas. Essa versão está preservada na tag [`entrega-teste`](https://github.com/jbjuniorworks-prog/verzel-leiloes/tree/entrega-teste).

**O que a IA fez:** a maior parte do código de front-end, back-end e testes, além do README, do Docker e da configuração de deploy. Também executou os testes automatizados, a navegação automatizada e os deploys.

**O que eu fiz:**
- decidi a hospedagem, a publicação e as prioridades de revisão;
- escolhi entre as alternativas propostas para a auditoria;
- aprovei as alterações;
- testei o site publicado manualmente e encontrei dois problemas, corrigidos com a IA:
  - o cabeçalho não reconhecia o login feito logo depois de abrir a página ([`7833bd3`](https://github.com/jbjuniorworks-prog/verzel-leiloes/commit/7833bd3));
  - o texto oficial das cartas aparecia com os símbolos entre chaves (`{T}`), parecendo um template quebrado ([`12e0b37`](https://github.com/jbjuniorworks-prog/verzel-leiloes/commit/12e0b37)).

Antes do envio, a IA rodou um roteiro de 32 verificações contra o site publicado, pela API e pelo WebSocket: lances, recusas, anti-sniping, liquidação, cancelamento com estorno, auditoria e comprovante. Todas passaram. Esse roteiro não verificava a interface.

## O que esse processo deixou passar

A avaliação encontrou problemas que nem os testes nem a minha revisão pegaram:

- **Processo:** o projeto inteiro num commit só, sem CI e sem ESLint. A minha revisão não ficava visível.
- **Documentação:** o README afirmava mais do que o código fazia. Por exemplo, dizia que o navegador verificava tudo "sem confiar no servidor", mas a chave pública vem da mesma API. O texto gerado foi aceito sem ser conferido frase a frase.
- **Auditoria:** trocar `seller_id` ou `final_price_cents` direto no banco passava como "íntegro".
- **Interface:** bugs que só aparecem usando a tela, como a máscara de moeda que transforma "13" em R$ 0,13.

## Como passei a trabalhar

Depois do feedback, cada correção segue o mesmo fluxo:

1. A IA faz um levantamento curto e propõe o escopo de **um item só**.
2. O revisor confere o escopo, e eu aprovo.
3. A IA faz o commit e abre um PR. O PR mostra o diff, o que foi testado e como (localmente, no CI e, quando há mudança de interface, no navegador).
4. Numa correção de bug, o teste novo precisa **falhar sem a correção** e passar com ela.
5. O revisor confere o diff, e **eu faço o merge**.

| PR | O que corrigiu |
| --- | --- |
| [#1](https://github.com/jbjuniorworks-prog/verzel-leiloes/pull/1) | CI no GitHub Actions (formatação, ESLint, typecheck, testes com Postgres e build), com exceções de lint restritas aos arquivos que precisam |
| [#2](https://github.com/jbjuniorworks-prog/verzel-leiloes/pull/2) | Dependências dos `useEffect`; `exhaustive-deps` passou a ser erro |
| [#3](https://github.com/jbjuniorworks-prog/verzel-leiloes/pull/3) | Auditoria passou a conferir `seller_id` e `final_price_cents`, com três testes de regressão |
| [#4](https://github.com/jbjuniorworks-prog/verzel-leiloes/pull/4) e [#5](https://github.com/jbjuniorworks-prog/verzel-leiloes/pull/5) | README: tabela de cobertura da auditoria, campo a campo, e correção das frases que afirmavam demais |
| [#6](https://github.com/jbjuniorworks-prog/verzel-leiloes/pull/6) | Regras de trabalho do projeto (`CLAUDE.md`) e modelo de PR com checklist |
| [#7](https://github.com/jbjuniorworks-prog/verzel-leiloes/pull/7) | README: onde a verificação de papel acontece de fato |

Cada erro encontrado virou uma regra escrita, com o motivo, para não se repetir. As regras deste projeto estão no [`CLAUDE.md`](../CLAUDE.md), e o checklist no [modelo de PR](../.github/pull_request_template.md).

Os demais pontos do feedback (cadastro de leiloeiro aberto, sessão sem revogação, bugs de interface, divisão de arquivos grandes) seguem pendentes e vão entrar da mesma forma, um por PR.
