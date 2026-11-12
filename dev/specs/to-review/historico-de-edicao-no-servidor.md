---
type: spec
status: to-review
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
cliente já usa (`{ questionId: <slug>, field: "answer" }`).
[Histórico de edição](../../../GLOSSARY.md) e
[lacuna de edição](../../../GLOSSARY.md) estão no glossário; no texto abaixo,
"lacuna" é sempre lacuna de edição. "Chave" é a chave por prova de R30; seu
valor efetivo depende do tipo da prova.

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
    /// Id do marcador, gerado pelo navegador (R12).
    clientId   String?
    receivedAt DateTime @default(now())

    @@unique([fieldId, clientId])
    @@index([fieldId])
  }
  ```

  `Exam` ganha `answerHistory Boolean?`, como `allowCodeRun`: `null` segue o tipo
  da prova (R30). `Response` e `QuestionRef` ganham as relações inversas.

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
  `{ enabled, fields }`. `enabled` é o valor efetivo da chave (R30). `fields` traz, para
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
- R12. Lacunas sem texto. Cada item de `gaps` é `{ reason, id? }`, `reason` com
  até 200 caracteres e `id` uma string opaca de até 200 caracteres, gerada pelo
  cliente em `reportGap` (R24). Cada um vira uma linha `AnswerEditGap` (criando a
  âncora vazia, se preciso), no máximo 50 por campo; acima disso, descartadas sem
  erro. Um `id` já gravado no campo (`clientId`, único com `fieldId`) é ignorado
  em silêncio: é o reenvio de um item cuja resposta o cliente não viu, e não
  grava a lacuna duas vezes. Sem `id`, grava como antes. Lacunas seguem as mesmas
  regras de prazo e de chave dos lotes. Unit.
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
- R15. Chave desligada. Com o valor efetivo da chave falso, `append` não grava
  nada, devolve `enabled: false` e `closed` (`reason: "disabled"`) em todos os
  itens, exceto retry idêntico de lote já gravado (R8). Isso vale também para
  lotes e marcadores que a página coletou antes do desligamento e só enviou
  depois: o servidor não compara o tempo do lote com o instante do desligamento,
  e o histórico do aluno termina numa lacuna. O histórico gravado antes fica.
  `inspect` devolve `enabled: false` e `canWrite: false`. Unit: lote enviado
  depois de desligar é recusado; retry idêntico de lote gravado antes ainda
  recebe o recibo; linhas gravadas antes continuam iguais.

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
      gaps?: Array<{ reason: string, id?: string }>,
    }>,
  }
  output: { enabled: boolean, results: FieldResult[] }   // R6
  ```

  Erros da chamada inteira: sem sessão, `UNAUTHORIZED`; tentativa não encontrada
  (R4), `NOT_FOUND`; mais de 128 itens ou corpo fora do formato de envelope,
  `BAD_REQUEST`. Tudo o mais é resultado por item. e2e: uma chamada de cada caso,
  pela rede.
- R22. `exam.answer` devolve `{ serverNow, answerHistory? }`. `answerHistory` é
  o valor efetivo da chave (R30), lido depois que a resposta foi gravada. Se essa leitura
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
  guarda em memória (no máximo 50 por campo, motivo cortado em 200 caracteres) e
  manda os marcadores no próximo envio, no item do campo. Cada marcador ganha um
  `id` quando `reportGap` é chamado e o guarda até o envio ser confirmado; um
  reenvio leva o mesmo `id` (R12). Um item só com `gaps` responde `accepted` sem
  recibo. O adaptador chama `reportGap` dentro do tratamento de
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
  - `enabled: false` em qualquer resposta, `inspect` incluída: chama o callback `onDisabled` da
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
    tentativa no IndexedDB, com teto de 2 s. A recarga da página nunca espera
    mais que esse teto: se `discard` pendura, recarrega assim mesmo. Depois de
    `discard`, o coordenador fica parado e nada regrava um registro;
  - ao abrir a página de uma tentativa que não está em andamento (entregue, prazo
    vencido), a página remove em segundo plano os registros dessa tentativa.

  Falha ao apagar é ignorada; o TTL cobre. Unit (coordenador) e e2e (IndexedDB
  vazio para a tentativa depois de entregar).
- R29. Página e chave. A página `exams/[slug].astro` passa ao `ExamAttempt` o
  valor efetivo da chave (R30), calculado no servidor; o componente não conhece a
  regra por tipo. A página só abre o
  monitor com a tentativa em andamento e `answerHistory` verdadeiro. Até T8, exige
  também a chave local `"on"`; T8 remove a chave local
  (`ANSWER_HISTORY_SWITCH`). Com o monitor aberto, `answerHistory: false` na
  resposta de `exam.answer` ou `enabled: false` do histórico chamam
  `adapter.disable("exam switch off")`. Ligar a chave de novo só vale para páginas
  carregadas depois. e2e.

### G. Chave por prova (instrutor)

- R30. A chave é `Exam.answerHistory Boolean?`, com o mesmo desenho de
  `allowCodeRun`. Valor efetivo: o valor gravado quando não é `null`; com `null`,
  ligado em `EXAM` e `QUIZ`, desligado em `PRACTICE`. A regra fica numa função
  pura única em `src/services/` (ao lado de `code-run.ts`), usada pelo service, pelas
  Actions e pela página; nenhum outro lugar repete a regra por tipo.

  É estado do servidor, como `extraTime`
  (`dev/adr/0011-contrato-de-sync-entre-cli-e-servidor.md`): aparece em
  `examSchema` (saída, inclusive REST e OpenAPI, sem quebrar o CLI) e não está em
  `examCreate` nem `examUpdate`. Não existe no frontmatter da prova e o CLI não a
  envia nem a lê para nada. Só muda pela Action `exam.setAnswerHistory({
  discipline, course, exam, enabled })`, sobre `ExamService`, que grava `true` ou
  `false` explícito e é permitida a quem tem `course.update-contents` no curso.

  Controle na página da prova (`exams/[slug].astro`, bloco `canManage`), em todos
  os tipos de prova: um toggle "Registrar histórico de edição" que mostra o valor
  efetivo, com uma linha explicando que desligar não apaga o histórico já gravado
  e que as páginas abertas param de enviar.

  Unit: valor efetivo nos três tipos com `null`, `true` e `false`; dono muda;
  aluno e admin que não dá o curso recebem `NotAllowed`; `PATCH` REST com
  `answerHistory` não muda o valor. e2e: o toggle mostra o padrão do tipo e
  muda o valor.
- R31. Desligar com a prova em andamento chega à página aberta. e2e: aluno com a
  página aberta e o monitor ativo; o instrutor desliga; na próxima resposta salva
  (ou no próximo envio do histórico) o monitor é desligado, o aluno continua
  digitando, salvando e entrega; nenhum lote é gravado depois do desligamento,
  nem os que a página coletou antes e enviou depois (R15); os lotes de antes
  continuam lá.

### H. Leitura pelo instrutor

- R32. Permissão nova `response.read-edits`: dono do curso e `SYSTEM`. Sem ramo
  de admin e sem aluno, como `feedback.create`. Unit: dono lê; o próprio aluno,
  outro aluno e admin que não dá o curso recebem `NotAllowed`.
- R33. `AnswerEditService.summary({ course, exam, author }, { actor })` devolve,
  para cada questão seguida da prova, o resumo de R34, mais `enabled` da prova e
  `incomplete` da tentativa. Lê lotes e lacunas do campo de uma vez (sem
  paginação: o máximo por tentativa é 4 MiB). O cálculo é uma função pura em
  `src/services/answer-edits/summary.ts`, testada sem banco. Unit.
- R34. Resumo por resposta. Os tempos dos edits são relativos à sessão do
  navegador e servem só para durações. Todo horário de parede mostrado vem de
  `receivedAt` do lote, com precisão de um ciclo de envio (cerca de 1 minuto), e
  a tela o apresenta como horário de recebimento. O monitor não muda para isso:
  nada de horário de parede na sessão nem no envelope.
  - **tempo ativo**: soma, dentro de cada sessão, dos intervalos entre inícios de
    edits consecutivos, cada um limitado a `ACTIVE_IDLE_MS = 60_000`, mais a
    duração do último edit da sessão;
  - **primeira e última edição**: `receivedAt` do primeiro e do último lote;
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
  - **contagem por tipo**: o resumo traz `kinds`, a quantidade de edits de cada
    tipo de entrada.
  - `incomplete` sem nenhum lote é o estado `incomplete`, não `none`.
  - A lacuna final só existe com âncora e com resposta enviada; sem um dos dois
    não há o que comparar.
  - Os tamanhos de lacuna são em unidades UTF-16; o sufixo comum nunca se
    sobrepõe ao prefixo comum.
  - Várias tentativas do mesmo autor (possível em `PRACTICE`): `summary` lê a
    primeira por `createdAt` (desempate por `id`), a mesma que a página da
    tentativa mostra (`attempts.find` sobre a lista em ordem de criação).

  Unit, com lotes montados à mão: valores exatos de cada item, incluindo
  intervalo de exatamente 60 s, emoji fora do BMP numa inserção grande e lacuna
  final.
- R35. Tela. Na página da tentativa
  (`exams/[slug]/attempts/[username].astro`), cada cartão de resposta de questão
  seguida ganha um bloco recolhido "Histórico de edição" com o resumo, renderizado
  só para quem tem `response.read-edits`. Uma linha fixa diz que os dados são
  indícios observados no navegador, não prova de autoria. Prova com a chave
  efetiva desligada mostra "Registro desligado nesta prova" e o que houver de
  antes; prova `PRACTICE` no padrão, sem histórico, mostra só essa linha.
  e2e: o instrutor vê o bloco; o aluno, na mesma página, não vê nada do
  histórico (nem o bloco, nem os dados no HTML).

  - Tentativa sem histórico, com a chave ligada, mostra o bloco com o estado
    `none`.
  - A página da tentativa passou a abrir também prova `PRACTICE` (a fila e as
    demais páginas de correção continuam em 404), para que o bloco apareça nela.
  - O aviso fixo diz em linguagem simples que o resumo é um indício para quem
    corrige, não prova de má-fé. Com a chave desligada e nada gravado antes, o
    bloco mostra só a linha "Registro desligado nesta prova".

### I. Seed

- R36. `src/db/bootstrap.ts` semeia, numa prova com questões `essay` (texto e
  código), tentativas que alcançam cada estado: histórico normal com colagem e
  inserção grande; lacuna por rebase e por marcador; histórico incompleto por
  limite; prova com a chave desligada pelo toggle e histórico de antes. Além
  disso, uma prova `PRACTICE` no padrão (chave `null`, sem histórico). Os lotes
  passam pelo service (`append`), não por Prisma direto. Pronto quando
  `pnpm run db:reset` roda e as cinco situações aparecem na página da tentativa.

  Provas semeadas no curso `cs101` de `ada`: `history-essays` (hopper normal com
  colagem e inserção grande; hamilton com marcador, rebase e lacuna final;
  liskov incompleto por limite de texto; bob sem digitação registrada),
  `history-off` (hopper, chave desligada depois de gravar) e `history-practice`
  (`PRACTICE` no padrão, tentativa de knuth, sem histórico).

### J. Isolamento (R7 do RFC)

- R37. O teste `test/exam-answer-edit-isolation.spec.ts` ganha o transporte real
  com o servidor respondendo 500, pendurando a requisição e devolvendo `closed`
  e `conflict` em todos os itens. Em todos os casos o aluno digita, salva e entrega
  e as respostas gravadas são as digitadas. e2e.

## Destino das issues abertas

| Issue | Destino |
| :-- | :-- |
| `historico-local-sem-leitura-na-prova.md` | Resolvida pela spec inteira (R5 a R35). Apagar em T8. Seu texto sobre "não distingue colagem de digitação" já estava superado pela seção "Causa do edit" do RFC. |
| `lacuna-do-monitor-nao-chega-ao-servidor.md` | Resolvida por R12, R13, R23 e R24. Apagada em T6. |
| `monitor-envio-final-nao-espera-reconciliacao.md` | Resolvida por R26 (e atenuada por R25: uma inspeção por tentativa). Apagada em T6. |
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
- **"Formulário da prova".** As decisões de 2026-11-11 falam em desligar a chave
  "no formulário da prova", mas não existe formulário web de prova: provas vêm do
  repositório pelo CLI, e o ADR 0011 proíbe o repositório de gravar estado do
  servidor. Decidido em 2026-11-12: toggle na página da prova, estado só do
  servidor, nada no frontmatter nem no CLI (R30).
- **Padrão da chave.** O RFC diz "ligada por padrão". Decidido em 2026-11-12:
  ligada por padrão em `EXAM` e `QUIZ`, desligada em `PRACTICE`, como
  `allowCodeRun` (R30).
- **Envio final.** O RFC fala em teto de "poucos segundos"; o código usa 1,5 s no
  adaptador e 2 s na página. A spec mantém os valores do código e cobre o resto
  com a janela de atraso de 30 s no servidor (R14).

## Plano de ação

Não há pontos abertos: as decisões de 2026-11-12 estão nos requisitos (R15, R30,
R34). Cada fatia é implementável, testável e mesclável sozinha, com a chave local
desligada, na ordem abaixo. Fatias sem dependência entre si podem correr em
paralelo.

- T1. Banco e chave no modelo. `prisma/schema.prisma` (R1, com
  `Exam.answerHistory Boolean?`), `answerHistory` só na saída de `examSchema`, a
  função pura do valor efetivo por tipo (R30), permissão `response.read-edits`
  (R32), branding dos ids novos, `prisma db push`. Testes unit: R2, valor efetivo
  nos três tipos com `null`, `true` e `false`, `PATCH` REST que não muda a chave,
  R32. Depende de nada.
- T2. Monitor com base explícita. `monitor.ts`, `checkpoint.ts` (R23). Testes
  unit nos specs `answer-edit-monitor-*`. Depende de nada.
- T3. Service. `src/core/schemas/answer-edit.ts`,
  `src/db/services/answer-edit.service.ts`, constantes (R3 a R20). Factory em
  `src/fixtures/`. Testes unit de cada requisito, incluindo a recusa depois do
  desligamento (R15). Depende de T1. Usa o codec atual; o formato de `base` vem de
  T2, mas o service não importa o monitor.
- T4. Actions. `src/actions/answer-history.ts` e o valor efetivo da chave na
  resposta de `exam.answer` (R21, R22). Testes e2e do contrato. Depende de T3.
- T5. Toggle na web. Action `exam.setAnswerHistory` sobre `ExamService` e toggle
  na página da prova, em todos os tipos, mostrando o valor efetivo (R30). Testes
  unit da Action e do service, e2e do toggle (padrão do tipo e mudança). Depende
  de T1. Nada no CLI nem no frontmatter.
- T6. Cliente. Transporte real, `reportGap`, `discard`, espera de reconciliação no
  `flushFinal`, prop `attempt` e valor efetivo da chave em `ExamAttempt`, reação a
  `enabled: false` (R24 a R29). A página continua exigindo a chave local. Testes
  unit do coordenador e e2e com a chave local ligada, incluindo R31 (desliga pelo
  toggle de T5) e R37. Depende de T2, T4 e T5.
- T7. Resumo e tela. `summary.ts`, `AnswerEditService.summary`, bloco na página da
  tentativa com horários de recebimento, mensagens i18n (R33 a R35). Seed (R36) na
  mesma fatia, porque a tela só se vê com dados. Testes unit do resumo e e2e da
  tela. Depende de T3 e, para semear a prova com a chave desligada, de T5 (ou
  grava `false` pelo service de T5). O seed depende de T2 só se usar o monitor
  para gerar lotes (pode montar tuplas à mão).
- T9. Medição, depois de T3 e antes de T8: com os dados de
  `test/answer-edit-load.spec.ts`, medir bytes por aluno-hora, tempo de validação
  do maior lote permitido (meta: menos de 50 ms fora da transação) e duração da
  transação de escrita. Se a meta não fechar, baixar os limites de R17 e anotar
  aqui os valores medidos.

  **Resultado (2026-11-12).** Máquina de 12 núcleos, 32 GB, ext4 em NVMe. Os
  bancos de teste ficam em `/dev/shm` (tmpfs); onde há "disco", o banco ficou
  em `~/.cache`, com o `fsync` de cada commit. Outro processo (python, uns 12 GB
  e 2 núcleos) rodou na máquina durante as medições: os valores são pessimistas.
  `test/answer-edit-load.spec.ts` não existe; os dados vêm de um digitador
  simulado (semente fixa) que alimenta o `AnswerEditMonitor` real, com envio a
  cada 55 a 65 s, e que grava pelo `append` real. Script:
  `scripts/measure-answer-history.ts` (fora de qualquer suíte; ver o cabeçalho).
  Valores como mediana (p95). `byteCount` é a soma dos lotes como R18 a conta;
  "páginas" é o que as quatro tabelas e seus índices ocupam no SQLite.

  | Medida | Método | Valor |
  | :-- | :-- | :-- |
  | (a) redação de 300 palavras, 38 wpm | 30 sementes | 7,8 min; 128 edits (158); `byteCount` 17,9 KiB (20,8); páginas 12 KiB (16); 138 KiB/h |
  | (b) código de 60 linhas, 3 colagens | 30 sementes | 15 min; 274 edits (319); `byteCount` 38,7 KiB (49,9); páginas 24 KiB (32); 154 KiB/h |
  | (c) prova de 88 min, 5 abertas, ativo | 30 sementes | 751 edits (831); `byteCount` 111 KiB (126); páginas 64 KiB (76); 76 KiB/h |
  | (e) prova pesada (digitação contínua, 30% de revisões, 6% de erros) | 30 sementes | 1.567 edits (1.771); `byteCount` 198 KiB (244); páginas 128 KiB (144); 135 KiB/h |
  | (d) envelope do RFC (10 edits/s sem agrupar, 90 min) | 3 sementes | 53.990 edits; `byteCount` 3.821 KiB, 93,5% dos 4 MiB; páginas 1.504 KiB |
  | Turma de 100, `byteCount` (páginas) | extrapolação | (a) 1,8 (1,2) MiB; (b) 3,8 (2,3); (c) 10,9 (6,3); (e) 19,4 (12,5); (d) 373 (147). Para 250 alunos, multiplique por 2,5 |
  | Parcela da `snapshot` no `byteCount` | 30 sementes | 48% a 56% nos perfis normais, 64% em (d) |
  | CPU por lote fora da transação, lote típico (17 edits, 2,2 KB) | 164 lotes do perfil (a) x 20 | 0,026 ms (0,046) |
  | CPU por lote, 5.000 edits de 1 caractere sobre 120 KB (249 a 367 KiB) | 24 lotes x 15 | 64 a 66 ms (68 a 72), 62 deles no replay. **Meta de 50 ms não fecha** |
  | CPU por lote, 5.000 edits de 50 caracteres sobre 60 KB (434 a 492 KiB) | 18 lotes x 15 | 37 a 38 ms (41 a 44) |
  | CPU por lote, 5.000 edits de 1 caractere sobre 4 KB | 24 lotes x 15 | 6,9 ms (10) |
  | `append` inteiro, lote típico | 83 lotes, service | tmpfs 2,9 ms (4,8); disco 4,3 ms (10) |
  | Transação de `append`, lote típico | idem, do `$transaction` ao commit | tmpfs 1,4 ms (2,4); disco 2,7 ms (5,7) |
  | Transação de `append`, maior lote | 24 e 18 lotes | tmpfs 19 a 20 ms (22 a 35); disco 21 a 22 ms (28 a 29) |
  | `exam.answer` com 100 alunos no mesmo instante, com e sem um `append` cada | service, 8 rodadas, tmpfs | 182 ms (344) sem; 270 ms (480) com (+48%). 10 alunos: 22 e 28 ms; 50: 84 e 127; 250: 576 e 784 |
  | Idem, banco em disco | idem | 100 alunos: 310 ms (904) sem; 387 ms (896) com. 250: 830 e 1.166 |
  | Idem, por HTTP contra o servidor de teste | 8 rodadas, cliente na mesma máquina | 100 alunos: 286 ms (477) sem; 433 ms (710) com (+52%). 10: 32 e 55; 50: 144 e 208 |
  | `exam.answer` com tráfego de histórico a 60 vezes o ritmo real | service, 3 x (4 s sem, 4 s com), 250 alunos | tmpfs 3,7 ms (6,5) sem; 4,5 ms (8,2) com. Disco 4,7 e 5,8. Sem efeito mensurável com 10, 50 e 100 |
  | Todos os alunos voltam de uma queda com 5.000 edits pendentes | service, tmpfs | 100 alunos: 2,7 s para gravar tudo, um `exam.answer` espera 0,8 s; 250: 7,3 s e 2,0 s |
  | Tempo extra na entrega, monitor ligado, servidor normal | navegador, 10 entregas por condição | 0 ms: do `finish` ao recarregamento 62 ms contra 60 ms sem monitor (clique até o recarregamento 472 ms contra 462) |
  | Idem, `send` leva 1 s | idem | +1,05 s (1.507 ms do clique ao recarregamento) |
  | Idem, `send` pendurado ou `inspect` pendurado | idem | teto de 2 s contado do clique: 1.995 ms (2.027 e 2.138), +1,5 s |
  | Idem, `send` recusado (abort ou 500) | idem | +40 ms (500 ms contra 462) |
  | `summary` do perfil (c) | service, 50 chamadas | 2,5 ms (6); a leitura dos lotes é 0,8 ms |
  | `summary` no limite de 4 MiB (32.000 edits de 50 caracteres) e no de bytes com 85.000 edits | service, 15 chamadas | 17 ms (32) e 28 ms (52) |
  | Página da tentativa do instrutor | HTTP, 15 GETs, histórico gravado por SQL | sem histórico 15 ms; perfil (c) 14,5 ms; 45.000 edits e 3,5 MiB 35 ms (69); 100.000 edits 56 ms (81) |

  O que fecha: R18 "caso normal abaixo de 200 KiB" (perfis (a) a (c), p95 até
  126 KiB; o (e) passa pouco, 198 KiB, e o gravado de fato não passa de 115 KiB);
  R10 (a transação típica leva 1,4 a 2,7 ms e a maior 19 a 35 ms; em ritmo real
  o histórico não altera `exam.answer`); a entrega (nenhum tempo extra no caso
  normal, teto de 2 s com o servidor do histórico fora). O que não fecha:
  1. A meta de 50 ms para o maior lote. O replay copia a string a cada edit, e o
     custo é edits x tamanho do texto (cerca de 0,5 ns por caractere): 5.000 edits
     sobre 120 KB levam 62 ms. Um texto de 20 KB leva uns 10 ms. Proposta: baixar
     `MAX_ANSWER_HISTORY_BATCH_EDITS` para 3.000 (estimativa linear: 37 ms no pior
     caso). O lote típico tem 17 edits (p95 27), então nada realista chega perto.
  2. A folga de 2x de R18. O `byteCount` soma o `snapshot` de cada lote, que a
     linha não guarda (só a âncora guarda o último): é metade do total nos casos
     normais e 64% em (d). O envelope do RFC ocupa 93,5% dos 4 MiB, não 50%, e
     uma prova de mais de uns 94 min nesse ritmo fecham o histórico. Estimativa do RFC (2
     MiB) e gravado de fato (1,4 MiB) estão certos, é a conta que está errada.
     Proposta: contar em `byteCount` só o que a linha guarda (`edits`, `baseText`,
     `gapBefore`); (d) cai para uns 1,4 MiB, 35% do limite, e os 4 MiB ficam.
     Alternativa: subir o limite para 8 MiB, que deixa a conta enganosa.
  3. R19 permite 2 MiB por chamada, uns cinco lotes máximos: até cerca de 330 ms
     de laço de eventos por chamada (conta, não medido).

  Não medido: Firefox e WebKit; rede real e disco de produção; digitação humana
  real (só o modelo, com sensibilidade de 500 a 1.200 edits por hora); o custo do
  monitor por tecla e da persistência local no navegador; o HTML da página do
  instrutor com histórico criado pelo `append` (foi criado por SQL).

  **Decisão (2026-11-12).** Os limites de R17 e R18 ficam como estão por enquanto.
  A conta de `byteCount`, que inclui o `snapshot`, e a meta de 50 ms para o maior
  lote ficam registradas como conhecidas, sem mudança. Um log da remoção do
  histórico e um comando de estatísticas virão em trabalho separado.
- T8. Ligar. Remover `ANSWER_HISTORY_SWITCH` de `ExamAttempt.tsx` (a partir daqui a
  única chave é a da prova, R30), atualizar a tabela "Estado das regras" e a
  seção "Decidido" do RFC com as decisões de 2026-11-12, apagar as issues
  resolvidas, registrar no `CHANGELOG.md`, mover esta spec para `to-review/`.
  Depende de T6, T7 e T9.

## Critérios de aceite

- Numa prova `EXAM` com a chave no padrão e sem chave local (depois de T8), um
  aluno digita numa redação no dev server, entrega, e a página da tentativa do
  instrutor mostra o resumo com tempo ativo, colagens e horários de recebimento.
- Numa prova `PRACTICE` no padrão, nada é coletado nem enviado; o instrutor liga
  o toggle e a coleta começa nas páginas abertas depois disso.
- Com o servidor do histórico fora do ar, pendurado ou recusando tudo, o aluno
  salva e entrega como antes (R37).
- O instrutor desliga a chave pelo toggle com a prova aberta; a página do aluno
  para de enviar sem aviso e sem erro, e nenhum lote chega ao banco depois disso,
  nem o que a página tinha coletado antes (R15, R31).
- O aluno não vê o próprio histórico em nenhuma tela nem no HTML.
- `pnpm run lint` e `pnpm test` saem 0.
