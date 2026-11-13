---
type: spec
status: to-do
tags: [grading, bots, workers, exams, runner, elm, mdq]
relatedTo: [fila-de-correcao-externa, runner-de-correcao, runner-elm, auto-grading, chaves-de-api-com-escopo]
created: 2026-11-12
creator: claude
---

# Questões `code` corrigidas por workers externos

Parte do RFC `dev/rfc/fila-de-correcao-externa.md` e do RFC do chalk
`~/git/edu/chalk/dev/rfc/worker-de-correcao-do-codehood-modelo-pull.md`. Onde
divergem desta spec, vale esta spec.

## Contexto

A VPS não executa código de aluno, e o servidor recusa o tipo `code` do mdq
(`src/mdq/index.ts`, `UNSUPPORTED_QUESTION_TYPES`). Hoje uma questão de código
é um `essay` com `content: code`, corrigido depois da prova pelo `chalk
codehood autograde` rodado à mão.

Esta spec passa a hospedar o tipo `code`
(`../mdq/docs/question-types/code.md`) e acrescenta envios durante a
tentativa: o aluno envia, um worker externo roda as fontes de teste da
questão e devolve um runner report (`../mdq/docs/runner-report.md`), e o
servidor calcula a nota pela rubrica com o mdq-js. As regiões públicas de
valor `[0]` são pré-testes: definem o contrato mínimo, falhar nelas devolve o
envio sem custo. Os demais envios são limitados e cada envio errado dá
desconto, como o CodeRunner do Moodle. O primeiro worker é o `chalk-worker`
(pull), na máquina do professor, com o `chalk-grader` em sandbox.

Prazo: teste de Elm valendo poucos pontos em 2026-11-13, que serve para
experimentar o modelo; a prova real é na semana seguinte. Se não ficar
pronto, o teste usa `essay` sem worker e é corrigido com `autograde`.

## Glossário

- **Envio**: submissão `SUBMIT` ou `FINAL`, que vai para um worker.
- **Pré-teste**: caso de teste de uma região pública de valor `[0]`.
- **Trabalho de correção**: um `GradingJob`, o envio na fila de um worker.
- **Worker**: processo fora do servidor que roda os testes de uma questão
  `code` e devolve o runner report.

## Requisitos

### Questão

- R1. O servidor hospeda o tipo `code`: tira `code` de
  `UNSUPPORTED_QUESTION_TYPES`, adiciona `CODE` a `QuestionType` e guarda o
  documento como os outros (`privatePayload` inteiro, `publicPayload` pela
  forma pública do mdq, com `language`, `file`, `template` e `publicTests`).
- R2. Push de uma questão `code` é recusado (400, mensagem clara) quando:
  uma fonte de teste não está resolvida (sem `text`); há item manual de
  valor diferente de 0 em `## [rubric]` (fica para depois).
  Sem `meta.worker`, a questão `code` é válida e fica para correção manual
  (ou pelo `autograde`): nenhum `GradingJob` é criado e `SUBMIT` não se
  aplica, só autosave. Serve para questões só com pré-testes no navegador.
- R3. Worker e política em `meta`, sem mudar o mdq:

  ```yaml
  meta:
    worker: elm-test   # slug [a-z0-9-], 1 a 40; opcional (R2)
    attempts: 4        # inteiro >= 1; padrão 4
    penalty: 0.2       # decimal em [0, 1]; padrão 0.2
  ```

  Valores inválidos recusam o push com 400. Os valores vão para colunas de
  `QuestionRef` (R5) e refletem a versão mais recente da questão.
- R4. Em `PRACTICE`, envios são ilimitados e sem desconto.

### Banco

- R5. Schema (`prisma db push`; a migração sai no `pnpm run release`):

  ```prisma
  enum QuestionType {
    // atuais
    CODE
  }

  model QuestionRef {
    // campos atuais
    /// External worker that grades this question, from `meta.worker`. Null
    /// when the question is graded by hand.
    worker   String?
    /// Graded submissions allowed per attempt, from `meta.attempts`.
    attempts Int?
    /// Discount per earlier wrong submission, a decimal string in [0, 1],
    /// from `meta.penalty`.
    penalty  String?

    @@index([worker])
  }

  /// How a submission came to exist.
  enum SubmissionKind {
    /// Saved while the student types. Never graded by a worker.
    AUTOSAVE
    /// Sent by the student; may spend one of the question's attempts.
    SUBMIT
    /// The last autosave, promoted when the attempt closed.
    FINAL
  }

  enum SubmissionStatus {
    PENDING_GRADE
    WILL_NOT_GRADE
    GRADED_AUTOMATICALLY
    GRADED_MANUALLY
    /// A pretest failed; the student may send again at no cost.
    PRETEST_FAILED
  }

  model Submission {
    // campos atuais
    kind         SubmissionKind @default(AUTOSAVE)
    /// The worker's runner report (mdq runner-report schema).
    runnerReport Json?
    gradingJob   GradingJob?
  }

  /// One SUBMIT or FINAL submission waiting for an external worker.
  model GradingJob {
    id           Int        @id @default(autoincrement())
    submissionId Int        @unique
    submission   Submission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
    /// Copied from `QuestionRef.worker` when the job is created.
    worker       String
    state        GradingJobState @default(QUEUED)
    /// Bot name of the API key holding the lease.
    claimedBy    String?
    leaseUntil   DateTime?
    /// Infrastructure failures so far; FAILED past the limit.
    attempts     Int      @default(0)
    lastError    String?
    createdAt    DateTime @default(now())
    updatedAt    DateTime @updatedAt

    @@index([worker, state])
  }

  enum GradingJobState {
    QUEUED
    CLAIMED
    DONE
    FAILED
    /// Replaced by a newer submission before any worker claimed it.
    CANCELLED
  }
  ```

  Linhas antigas de `Submission` viram `AUTOSAVE`, o que está certo: a página
  da prova nunca distinguiu envio de autosave. `automaticallyTriggered` fica
  como está.

### Envio (`response.submit`)

- R6. A resposta de uma questão `code` é uma string, o conteúdo do arquivo
  (mdq). `response.submit` aceita `kind: "SUBMIT"` (padrão `AUTOSAVE`) só
  em questão com worker (sem worker: 400). Um `SUBMIT` cria o `GradingJob` na mesma transação do save. Nenhuma chamada
  externa no caminho do save.
- R7. Envio com trabalho `QUEUED` na mesma (resposta, questão): o trabalho
  antigo vira `CANCELLED` e não conta envio. Com trabalho `CLAIMED`: recusa
  com 409 ("aguarde a correção do envio anterior").
- R8. Envios gastos são os `SUBMIT`/`FINAL` com trabalho `DONE` e status
  diferente de `PRETEST_FAILED`. Sem envios sobrando, `SUBMIT` é recusado
  com 409.
- R9. Nada disto impede o autosave: R7 e R8 nunca fazem um `AUTOSAVE`
  falhar. Um `SUBMIT` recusado não perde o texto, que já está no último
  autosave.
- R10. Ao fechar a tentativa, em cada questão `code` cujo último autosave
  difere do último envio (ou sem envio algum), que ainda tem envios sobrando
  e não tem trabalho `CLAIMED`, o último autosave vira `FINAL` e ganha
  trabalho.

### Resultado e nota

- R11. Ao receber o report (R19), o servidor valida com o mdq-js
  (`checkReport`) e decide:
  - status `runner-error`: é falha de infraestrutura, tratada como `fail`
    com `retry: true` (R16);
  - status `build-error`, ou algum caso de uma região pública de valor 0
    sem veredito `pass`: `PRETEST_FAILED`;
  - senão: nota por `scoreCode` do mdq-js, gravada num `Feedback` com `ref`
    e `botId` iguais ao nome da chave, status `GRADED_AUTOMATICALLY`, e
    `feedback` com uma linha por item da full rubric (✓/✗ e o texto do
    item; o `>` do item quando falhou).
  Em todos os casos o report fica em `Submission.runnerReport`.
- R12. A nota da questão `code` é `max_i(score_i − penalty × e_i)`, com piso
  em 0 (depois de `scoreCode`, cujo piso é -1, e antes do `penalty` da
  prova), sobre os envios com nota, onde `e_i` é o número de envios com nota
  anteriores ao `i` cuja nota é menor que 1. Exemplo com `penalty: 0.2`:
  pré-teste falha, 0.6, 1.0 → `max(0.6, 1.0 − 0.2) = 0.8`. Um pass humano
  num envio substitui a nota do bot naquele envio (o pass mais novo vale).
  Fica em `src/services/exam-result.ts`; os outros tipos não mudam.
- R13. ⚠️ Em aberto (B1): numa prova em sala, o professor quer que a nota
  chegue só depois de finalizar; a decisão vem da sessão `codehood-ui`. Texto
  provisório: o aluno vê na hora o resultado de cada envio, mesmo em `EXAM`:
  pré-testes, casos públicos com o veredito e a mensagem, itens da rubrica
  ✓/✗ com o feedback, e a fração. Dos casos ocultos vê só o item. O total da
  prova segue a regra de liberação atual. Para um envio único, o professor
  usa `attempts: 1`.

### Fila

- R14. `GradingJobService` (`src/db/services/grading-job.service.ts`), com
  escrita condicional (ADR 0013):
  - `claim(actor, {workers, limit, leaseMs, discipline?, course?, exam?, questions?})`:
    devolve à fila os `CLAIMED` vencidos e pega até `limit` trabalhos
    `QUEUED` mais antigos cujo `worker` está em `workers`, de cursos de que o
    dono da chave é professor, filtrados pelos opcionais.
  - `renew(actor, submission, leaseMs)`: só o dono do lease.
  - `fail(actor, submission, {error, retry})`.
  - `complete(actor, submission, report)`: aplica R11 e fecha como `DONE`
    numa transação (salvo `runner-error`).
  - `requeueFailed(actor, {exam, question})`: `FAILED` → `QUEUED`, tentativas
    zeradas.
  - `summary(actor, {exam, question})`: contagem por estado, falhas com
    `lastError` e o `lastUsedAt` das chaves `BOT` do professor.
- R15. Lease padrão 120 s, máximo 600 s.
- R16. `fail` com `retry: true` conta tentativa e passa a `FAILED` depois de
  3; `retry: false` (worker desligando) devolve sem contar.
- R17. Um pass humano numa submissão com trabalho aberto fecha o trabalho
  (`DONE`); o worker que mandar o report depois recebe 409 e segue.
- R18. Pull e push que aceitam o mesmo worker não têm prioridade: leva o
  primeiro claim.

### REST e permissões

- R19. Rotas novas, fora de `/api/course/`, só para chave `BOT` (sessão e
  chave `CLI` recebem 403):

  | Rota | Corpo | Resposta |
  | :-- | :-- | :-- |
  | `POST /api/grading-jobs/claim` | `{workers: string[], limit?: 1..20 = 4, lease?: s = 120, discipline?, course?, exam?, questions?: string[]}` | `{jobs: Job[]}` |
  | `POST /api/grading-jobs/{submission}/renew` | `{lease?: s}` | `{leaseUntil}` |
  | `POST /api/grading-jobs/{submission}/fail` | `{error: string, retry: boolean}` | `{state}` |
  | `POST /api/grading-jobs/{submission}/result` | runner report (schema do mdq) | `{state, status, score?}` |

  `{submission}` é o `publicId` da submissão. `course` é a Course URL sem a
  barra inicial (`cs101/ada_2026-1`). Report inválido ou que não serve à
  questão: 400 com a mensagem do mdq-js.

  ```jsonc
  // Job
  {
    "submission": "Xk3...",        // publicId
    "kind": "SUBMIT",              // ou "FINAL"
    "worker": "elm-test",
    "question": {                  // documento mdq `code` resolvido (privado)
      "id": "elm-soma-lista", "type": "code", "language": "elm",
      "file": "Main.elm", "tests": [{"format": "elm", "text": "..."}],
      "answerKey": "...", "meta": {...}
    },
    "exam": "teste-1",             // slug
    "course": "cs101/ada_2026-1",
    "student": "joao",
    "answer": "module Main exposing (..)\n...",
    "leaseUntil": "2026-11-13T14:00:00Z"
  }
  ```

  `renew`/`fail`/`result` de quem não tem o lease: 409. Trabalho
  `CANCELLED`, ou já `DONE` por pass humano: 409.
- R20. Professor do curso: `summary` e `requeueFailed` por Astro Action na
  tela de correção. Aluno: estado e resultado dos próprios envios por Action
  (R13). Permissões novas em `src/auth/permissions/index.ts`, no espírito de
  `feedback.create`.
- R21. As rotas entram no OpenAPI; `pnpm run openapi:cli` regenera o snapshot
  e o cliente da CLI no mesmo trabalho.

### Telas

- R22. Prova, modo resposta, questão `code`: editor de código com o
  `template` como texto inicial, na linguagem de `language` (o mesmo
  componente de `CodeEssayAnswer`); os `publicTests` mostrados abaixo do
  enunciado; botão "Enviar"; "envio 2 de 4, vale até 0.8" (em `PRACTICE`,
  só o número); estado do último envio (na fila, corrigindo, reprovado nos
  pré-testes, corrigido) com o resultado da R13; polling de 5 s enquanto
  houver envio pendente; botão desabilitado com envio `CLAIMED` ou sem
  envios.
- R23. Pré-teste no navegador: quando o runner da linguagem tem modo de
  teste e a questão tem uma fonte de teste cujas regiões são todas públicas,
  o servidor manda o texto inteiro dessa fonte ao runner, que a roda contra a
  resposta antes do envio; falha mostra o resultado e não envia. O worker
  roda tudo de novo (R11), então o servidor não confia no navegador. ⚠️ O
  mdq diz que as linhas antes da primeira anotação (imports) são privadas;
  mandar a fonte inteira é uma escolha do host, só para fontes sem região
  oculta. Abrir issue no mdq para formalizar.
- R24. Prova, modo revisão: lista de envios com nota, desconto e qual conta,
  e o resultado da R13 de cada um.
- R25. Correção da questão (`grading/[question].astro`): painel da fila
  (contagem por estado, falhas com `lastError`, "reenfileirar falhas",
  "worker visto há X"); cada resposta mostra os envios, o report por caso
  (públicos e ocultos) e a nota pela R12.

### Runner do navegador

- R26. O plugin Elm ganha o modo de teste da R23: compila o `Main.elm` do
  aluno com a fonte de teste (um módulo que expõe `tests : Test`) e devolve
  pass/fail por caso no formato do R7 de `runner-elm`. Linguagem sem o modo
  manda o envio direto.

### CLI

- R27. O push de uma questão `code` resolve as fontes de teste linkadas
  (`[testes](Tests.elm)`) lendo os arquivos relativos à questão e chamando a
  resolução do mdq-py (`CodeQuestion.resolve`), e manda o documento
  resolvido. Arquivo que falta: erro no push, antes de falar com o servidor.

### Worker (`workers/chalk-worker/`)

- R28. Código movido do chalk: o que serve de `chalk.codehood_autograde`
  (perfis por linguagem, `make_grader`, `verify_reference`, `grade_answer`)
  vira módulos de `chalk_worker`, com os testes. O `chalk codehood
  autograde` continua no chalk por enquanto.
- R29. O worker monta o projeto a partir do `Job`: as fontes de teste da
  questão viram os arquivos de teste do perfil (`elm-test` para `language:
  elm`), a resposta vira `file`, e `answerKey` dá a solução de referência.
  `graders/<caminho>/grader.yaml` do curso, se existir, só ajusta perfil e
  limites.
- R30. O worker converte o resultado do `chalk-grader` num runner report
  válido: `source` e `line` de cada caso por um localizador do formato de
  teste. Em Elm, o `classname` do JUnit é `<Módulo> <describes>` e o `name`
  é o nome do teste: o módulo dá a fonte (linha `module <Módulo>`) e a linha
  é a do literal `test "<nome>"` (ou `fuzz*`, `todo`), desempatada pelo
  `describe` mais interno. `line` é obrigatório no report, então um caso sem
  linha encontrada é omitido (o mdq permite) e vai para o log. Build error →
  `build-error`; falha de sandbox ou perfil → `runner-error`. O runner é
  `{"name": "chalk-worker", ...}`.
- R31. Partida e cache: na primeira vez que vê uma questão (por hash do
  documento), roda `prepare` e a solução de referência; se ela não passa em
  tudo, chama `fail` com `retry: true` e um `lastError` que diz isso, sem
  rodar a resposta do aluno.
- R32. Laço: `claim` com `--batch`; fila vazia espera `--poll` com backoff até
  60 s; renova o lease na metade enquanto corrige; erro de infraestrutura
  chama `fail` com `retry: true`. `SIGINT`/`SIGTERM` termina o trabalho em
  curso, devolve os outros com `retry: false` e sai. `--once` processa até a
  fila esvaziar. Opções: `--worker` (repetível; padrão `elm-test`),
  `--exam`, `--discipline`, `--course`.
- R33. Servidor em `[server] url` do `codehood.toml` ou `--server`; chave
  `BOT` em `CODEHOOD_BOT_KEY` ou `--key-file`. A chave nunca entra no
  sandbox. Log de uma linha por trabalho: aluno, questão, resultado, tempo.

### Dados de dev

- R34. `src/db/bootstrap.ts`: questão `code` Elm com `meta: {worker:
  elm-test}`, uma fonte de pré-testes (região `{public}` `[0]`) e uma de
  testes ocultos com itens de peso; uma prova `EXAM` aberta e uma `PRACTICE`
  com ela; alunos com envios em cada estado (`QUEUED`, `CLAIMED`, `DONE` < 1
  seguido de `DONE` = 1, `PRETEST_FAILED`, `FAILED`, `CANCELLED`) e um sem
  envios sobrando. A chave `BOT` `runner` já existe. A mesma questão fica em
  `workers/chalk-worker/example/` para o teste ponta a ponta.

### Glossário

- R35. Entradas "Envio", "Pré-teste", "Trabalho de correção" e "Worker" em
  `GLOSSARY.md`, com as definições da seção Glossário.

## Fora do escopo

- Itens manuais de rubrica em questões `code` e a integração da full rubric
  ao `Rubric` do servidor.
- Workers push e o dispatcher do servidor.
- Long-poll ou push de estado para o aluno (polling basta).
- Modo de teste nos runners de outras linguagens.
- Remover `chalk codehood autograde` do chalk e `automaticallyTriggered`.
- Escopo de chave `BOT` (`chaves-de-api-com-escopo`).
- Converter questões `essay` com `content: code` para `code`.
- Comando de gestão para criar trabalhos de provas antigas.

## Plano de ação

Duas sessões em paralelo. O contrato entre elas é R3, R19 (com o formato do
`Job` e o runner report do mdq) e R27; quem precisar mudá-lo combina com a
outra sessão antes.

### Sessão servidor

- T1. Schema (`haiku`). `prisma/schema.prisma`, `db push`, `db:reset`. R5.
  Pronto: `pnpm run typecheck` sai 0.
- T2. Hospedar `code` (`sonnet`, TDD). `src/mdq/`, `src/core/schemas/question.ts`,
  `question.service.ts` (colunas de R3, recusas de R2). R1 a R3. Depende de
  T1. Pronto: specs unit de push aceito e recusado.
- T3. Resultado e nota (`sonnet`, TDD). Função pura que aplica R11 a um
  report; `src/services/exam-result.ts` com R12. R4, R11, R12. Pronto: specs
  unit da decisão de pré-teste e da fórmula.
- T4. Fila e envio (`sonnet`, TDD). `grading-job.service.ts`,
  `response.service.ts` (`submit`, fechamento), `feedback.service.ts` (R17),
  schemas em `src/core/schemas/`. R6 a R10, R14 a R18. Depende de T1 a T3.
  Pronto: specs unit de cada regra, incluindo autosave nunca falhar.
- T5. REST e permissões (`sonnet`). `src/api/index.ts`,
  `src/auth/permissions/index.ts`, `pnpm run openapi:cli`. R19 a R21.
  Depende de T4. Pronto: spec e2e da REST com chave `BOT`, `CLI` e de outro
  professor; snapshot e cliente em dia.
- T6. Histórias (`sonnet`). Aluno: vê os testes públicos, envia, falha nos
  pré-testes, envia de novo, vê a nota e o desconto, esgota os envios.
  Professor: vê a fila e o report, reenfileira falhas. Antes de T7 e T8.
- T7. Telas do aluno (`sonnet`). Resposta e revisão de `code`, Actions. R13,
  R22, R24. Depende de T4, T6.
- T8. Tela do professor (`sonnet`). `grading/[question].astro`. R25.
  Depende de T4, T6.
- T9. Runner Elm (`sonnet`). Modo de teste e uso no envio. R23, R26.
  Pronto: `pnpm run test:plugins --project=elm` com uma fonte que passa e uma
  que falha.
- T10. Seed (`haiku`). R34 (lado servidor). Depende de T1, T4. Pronto:
  `pnpm run db:reset` e cada estado visível nas telas.

### Sessão worker

- W1. Mover o código do chalk (`sonnet`). R28. Pronto: `uv run ruff check &&
  uv run pytest` em `workers/chalk-worker/`.
- W2. Projeto e report (`sonnet`, TDD). R29 a R31: montar o projeto a
  partir de um `Job`, localizador Elm, conversão para runner report
  validado pelo schema do mdq (`mdq-py`).
- W3. Laço e cliente (`sonnet`, TDD). R32, R33, contra um servidor falso que
  segue R19 enquanto T5 não existe; depois, sobre o cliente gerado.
- W4. CLI (`sonnet`). R27. Pronto: `uv run pytest` em `cli/`.
- W5. Curso de exemplo (`sonnet`). R34 (lado worker). Pronto: a solução de
  referência passa em tudo pelo worker.
- W6. Ponta a ponta (coordenador). Dev server com o seed: `chalk-worker
  --once` esvazia a fila; envios com nota e pré-teste aparecem nas telas.

### Fechamento (servidor)

`pnpm exec biome check --write .`, `pnpm run lint`, `pnpm test`, glossário
(R35), issue no mdq (R23), changelog, spec para `to-review/`.

## Critérios de aceite

- Specs unit da decisão de pré-teste (R11), da fórmula (R12) e das regras de
  envio (R6 a R10) passando.
- Push da questão de exemplo pela CLI aceito; com item manual, recusado.
- Um aluno no dev server: envio que falha no pré-teste volta sem gastar
  envio; segundo envio corrigido pelo `chalk-worker` mostra itens e nota; o
  contador e o "vale até" acompanham.
- Na correção da questão, o professor vê a fila, o report por caso, uma
  falha com `lastError` e o worker "visto há X".
- Worker parado com trabalho `CLAIMED`: o lease vence e outro claim pega.
