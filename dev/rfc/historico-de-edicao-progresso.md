# Progresso da implementação do monitor

Branch exclusiva `input-monitor`. Escopo aprovado no RFC `historico-de-edicao-de-respostas-abertas.md`. Implementação parcial, sem integração na aplicação ainda.

## Método

TDD full com workers separados para testes e implementação. A ferramenta não mantém agentes persistentes nem permite escolher modelo por chamada; cada chamada recebe um briefing resumido. Implementer não lê os testes. O coordenador executa RED e GREEN pelo harness existente. Lotes de até três critérios.

Dependências instaladas no próprio worktree com `pnpm install --frozen-lockfile`, sem alterar dependências de outras árvores. Nenhuma migration ou modificação externa em MDQ.

## Contrato concreto inicial

Módulo `src/services/answer-edits/codec.ts`. `encodeEdits`, `decodeEdits`, `replayEdits` e `applyReplacements` são seams públicas puras. Objetos nomeados usam `startMs` absoluto no relógio da sessão. Envelope do codec contém `version: 1`, `timeOriginMs` e tuplas. A primeira tupla é relativa a `timeOriginMs`; as demais, ao início da anterior. O envelope de transporte do monitor acrescentará sessão, identificadores e revisão.

Tempos e acumuladores são números IEEE-754 finitos não negativos, sem arredondamento adicional. Posições e contagens são inteiros seguros não negativos. Nenhuma normalização de texto. Erros de contrato lançam exceções, sem mutação dos argumentos. Esse refinamento não estabelece limites de volume do servidor, que permanecem pendentes.

## Ciclo 1: codec e replay

Lote 1, três critérios:

1. Roundtrip de objetos/tuplas com códigos 0 a 6, timing null ou Welford, origem independente por envelope e validação de versão/tempos/timing.
2. Replay UTF-16 exato, incluindo vazio, emoji, combinantes, RTL, quebras, substituição/exclusão total e operações sem efeito.
3. Transações em coordenadas anteriores, ordenadas sem sobreposição, com rejeição de posições inválidas e sem mutação parcial.

Comando RED e GREEN: `pnpm exec tsx test/run.ts test/answer-edit-codec.spec.ts`.

RED real: 54 falhas funcionais com `Error: Not implemented`, 156 testes de rejeição passando contra o stub. GREEN: 210 testes passaram em 9,9 s. Propriedades com seed fixa, 200 execuções no replay. Antes do RED houve uma falha de setup por código gerado ausente; ela não conta como RED. Preparação corrigida com `pnpm run generate`, `pnpm run db:generate` e `pnpm exec astro sync`. Logs da sessão em `/tmp/input-monitor-codec-{red,green}.log`.

Transações com posições repetidas são recusadas para eliminar ordem ambígua; intervalos adjacentes com posições distintas são aceitos. O implementer recebeu somente critérios e stubs, sem acesso aos testes.

## Pendências

Monitor, coleta/ACK/checkpoint, persistência/coordenador, adaptadores, servidor, entrega e integração real ainda não implementados. Todos os corner cases dessas fatias permanecem pendentes. Rich text e seam externa MDQ precisam das decisões já descritas no RFC. Não há interface nova nem estados novos para seed nesta fatia puramente funcional.
