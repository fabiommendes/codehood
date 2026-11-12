---
type: spec
status: to-do
tags: [exam, answer-edits, grading, monitoring]
relatedTo: [historico-de-edicao-de-respostas-abertas, historico-de-edicao-progresso, response-service, submission-service, exam-service]
created: 2026-11-12
creator: claude
---

# Histórico de edição no servidor, envio pelo cliente e chave por prova

## Contexto

O monitor de edição já roda no navegador (`src/services/answer-edits/`) e está
ligado à página de prova (`src/components/exam/ExamAttempt.tsx`) atrás da chave
de desenvolvimento `localStorage["codehood.answerHistory"] = "on"`. O transporte
(`src/components/exam/answer-edit-session.ts`) falha de propósito: não há
endpoint. O histórico fica no IndexedDB até expirar e ninguém o lê.

Esta spec cobre o que falta para o histórico chegar ao servidor e ser lido por
quem corrige:

- modelos Prisma e Service do histórico;
- Actions de inspeção e envio, com limites, prazo e idempotência;
- mudanças no cliente: marcador de lacuna, envio, apagamento da cópia local;
- chave por prova em `Exam` e o caminho até as páginas abertas;
- resumo por resposta na tela do instrutor;
- seed.

As regras R1 a R7 e as decisões de 2026-11-11 do RFC
`dev/rfc/historico-de-edicao-de-respostas-abertas.md` valem aqui e não são
repetidas. A mais importante: a resposta chegar ao servidor vale mais que o
histórico. Nenhuma falha, recusa, limite ou lentidão do histórico afeta
`exam.answer` ou `exam.finish`.

Termos: "tentativa" é a [Response](../../../GLOSSARY.md) (uma por aluno numa
prova graduada, várias numa prova `PRACTICE`); "resposta" é a
[Submission](../../../GLOSSARY.md). "Campo" é o par questão e nome de campo que o
cliente já usa (`{ questionId: <slug>, field: "answer" }`). "Lacuna" é um trecho
do histórico que não é reproduzível.

## Fora do escopo

- Replay com linha do tempo: `dev/issues/replay-do-historico-de-edicao.md`.
- Checkpoints no servidor.
- Tipo `code` do mdq: `dev/issues/suporte-ao-tipo-code-do-mdq.md`. Esta spec
  deixa a regra "quais questões têm histórico" num único ponto (R11) para que
  incluir `code` seja uma linha.
- Rich text, aviso ao aluno, indicador de falha para o aluno, chave global.
- Leitura do histórico pela REST API ou pelo CLI.

## Requisitos

Cada requisito diz onde se testa: **unit** (service, funções puras, classes do
cliente com doubles) ou **e2e** (Action pela rede, página no navegador).

### A. Banco de dados

- R1. Modelos novos, como proposta (nomes e tipos podem mudar na
  implementação, as unicidades e relações não):

  ```prisma
  /// The edit history of one attempt's open answers, for graders only.
  model AnswerEditHistory {
    id         Int      @id @default(autoincrement())
    responseId Int      @unique
    response   Response @relation(fields: [responseId], references: [id], onDelete: Cascade)

    /// Totals over every stored batch and gap, checked against the per-attempt limits.
    editCount Int @default(0)
    byteCount Int @default(0)
    /// When a per-attempt limit was reached; no batch is stored after it.
    incompleteAt DateTime?

    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt

    fields AnswerEditField[]
  }

  /// Replay anchor of one field: the text after the last stored batch. Not the answer.
  model AnswerEditField {
    id         Int               @id @default(autoincrement())
    historyId  Int
    history    AnswerEditHistory @relation(fields: [historyId], references: [id], onDelete: Cascade)
    questionId Int
    question   QuestionRef       @relation(fields: [questionId], references: [id], onDelete: Cascade)
    field      String

    text     String
    revision Int    @default(0)
    nextSeq  Int    @default(0)
    /// When this field stopped taking batches because its text outgrew the limit.
    incompleteAt DateTime?

    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt

    batches AnswerEditBatch[]
    gaps    AnswerEditGap[]

    @@unique([historyId, questionId, field])
  }

  /// One immutable batch of edits, append-only.
  model AnswerEditBatch {
    id      Int             @id @default(autoincrement())
    fieldId Int
    field   AnswerEditField @relation(fields: [fieldId], references: [id], onDelete: Cascade)

    batchId      String
    /// The revision this batch produced: its base revision plus one.
    revision     Int
    firstSeq     Int
    editCount    Int
    sessionId    String
    timeOriginMs Int
    /// Codec version of `edits`.
    version      Int
    /// EditTuple[] exactly as received.
    edits        Json
    /// sha-256 of the canonical batch, to tell a retry from a reused id.
    contentHash  String
    byteCount    Int

    /// Set when the batch starts from a text the anchor did not hold: "start" or "rebase".
    baseReason String?
    /// The text the edits start from, only when `baseReason` is set.
    baseText   String?
    /// The anchor text the batch replaced, only for a "rebase" whose base differs from it.
    gapBefore  String?

    /// Milliseconds after the attempt closed, when the batch arrived in the late window.
    lateMs     Int?
    receivedAt DateTime @default(now())

    @@unique([fieldId, revision])
    @@unique([fieldId, batchId])
  }

  /// Explicit marker that the browser stopped recording a field.
  model AnswerEditGap {
    id         Int             @id @default(autoincrement())
    fieldId    Int
    field      AnswerEditField @relation(fields: [fieldId], references: [id], onDelete: Cascade)
    reason     String
    receivedAt DateTime @default(now())

    @@index([fieldId])
  }
  ```

  `Exam` ganha `answerHistory Boolean @default(true)` (ver R30 e o ponto aberto
  P2). `Response` e `QuestionRef` ganham as relações inversas.

  Por que a âncora pende de `Response`: o histórico é da tentativa, não de uma
  resposta. Uma tentativa acumula várias `Submission` por questão; o histórico de
  um campo atravessa todas elas e existe mesmo antes da primeira. A decisão de
  retenção ("apagado com a tentativa") vira um `onDelete: Cascade` direto. Nenhum
  modelo novo referencia `Submission` (RFC, "Banco de dados").

  Por que três níveis: `AnswerEditHistory` guarda os totais por tentativa num
  lugar só, que a transação de escrita atualiza junto com o lote, sem `SUM` a cada
  envio. `AnswerEditGap` guarda as lacunas sem texto (campo que parou); as
  lacunas com texto (rebase) ficam no próprio lote, em `baseText` e `gapBefore`.
  Unit.

- R2. Apagar a tentativa apaga todo o histórico dela. `ResponseService.delete`
  apaga as submissões e a tentativa; a cascata do banco leva o resto. Teste:
  semear histórico, apagar a tentativa pelo service, não sobra linha nas quatro
  tabelas. Unit.
- R3. Nenhuma linha de histórico guarda texto completo a cada lote. Texto
  completo aparece só em `AnswerEditField.text` (um por campo), em `baseText`
  (início e rebase) e em `gapBefore` (rebase com perda). Unit, por leitura das
  linhas depois de dez lotes normais.

### B. Service `AnswerEditService` (`src/db/services/answer-edit.service.ts`, `db.answerEdit`)

Segue `dev/rfc/como-criar-e-escrever-um-service.md` e os ADRs 0004 a 0006:
`op()` com `args` e `returns`, actor obrigatório, schemas em
`src/core/schemas/answer-edit.ts`.

- R4. Identidade vem do servidor. A tentativa é localizada pelo `publicId` que
  o cliente manda, mas o service confere que ela pertence à prova e ao curso
  pedidos e que o autor é o actor. Questão é o slug, resolvido entre as questões
  da prova. O cliente não manda autor, prazo nem id numérico. Tentativa de outro
  aluno, de outra prova ou inexistente: `NotFound` (mesma resposta nos três
  casos). Instrutor e admin enviando: `NotFound`; só o autor envia. Unit.
- R5. `inspect({ course, exam, attempt }, { actor })` devolve
  `{ enabled, fields }`. `enabled` é `Exam.answerHistory`. `fields` traz, para
  cada campo com âncora: `question`, `field`, `text`, `revision`, `nextSeq`,
  `canWrite` e `receipts` (os recibos dos 32 lotes mais recentes do campo, em
  ordem de revisão). Campo sem âncora não aparece; o cliente o trata como
  `revision: 0`, `nextSeq: 0`, `text: ""`, sem recibos. `canWrite` segue R14.
  Leitura sem transação. Unit.
- R6. `append({ course, exam, attempt, fields }, { actor })` devolve
  `{ enabled, results }`, um resultado por item de `fields`, na mesma ordem. Cada
  item tem `question`, `field` e, opcionalmente, `batch` e `gaps`. Resultados:
  - `accepted` com `receipt: { batchId, revision, lastSeq }`;
  - `conflict` com `reason`;
  - `closed` com `reason`: `deadline`, `finished`, `disabled`, `not-tracked`,
    `limit`;
  - `retry`: o servidor não processou o item nesta chamada.

  Um item malformado gera `conflict` (`reason: "invalid"`) só para ele; os outros
  itens seguem. O formato da requisição é validado item a item, não como um todo,
  para que um campo ruim não derrube os outros. Unit.
- R7. Aceite de um lote. Com a âncora do campo (ou texto `""` e revisão 0 sem
  âncora), o lote é aceito quando, nesta ordem:
  1. `batch.baseRevision === anchor.revision` e `batch.firstSeq === anchor.nextSeq`;
  2. `batch.base` está presente se e só se `baseRevision === 0` ou o cliente
     rebaseou (R23); com `base`, os edits partem de `base.text`, sem ele, de
     `anchor.text`;
  3. o replay dos edits sobre esse texto dá exatamente `batch.snapshot`
     (`replayEdits` de `codec.ts`, unidades UTF-16, sem normalização);
  4. os limites de R16 a R18 não estouram.

  Aceito, numa transação: insere o lote, atualiza âncora (`text = snapshot`,
  `revision + 1`, `nextSeq + editCount`) e totais da tentativa. O recibo é
  `{ batchId, revision: baseRevision + 1, lastSeq: firstSeq + editCount - 1 }`.
  Falha em 1 ou 3: `conflict` (`reason: "base"` ou `"replay"`). Lote sem edits é
  inválido. Unit.
- R8. Idempotência. Lote com `batchId` já gravado no campo e o mesmo
  `contentHash`: devolve o recibo gravado, `accepted`, sem gravar nada, mesmo
  depois do prazo ou da entrega. Mesmo `batchId` com outro conteúdo: `conflict`
  (`reason: "reused-id"`), nada gravado. `contentHash` é o sha-256 do JSON
  canônico de `{ version, batchId, sessionId, timeOriginMs, baseRevision,
  firstSeq, edits, snapshot, base }`, chaves em ordem fixa. Unit.
- R9. Concorrência. Dois envios com a mesma revisão base para o mesmo campo
  (duas abas): no máximo um vira `accepted`; o outro recebe `conflict`
  (`reason: "base"`). Garantido pela unicidade `(fieldId, revision)` e pela
  checagem da revisão dentro da transação; violação de unicidade vira `conflict`,
  nunca 500. Unit, com duas chamadas concorrentes ao service.
- R10. A escrita não segura o banco. Decodificação, validação, replay e hash
  rodam fora da transação, sobre a âncora lida antes. Dentro da transação só há:
  reler `revision` da âncora e dos totais (compare-and-swap), inserir e atualizar.
  Se a revisão mudou entre a leitura e a transação, `conflict`. Motivo: o SQLite
  tem um escritor só (ADR 0009) e uma transação longa do histórico atrasaria
  `exam.answer`. Unit (o teste de R9 cobre o CAS); a duração se mede em T9.
- R11. Só campos seguidos recebem histórico: `field === "answer"` numa questão
  da prova cujo tipo, na versão que a prova usa, é `essay` (o que inclui a
  redação de código). A regra fica numa função única, junto da que a página usa
  para escolher as questões (`historyQuestions` em `ExamAttempt.tsx`). Questão
  fora da prova, de outro tipo ou outro campo: `closed`
  (`reason: "not-tracked"`), nada gravado. Unit.
- R12. Lacunas sem texto. Cada item de `gaps` é `{ reason }`, `reason` com até
  200 caracteres. Cada um vira uma linha `AnswerEditGap` (criando a âncora vazia,
  se preciso), no máximo 50 por campo; acima disso, descartadas sem erro. Lacunas
  seguem as mesmas regras de prazo e de chave dos lotes. Unit.
- R13. Rebase com perda. Um lote com `base.reason === "rebase"` cujo `base.text`
  difere de `anchor.text` grava `gapBefore = anchor.text`. Igual, não grava
  `gapBefore` (nada se perdeu). Nenhum edit sintético é gravado: a mudança da
  lacuna é deduzida na leitura (R34). Unit.

### C. Prazo, entrega e chave

- R14. Janela de escrita. Seja `D` o prazo pessoal da tentativa
  (`attemptDeadline` com a exceção do aluno) e `F` o instante em que ela foi
  fechada (entrega pelo aluno ou fechamento pelo instrutor). O histórico é aceito:
  - enquanto `exam.answer` aceitaria uma resposta (mesma regra de
    `assertAcceptingSubmissions`, incluindo os 10 s de `EXAM_ANSWER_GRACE_MS`);
  - e, depois disso, numa janela de atraso de `ANSWER_HISTORY_LATE_MS = 30_000`
    contada de `C = min(D + grace, F)`. Lotes nessa janela gravam
    `lateMs = receivedAt - C`.

  Fora disso, `closed` com `reason: "deadline"` (prazo) ou `"finished"`
  (fechada). Prova fechada por status (`COMPLETED`, `ARCHIVED`) sem prazo nem
  entrega: `closed`, sem janela. Tentativa reaberta pelo instrutor volta a aceitar.
  Os 30 s cobrem o último envio que sai em paralelo com `finish` (o cliente o
  espera até 2 s) e uma requisição lenta; não servem para envios de outra visita.

  Como achar `F`: não há coluna de fechamento em `Response`. Proposta: usar
  `Response.updatedAt` quando `acceptingSubmissions` é `false`, já que só a
  mudança desse campo atualiza a linha. Se a implementação achar outro escritor
  de `Response`, acrescenta `closedAt` (sem perda de dados). Unit, com relógio
  injetado: 1 ms antes e depois de `D + grace`, de `C + 30 s`, e entrega antes do
  prazo.
- R15. Chave desligada. Com `Exam.answerHistory === false`, `append` não grava
  nada, devolve `enabled: false` e `closed` (`reason: "disabled"`) em todos os
  itens, exceto retry idêntico de lote já gravado (R8). O histórico já gravado
  fica. `inspect` devolve `enabled: false` e `canWrite: false`. Unit.

### D. Limites

Contados em bytes UTF-8 (`Buffer.byteLength`), nunca em `string.length`. Valores
em `src/core/constants.ts`.

- R16. Por campo: `MAX_ANSWER_HISTORY_TEXT_BYTES = 128 KiB` para `snapshot`,
  `base.text` e a âncora. Lote que levaria o texto acima disso: o campo ganha
  `incompleteAt`, o lote não é gravado, resultado `closed` (`reason: "limit"`).
  128 KiB são cerca de 20 mil palavras, muito acima de uma resposta de prova; a
  resposta continua salva pelo canal dela. Unit.
- R17. Por lote: no máximo `MAX_ANSWER_HISTORY_BATCH_EDITS = 5000` edits e
  `MAX_ANSWER_HISTORY_BATCH_BYTES = 512 KiB` (JSON do item). Estourar grava uma
  lacuna (`reason: "batch-too-large"`) e devolve `conflict`
  (`reason: "too-large"`); o cliente rebaseia (R23) e o histórico continua a
  partir do texto atual. Escolha: o pico de referência do RFC é 600 edits por
  minuto (10 entradas/s sem agrupamento), então 5.000 cobrem uns 8 minutos de
  pico offline e bem mais de digitação normal, que agrupa por pausa; 512 KiB cabem
  `snapshot` e `base.text` no máximo de R16 e uns 5.000 edits de 50 bytes. Unit,
  no máximo exato e um acima, com texto multibyte.
- R18. Por tentativa: `MAX_ANSWER_HISTORY_ATTEMPT_EDITS = 100_000` e
  `MAX_ANSWER_HISTORY_ATTEMPT_BYTES = 4 MiB` (soma de `byteCount` dos lotes).
  O lote que passaria de um deles não é gravado; a tentativa ganha `incompleteAt`
  e todos os itens dessa e das próximas chamadas recebem `closed`
  (`reason: "limit"`). Escolha: o envelope de referência do RFC (um campo, 10
  entradas/s por 90 minutos) dá 54.000 edits, por estimativa uns 2 MiB; o limite
  deixa folga de 2x para o caso extremo. Uma turma de 100 alunos no pior caso
  ocupa 400 MiB; o caso normal deve ficar abaixo de 200 KiB por tentativa. T9
  mede e ajusta. Unit, no máximo exato e um acima.
- R19. Por chamada: no máximo 128 itens (o limite do coordenador). O service
  processa os itens em ordem e, quando a soma dos bytes já processados passa de
  `MAX_ANSWER_HISTORY_REQUEST_BYTES = 2 MiB`, devolve `retry` aos restantes. O
  corpo inteiro já é limitado pelo `actionBodySizeLimit` de 8 MiB do Astro.
  Unit.
- R20. Nenhum limite gera erro em `exam.answer` nem `exam.finish`, e nenhum
  estado incompleto aparece como completo na leitura (R34). Unit (service) e e2e
  (R31).

### E. Actions (`src/actions/answer-history.ts`, `actions.answerHistory`)

Actions e não REST: o navegador do aluno usa sessão por cookie, e a REST API
exige chave de API (ADR 0008). As Actions são camadas finas sobre o service.

- R21. Contrato:

  ```ts
  // actions.answerHistory.inspect
  input:  { discipline, course, exam, attempt }          // attempt = Response.publicId
  output: { enabled: boolean, fields: ServerFieldState[] }

  // actions.answerHistory.send
  input: {
    discipline, course, exam, attempt,
    fields: Array<{
      question: string,             // slug
      field: string,                // "answer"
      batch?: {
        version: 1, batchId, sessionId, timeOriginMs, baseRevision, firstSeq,
        edits: EditTuple[],
        snapshot: string,
        base?: { reason: "start" | "rebase", text: string },
      },
      gaps?: Array<{ reason: string }>,
    }>,
  }
  output: { enabled: boolean, results: FieldResult[] }   // R6
  ```

  Erros da chamada inteira: sem sessão, `UNAUTHORIZED`; tentativa não encontrada
  (R4), `NOT_FOUND`; mais de 128 itens ou corpo fora do formato de envelope,
  `BAD_REQUEST`. Tudo o mais é resultado por item. e2e: uma chamada de cada caso,
  pela rede.
- R22. `exam.answer` devolve `{ serverNow, answerHistory? }`. `answerHistory` é
  `Exam.answerHistory`, lido depois que a resposta foi gravada. Se essa leitura
  falhar, o campo é omitido e a resposta segue com sucesso. Nada do histórico é
  lido antes de gravar a resposta. e2e.

### F. Cliente

- R23. Base explícita no lote. `PendingEditBatch` ganha
  `base?: { reason: "start" | "rebase"; text: string }`. O monitor o preenche com
  `confirmedText` no primeiro lote após a criação com `baseRevision === 0`
  (`"start"`) e no primeiro lote após `rebase` (`"rebase"`), e o tira no
  `acknowledge` desse lote. `adoptBase` não o cria. O checkpoint passa a
  `version: 3` e guarda essa marca; `version: 2` é recusado (vira texto mais
  lacuna, como hoje). Unit: replay de `base.text` mais edits dá `snapshot` em
  todo lote com `base`.
- R24. Marcador de lacuna. O coordenador ganha `reportGap(field, reason)`, que
  guarda em memória (no máximo 50 por campo) e manda os marcadores no próximo
  envio, no item do campo. O adaptador chama `reportGap` dentro do tratamento de
  erro sempre que desliga um campo (exceção, rejeição, `disable`), sem nunca
  lançar. Marcador perdido numa queda do navegador é aceito: a leitura ainda
  mostra a lacuna pela diferença entre âncora e resposta (R34). Unit.
- R25. Transporte real (`answer-edit-session.ts`). `send` chama
  `actions.answerHistory.send`; `inspect(ref)` chama
  `actions.answerHistory.inspect` uma vez por tentativa e reaproveita a mesma
  promessa para todos os campos pedidos na mesma volta do event loop. Tradução das
  respostas:
  - erro de rede, 5xx, `UNAUTHORIZED`: rejeita; o coordenador faz backoff
    (1 s dobrando até 60 s, jitter de 0,5 a 1,5), como já faz;
  - `NOT_FOUND`, `BAD_REQUEST`: rejeita e para de enviar nesta página (o mesmo
    pedido daria o mesmo erro);
  - `enabled: false` em qualquer resposta: chama o callback `onDisabled` da
    sessão, que a página liga ao `disable()` do adaptador;
  - por item, `accepted`, `conflict`, `closed` e `retry` vão ao coordenador como
    hoje. `conflict` rebaseia com lacuna; `closed` bloqueia o campo.

  Unit, com a Action injetada; e2e no fluxo de R31.
- R26. Cadência, sem mudança: uma requisição por tentativa a cada 55 a 65 s,
  só com campos alterados; nada de requisições concorrentes. O envio final
  (`flushFinal`) sai em paralelo com `finish`, no `pagehide` e no
  `visibilitychange` para `hidden`, sem `keepalive` nem `sendBeacon` (o RFC não
  depende deles). `flushFinal` passa a esperar, dentro do mesmo teto, as
  reconciliações em andamento antes do último envio
  (`dev/issues/monitor-envio-final-nao-espera-reconciliacao.md`). Unit com
  agendador injetado.
- R27. Identidade local. `ExamAttempt` recebe `attempt` (o `publicId` da
  tentativa) e o usa como `attemptId` do coordenador, no lugar de
  `discipline/course/exam`, que colide entre tentativas de uma prova `PRACTICE`.
  Registros locais com a chave antiga expiram pelo TTL de 14 dias. Unit.
- R28. Cópia local apagada:
  - após cada recibo, o registro local do campo fica só com texto confirmado e
    recibos (já implementado; o teste passa a fazer parte desta spec);
  - após `finish` com sucesso: a página espera o `flushFinal` (até 2 s, como hoje)
    e chama `adapter.discard()`, que remove os registros de todos os campos da
    tentativa no IndexedDB, com teto de 2 s;
  - ao abrir a página de uma tentativa que não está em andamento (entregue, prazo
    vencido), a página remove em segundo plano os registros dessa tentativa.

  Falha ao apagar é ignorada; o TTL cobre. Unit (coordenador) e e2e (IndexedDB
  vazio para a tentativa depois de entregar).
- R29. Página e chave. A página `exams/[slug].astro` passa
  `answerHistory={exam.answerHistory}` ao `ExamAttempt`. A página só abre o
  monitor com a tentativa em andamento e `answerHistory` verdadeiro. Até T8, exige
  também a chave local `"on"`; T8 remove a chave local
  (`ANSWER_HISTORY_SWITCH`). Com o monitor aberto, `answerHistory: false` na
  resposta de `exam.answer` ou `enabled: false` do histórico chamam
  `adapter.disable("exam switch off")`. Ligar a chave de novo só vale para páginas
  carregadas depois. e2e.

### G. Chave por prova (instrutor)

- R30. `Exam.answerHistory` é estado do servidor, como `extraTime`
  (`dev/adr/0011-contrato-de-sync-entre-cli-e-servidor.md`): aparece em
  `examSchema` (saída, inclusive REST e OpenAPI) e não está em `examCreate` nem
  `examUpdate`. Muda por uma Action `exam.setAnswerHistory({ discipline, course,
  exam, enabled })`, sobre `ExamService`, permitida a quem tem
  `course.update-contents` no curso. Controle na página da prova
  (`exams/[slug].astro`, bloco `canManage`): um toggle "Registrar histórico de
  edição" com uma linha explicando que o histórico já coletado fica. Ver P1.
  Unit (service: dono muda, aluno e admin de fora recebem `NotAllowed`) e e2e
  (toggle muda o valor).
- R31. Desligar com a prova em andamento chega à página aberta. e2e: aluno com a
  página aberta e o monitor ativo; o instrutor desliga; na próxima resposta salva
  (ou no próximo envio do histórico) o monitor é desligado, o aluno continua
  digitando, salvando e entrega; nenhum lote é gravado depois do desligamento; os
  lotes de antes continuam lá.

### H. Leitura pelo instrutor

- R32. Permissão nova `response.read-edits`: dono do curso e `SYSTEM`. Sem ramo
  de admin e sem aluno, como `feedback.create`. Unit: dono lê; o próprio aluno,
  outro aluno e admin que não dá o curso recebem `NotAllowed`.
- R33. `AnswerEditService.summary({ course, exam, author }, { actor })` devolve,
  para cada questão seguida da prova, o resumo de R34, mais `enabled` da prova e
  `incomplete` da tentativa. Lê lotes e lacunas do campo de uma vez (sem
  paginação: o máximo por tentativa é 4 MiB). O cálculo é uma função pura em
  `src/services/answer-edits/summary.ts`, testada sem banco. Unit.
- R34. Resumo por resposta. Todos os tempos de edição são relativos à sessão do
  navegador; horários de parede vêm de `receivedAt` (ver P4):
  - **tempo ativo**: soma, dentro de cada sessão, dos intervalos entre inícios de
    edits consecutivos, cada um limitado a `ACTIVE_IDLE_MS = 60_000`, mais a
    duração do último edit da sessão;
  - **primeira e última edição**: `receivedAt` do primeiro e do último lote
    (precisão de um ciclo de envio, cerca de 1 minuto);
  - **colagens**: quantidade de edits `paste` e total de caracteres colados;
  - **inserções grandes**: edits com `insertedText` de 100 unidades UTF-16 ou
    mais, de qualquer causa, com causa, tamanho e `receivedAt` do lote; no máximo
    20, na ordem do histórico;
  - **lacunas**: cada marcador `AnswerEditGap` (motivo, horário); cada lote
    `rebase` com `gapBefore`, com o tamanho da mudança deduzida por prefixo e
    sufixo comuns entre `gapBefore` e `baseText` (caracteres removidos e
    inseridos); e uma lacuna final quando o texto da âncora difere do texto da
    última `Submission` da questão;
  - **estado**: `complete`, `incomplete` (limite de R16 ou R18), `none` (questão
    respondida sem nenhum lote).

  Unit, com lotes montados à mão: valores exatos de cada item, incluindo
  intervalo de exatamente 60 s, emoji fora do BMP numa inserção grande e lacuna
  final.
- R35. Tela. Na página da tentativa
  (`exams/[slug]/attempts/[username].astro`), cada cartão de resposta de questão
  seguida ganha um bloco recolhido "Histórico de edição" com o resumo, renderizado
  só para quem tem `response.read-edits`. Uma linha fixa diz que os dados são
  indícios observados no navegador, não prova de autoria. Prova com a chave
  desligada mostra "Registro desligado nesta prova" e o que houver de antes.
  e2e: o instrutor vê o bloco; o aluno, na mesma página, não vê nada do
  histórico (nem o bloco, nem os dados no HTML).

### I. Seed

- R36. `src/db/bootstrap.ts` semeia, numa prova com questões `essay` (texto e
  código), tentativas que alcançam cada estado: histórico normal com colagem e
  inserção grande; lacuna por rebase e por marcador; histórico incompleto por
  limite; prova com a chave desligada e histórico de antes. Os lotes passam pelo
  service (`append`), não por Prisma direto. Pronto quando `pnpm run db:reset`
  roda e as quatro situações aparecem na página da tentativa.

### J. Isolamento (R7 do RFC)

- R37. O teste `test/exam-answer-edit-isolation.spec.ts` ganha o transporte real
  com o servidor respondendo 500, pendurando a requisição e devolvendo `closed`
  e `conflict` em todos os itens. Em todos os casos o aluno digita, salva e entrega
  e as respostas gravadas são as digitadas. e2e.

## Destino das issues abertas

| Issue | Destino |
| :-- | :-- |
| `historico-local-sem-leitura-na-prova.md` | Resolvida pela spec inteira (R5 a R35). Apagar em T8. Seu texto sobre "não distingue colagem de digitação" já estava superado pela seção "Causa do edit" do RFC. |
| `lacuna-do-monitor-nao-chega-ao-servidor.md` | Resolvida por R12, R13, R23 e R24. |
| `monitor-envio-final-nao-espera-reconciliacao.md` | Resolvida por R26 (e atenuada por R25: uma inspeção por tentativa). |
| `monitor-fallback-erasure-apos-logout.md` | Fica aberta. O retry de `revoke()` no logout não muda com esta spec; R28 usa `remove` por campo, não `revoke`. |
| `replay-do-historico-de-edicao.md` | Fica aberta. Depende desta spec; o modelo (lotes imutáveis, `baseText`, `gapBefore`) já permite o replay sem checkpoints. |
| `suporte-ao-tipo-code-do-mdq.md` | Fica aberta. Quando `code` entrar, basta incluí-lo na função de R11 e alimentar `recordEdit` com o editor dele. |

## Onde o RFC e o código divergem

- **Base do lote.** O RFC diz que o primeiro lote após um rebase "não reproduz o
  texto que o servidor guardava" e deixa o marcador explícito para o endpoint. O
  código não manda texto de base nenhum, então o servidor não teria como validar
  o primeiro lote de um campo que já começa com texto (rascunho recuperado, modelo
  de código) nem o lote após rebase. A spec acrescenta `base` (R23).
- **Identidade da tentativa.** O RFC fala em tentativa; o código usa
  `discipline/course/exam` como `attemptId`, que colide em provas `PRACTICE`. A
  spec segue o RFC e usa `Response.publicId` (R27).
- **Resultados do envio.** `FieldResult` do código tem `closed` sem motivo e
  nenhum sinal de chave desligada. A spec acrescenta `reason` e `enabled` (R6,
  R25), sem mudar o comportamento do coordenador para os tipos que já existem.
- **Inspeção.** O contrato do coordenador inspeciona campo a campo; o RFC pede
  uma chamada por tentativa para o envio. A spec mantém a assinatura do
  coordenador e agrupa no transporte (R25).
- **Checkpoint.** O RFC fixa `version: 2` como única versão. R23 precisa de um
  campo novo, então passa a `version: 3`. Só há dados locais de desenvolvimento
  com a chave local, e o caminho de checkpoint recusado (texto mais lacuna) já
  existe.
- **Checkpoints no servidor.** O RFC os lista na estrutura do banco; a decisão de
  2026-11-11 os tira da primeira versão. A spec segue a decisão.
- **"Formulário da prova".** As decisões falam em desligar a chave "no
  formulário da prova", mas não existe formulário web de prova: provas vêm do
  repositório pelo CLI, e o ADR 0011 proíbe o repositório de gravar estado do
  servidor. A spec propõe um controle na página da prova (R30) e deixa a escolha
  em P1.
- **Envio final.** O RFC fala em teto de "poucos segundos"; o código usa 1,5 s no
  adaptador e 2 s na página. A spec mantém os valores do código e cobre o resto
  com a janela de atraso de 30 s no servidor (R14).

## Pontos abertos

- P1. Onde o instrutor desliga a chave.
  - (a) 🟢 Toggle na página da prova, estado só do servidor (R30). Funciona com a
    prova em andamento e o push não o desfaz.
  - (b) Chave no frontmatter da prova, enviada pelo CLI. Exige mudança no CLI e,
    pelo ADR 0011, não pode ser também alterada pela web; desligar no meio da
    prova pediria um push.
- P2. Padrão para provas `PRACTICE`.
  - (a) Ligado em todos os tipos, como diz a decisão.
  - (b) 🟢 `Boolean?` como `allowCodeRun`: `null` segue o tipo, ligado em `EXAM` e
    `QUIZ`, desligado em `PRACTICE`. Treino tem muitas tentativas por aluno e
    pouco interesse para revisão; evita a maior parte do volume. O instrutor ainda
    pode ligar.
- P3. Lotes que chegam depois do desligamento.
  - (a) 🟢 Recusar (R15). "Histórico já coletado" é o que já está no servidor; o
    instrutor que desliga espera que a coleta pare já.
  - (b) Aceitar o que a página tinha coletado até saber do desligamento. Exige
    marcar o instante do desligamento e comparar com o tempo do lote, que é do
    cliente.
- P4. Horário das edições no resumo.
  - (a) 🟢 Primeira versão com `receivedAt` (precisão de cerca de 1 minuto),
    sem mudar o monitor.
  - (b) Gravar na sessão do monitor o horário de parede da origem do relógio
    monotônico (corrigido pelo desvio que a página já mede), para horários por
    edit. Muda checkpoint e envelope; melhor junto com o replay.

## Plano de ação

Cada fatia é implementável, testável e mesclável sozinha, com a chave local
desligada, na ordem abaixo. Fatias sem dependência entre si podem correr em
paralelo.

- T1. Banco e chave no modelo. `prisma/schema.prisma` (R1), `Exam.answerHistory`
  em `examSchema` (R30, sem a Action), permissão `response.read-edits` (R32),
  branding dos ids novos, `prisma db push`. Testes: R2, padrão da chave, R32.
  Depende de nada.
- T2. Monitor com base explícita. `monitor.ts`, `checkpoint.ts` (R23). Testes
  unit nos specs `answer-edit-monitor-*`. Depende de nada.
- T3. Service. `src/core/schemas/answer-edit.ts`,
  `src/db/services/answer-edit.service.ts`, constantes (R4 a R19, R3). Factory em
  `src/fixtures/`. Testes unit de cada requisito. Depende de T1. Usa o codec atual;
  o formato de `base` vem de T2, mas o service não importa o monitor.
- T4. Actions. `src/actions/answer-history.ts`, `answerHistory` em
  `exam.answer` (R21, R22). Testes e2e do contrato. Depende de T3.
- T5. Chave na web. Action `exam.setAnswerHistory` e toggle na página da prova
  (R30). Testes unit e e2e do toggle. Depende de T1. Se P1 for (b), esta fatia
  muda.
- T6. Cliente. Transporte real, `reportGap`, `discard`, espera de reconciliação no
  `flushFinal`, prop `attempt` e `answerHistory` em `ExamAttempt`, reação a
  `enabled: false` (R24 a R29). A página continua exigindo a chave local. Testes
  unit do coordenador e e2e com a chave local ligada, incluindo R31 e R37.
  Depende de T2, T4 e T5.
- T7. Resumo e tela. `summary.ts`, `AnswerEditService.summary`, bloco na página da
  tentativa, mensagens i18n (R33 a R35). Seed (R36) na mesma fatia, porque a tela
  só se vê com dados. Testes unit do resumo e e2e da tela. Depende de T3; o seed
  depende de T2 só se usar o monitor para gerar lotes (pode montar tuplas à mão).
- T8. Ligar. Remover `ANSWER_HISTORY_SWITCH` de `ExamAttempt.tsx` (a partir daqui a
  chave é só `Exam.answerHistory`), atualizar a tabela "Estado das regras" do RFC,
  apagar as issues resolvidas, registrar no `CHANGELOG.md`, mover esta spec para
  `to-review/`. Depende de T6 e T7.
- T9. Medição, depois de T3 e antes de T8: com os dados de
  `test/answer-edit-load.spec.ts`, medir bytes por aluno-hora, tempo de validação
  do maior lote permitido (meta: menos de 50 ms fora da transação) e duração da
  transação de escrita. Se a meta não fechar, baixar os limites de R17 e anotar
  aqui os valores medidos.

## Critérios de aceite

- Com a chave da prova ligada e sem chave local (depois de T8), um aluno digita
  numa redação no dev server, entrega, e a página da tentativa do instrutor mostra
  o resumo com tempo ativo, colagens e horários.
- Com o servidor do histórico fora do ar, pendurado ou recusando tudo, o aluno
  salva e entrega como antes (R37).
- O instrutor desliga a chave com a prova aberta; a página do aluno para de enviar
  sem aviso e sem erro (R31).
- O aluno não vê o próprio histórico em nenhuma tela nem no HTML.
- `pnpm run lint` e `pnpm test` saem 0.
