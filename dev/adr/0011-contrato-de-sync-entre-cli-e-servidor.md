---
type: adr
status: accepted
tags: [sync, cli, api, rest]
created: 2026-11-03
decided: 2026-08-27
creator: claude
---

# Contrato de sync entre CLI e servidor

Não existe endpoint de "push". O servidor expõe endpoints REST comuns por
recurso, e o CLI calcula o plano e o executa operação por operação. O servidor
executa o que recebe; não calcula diferenças, não trava, não mescla.

## Contexto

Decidido com os primeiros requisitos (commit `f81cff2`, 2026-08-27). A regra
sobre estado do servidor foi decidida em 2026-11-03. O lado do CLI está em
`cli/dev/specs/to-do/push.md`. No servidor, as rotas saem de `CRUD()` (ADR
0007) e `src/api/registry/route-patterns.json` não tem rota de push.

## Decisão

- O CLI dirige. O servidor oferece um manifesto por curso (identificadores e
  marcadores de modificação, sem corpos) para o CLI comparar localmente. Hoje
  é um stub: `cli.course.preSync` (`src/rpc/cli.ts:28`, que devolve `resources: []`).
- O servidor não calcula a diferença entre repositório e banco e não infere
  deleções. Só apaga o que o CLI manda apagar.
- Toda escrita é idempotente. `PUT` é upsert pela chave natural (ADR 0007),
  `DELETE` repetido não falha (`test/question-service.spec.ts:660`), e `PATCH`
  atribui valores, nunca incrementa.
- O sync não é atômico. Cada requisição é sua própria transação; um sync
  interrompido deixa um estado parcial e coerente, e reexecutar o plano
  converge. Um deck de 40 MB que falha em 90% não desfaz as trinta questões
  que já entraram.
- Bytes de arquivo vão em `multipart/form-data`, uma parte por arquivo com o
  sha-256 como nome (`src/api/index.ts:376-382`), depois de
  `POST /api/blob/missing` (`:408`) dizer quais hashes faltam. Não há base64.
- Syncs concorrentes: last-write-wins. Um repositório é dono do conteúdo de um
  curso; coautores se acertam no Git. O `rev` gravado em cada entidade é opaco
  para o servidor; é o CLI que o usa para detectar conflitos.
- Renomear é apagar um item e criar outro. Não há operação de rename nem
  histórico entre identidades; o slug é a chave natural
  (`src/core/schemas/time-slot.ts:36`, `src/core/schemas/grade-column.ts:65`).
- Estado do servidor nunca é gravável pelo repositório: `extraTime`,
  `gradesReleasedAt`, `sharedAt` da questão e a parte do ciclo de vida do
  exame que acontece no servidor (`ONGOING`, `COMPLETED`). Um campo que o push
  pode gravar é um campo que o próximo push desfaz sem aviso. "Começar agora",
  "reabrir" e "tempo extra" são ações da web.
- O `status` do exame que o repositório declara é só `DRAFT`, `SCHEDULED` ou
  `ARCHIVED`, derivado do arquivo (`cli/dev/specs/to-do/push-exams.md`). O
  servidor recusa `ONGOING`/`COMPLETED` vindos do REST e ignora qualquer
  `status` enviado para um exame que já está `ONGOING` ou `COMPLETED`.
- O `status` da questão (`DRAFT`/`PUBLISHED`) é escrito pelo push e pela web.
  O servidor aceita os dois e não arbitra; a regra para quando divergem fica
  no CLI (`cli/dev/issues/question-status-divergence.md`).

## Consequências

- Renomear uma questão com respostas deixa as respostas no original
  arquivado (o `DELETE` de questão arquiva, `test/question-service.spec.ts:646`).
- O código ainda não cumpre a regra de estado do servidor: `examCreate` aceita
  qualquer `status` (`src/core/schemas/exam.ts:89`) e `examUpdate` aceita
  `extraTime` (`:105`). Ver `dev/issues/status-e-tempo-extra-so-pela-web.md`.
  `gradesReleasedAt` já fica de fora (`:81`); `sharedAt` ainda não existe
  (`dev/specs/to-do/question-sharing.md`).

## Alternativas descartadas

- `If-Match`/ETag nas escritas. Com um repositório por curso, o conflito que
  isso pegaria é raro, e o CLI já o detecta pelo `rev`. Ficou last-write-wins.
- Sync atômico num endpoint único: trocaria a retomada por um rollback de
  tudo a cada falha de rede.
