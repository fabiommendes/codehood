---
type: adr
status: accepted
tags: [services, api, rest, sync, concorrencia]
relatedTo: [0011-contrato-de-sync-entre-cli-e-servidor, sync-bidirecional]
created: 2026-11-12
decided: 2026-11-12
creator: claude
---

# Escrita condicional nos services

Toda escrita de um service aceita uma versão esperada da linha e recusa a
operação quando a linha mudou desde que o chamador a leu. A regra vale para
todos os services cujo modelo tem `updatedAt`, não só para os que o sync usa.

## Contexto

A ADR 0011 descartou `If-Match` e ficou com last-write-wins, porque só a CLI
escrevia conteúdo. Com o sync bidirecional (`dev/rfc/sync-bidirecional.md`) a
web também passa a escrever, e a CLI promete não sobrescrever o que foi feito
no servidor. Entre o GET do preflight e o PUT podem passar minutos num curso
com muitos arquivos; uma edição feita na web nesse intervalo seria sobrescrita
sem aviso. O mesmo vale para duas abas da web gravando a mesma entidade.

## Decisão

- `ServiceOpts` ganha `expectedUpdatedAt?: Date | null`, aceito por `update`,
  `upsert` e `delete`:
  - `Date`: a linha precisa existir com exatamente esse `updatedAt`;
  - `null`: a linha não pode existir (só faz sentido em `upsert`);
  - ausente: escrita incondicional, como hoje.
- A checagem roda na mesma transação que a escrita. Quando falha, o service
  lança `PreconditionFailed`, um erro serializável novo em `src/core/error.ts`,
  que carrega o `updatedAt` atual da linha (ou `null` se ela não existe).
- A versão é o `updatedAt` da linha endereçada pela chave natural. Não há
  coluna de versão nem hash calculado pelo servidor.
- Toda escrita que muda o que o read model devolve precisa mudar o `updatedAt`
  dessa linha, inclusive quando só toca em filhos (tags e questões de exame,
  nova versão de questão, repositórios de evento) ou quando uma chave
  estrangeira é anulada por cascata.
- A regra vale para todo service cujo modelo tem `updatedAt`. `Discipline`
  ganha a coluna. `Edition` fica sem ela e sem escrita condicional: só o
  administrador a edita.
- No REST, `CRUD()` traduz o cabeçalho `If-Match` para `expectedUpdatedAt` em
  `PUT`, `PATCH` e `DELETE`, e `If-None-Match: *` para `null` em `PUT`. O ETag
  é o `updatedAt` em ISO 8601 com milissegundos, entre aspas, e o cliente pode
  montá-lo a partir do campo `updatedAt` de qualquer read model, inclusive de
  uma listagem. A falha responde `412 Precondition Failed`.
- As Astro Actions que editam uma entidade enviam o `updatedAt` que a página
  carregou.
- O cabeçalho é opcional. Um cliente que não o envia continua com
  last-write-wins.

## Consequências

- Uma escrita derivada (recalcular eventos ao mudar o início do curso) muda o
  `updatedAt` e faz uma escrita condicional legítima falhar. O chamador relê e
  tenta de novo; nunca há sobrescrita silenciosa.
- `rev` continua opaco e gravado pelo cliente. Ele diz quem escreveu por
  último (CLI ou não); `updatedAt` diz se alguém escreveu.
- `If-Unmodified-Since` não serve: datas HTTP têm resolução de um segundo.
- A ADR 0011 deixa de valer no ponto "Syncs concorrentes: last-write-wins" e
  na alternativa descartada `If-Match`. O resto dela continua.

## Alternativas descartadas

- Coluna `version` inteira por tabela: mais robusta que um timestamp, mas
  exige migração em todas as tabelas e um campo novo em todos os read models.
  `updatedAt` já existe e já sai na API.
- Condicional só nos services que o sync usa: deixaria dois comportamentos
  para a mesma operação, e o próximo editor web cairia no caso sem proteção.
- Aceitar a janela de corrida: contradiz o objetivo do sync bidirecional.
