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

## Notas para quem implementa (apagar esta seção ao concluir)

Contexto vindo da implementação da fase 1 do sync na CLI, que é o primeiro
cliente desta regra. O plano de tarefas está em
`dev/issues/escrita-condicional-nos-services.md`.

- **Pode começar.** A fatia T7 do histórico de edição entrou em `main`
  (`3ac62b8`); `src/db/services/answer-edit.service.ts` e o schema não mudam
  mais por aquele trabalho.
- **O ETag tem de ser o texto exato do read model.** A CLI guarda o
  `updatedAt` como texto opaco, do jeito que veio na resposta do `PUT` ou da
  listagem (`cli/codehood/push/base.py`, campo `updated_at`), e vai devolvê-lo
  entre aspas no `If-Match`, sem interpretar. A comparação no servidor não
  pode depender de reformatar a data.
- **Rotas que a CLI escreve e que precisam honrar o cabeçalho:** curso,
  recurso (JSON e multipart, o de arquivo), questão, time slot, evento de
  calendário, coluna de nota, roll call (`DELETE`) e repositórios de evento.
  A lista está em `cli/codehood/push/run.py` (`_run_op`).
- **Todos esses `PUT` já devolvem o read model com `updatedAt`.** A CLI
  depende disso para não fazer um `GET` a mais; não mudar.
- **Dois writes no mesmo milissegundo ficam com o mesmo `updatedAt`**, e o
  segundo passaria por um `If-Match` antigo. Vale garantir que o valor é
  estritamente crescente por linha (por exemplo `max(now, anterior + 1ms)`)
  no helper único da checagem.
- **Escritas derivadas dentro de um mesmo push.** A CLI envia o curso e depois
  os eventos. Se o `PUT` do curso recalcula eventos e muda o `updatedAt`
  deles, o `If-Match` dos eventos, lido no preflight, falha com 412 sem que
  ninguém mais tenha escrito. O mesmo vale para apagar um evento e depois
  escrever um recurso que apontava para ele (`onDelete: SetNull`, item 6 da
  issue). Listar na ADR quais escritas mexem em outras linhas, para a CLI
  saber quando reler antes de escrever.
- **`rev` não participa.** Ele continua opaco e gravado pelo cliente. Desde a
  fase 1 a CLI também envia `rev` em questão (igual ao `version`); time slot
  continua sem `rev`.
- **Fora do escopo aqui:** o envio do cabeçalho pela CLI e o tratamento do 412
  como `Conflict`. Ficam com o sync (`dev/rfc/sync-bidirecional.md`, seção
  "Corrida entre o preflight e o PUT"). O que a CLI precisa desta entrega é o
  snapshot e o cliente regenerados (`pnpm run openapi:cli`) no mesmo trabalho.
- **Armadilhas do ambiente:**
  - specs e2e que dependem das contas do seed falham quando um spec com
    `resetDatabase` roda antes no mesmo worker
    (`dev/issues/specs-e2e-que-dependem-do-seed-falham-apos-reset.md`); não
    usar `resetDatabase` nos specs novos;
  - o dev server responde em `localhost:4321` e dá 404 em `127.0.0.1:4321`;
  - `DELETE` de curso com filhos responde 500
    (`dev/issues/delete-de-curso-com-filhos-responde-500.md`); não confundir
    com falha desta mudança;
  - os testes de integração da CLI
    (`CODEHOOD_RUN_DESTRUCTIVE_PUSH_TEST=1 uv run pytest --run-integration -m integration -q`,
    em `cli/`) escrevem em `cs101/ada_2026-2` e servem de regressão: têm de
    continuar passando sem o cabeçalho.
