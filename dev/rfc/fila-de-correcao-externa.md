---
type: rfc
status: draft
tags: [grading, bots, workers, mdq, api-keys]
relatedTo: [runner-de-correcao, auto-grading, chaves-de-api-com-escopo, runners-como-plugins]
created: 2026-11-12
creator: claude
---

# Fila de correção para workers externos

Rascunho. As decisões marcadas como tomadas vieram do professor; o resto está
aberto.

## Problema

A VPS principal não executa código de aluno. Hoje a correção de questões de
código é feita pelo `chalk codehood autograde` (spec `runner-de-correcao`),
que o professor roda à mão depois da prova fechar: lista as submissões
pendentes de uma questão, corrige e grava o feedback como bot.

Queremos:

- corrigir também durante a tentativa, e não só depois da prova;
- dois modelos de worker convivendo:
  - **push**: serviços instalados na infra, ligados ao codehood, que recebem
    o trabalho;
  - **pull**: um processo na máquina do professor (`codehood-worker`, em
    Python, sobre o motor do chalk) que pede trabalho, corrige em sandbox e
    devolve a nota. Serve para questões que dependem de um ambiente que só o
    professor tem.
- vários workers sem corrigir a mesma resposta duas vezes.

Sem coordenação no servidor, dois workers (ou um push e um pull) pegam as
mesmas submissões, e o autosave da página da prova gera uma submissão por
edição, todas candidatas a correção.

## Decisões tomadas

- D1. O servidor mantém uma fila de trabalhos de correção, comum a push e
  pull. Pull pega trabalho por claim com lease.
- D2. A questão declara o id do worker que a corrige, uma string (por exemplo
  `elm-test`). A fila só anda com um worker que aceita esse id. Isso exige um
  campo novo no frontmatter do mdq.
- D3. Workers push registram no servidor os ids que aceitam. Um worker pull
  informa os ids que aceita a cada claim e se liga a uma prova ou a uma
  disciplina.
- D4. O worker pull é sempre do instrutor e autentica com a chave `BOT` dele
  (o nome da chave vira `botId`, como em `runner-de-correcao` R1).

## Como foi implementado

O modelo pull está implementado (`src/db/services/grading-job.service.ts`,
`workers/chalk-worker/`). Onde a proposta abaixo diverge, vale esta seção.

### Trabalho e ciclo de vida

Um `GradingJob` por submissão `SUBMIT` ou `FINAL` (`submissionId @unique`),
não por par (resposta, questão). Estados (`GradingJobState`):

- `QUEUED`: criado na mesma transação do envio, sem chamada externa.
- `CLAIMED`: um worker pegou com lease. Lease padrão 120 s, máximo 600 s
  (`DEFAULT_LEASE_MS`, `MAX_LEASE_MS` em `src/core/schemas/grading-job.ts`).
  `renew` só pelo dono do lease. Lease vencido volta a `QUEUED` no próximo
  `claim`, sem cron.
- `DONE`: o report do dono do lease foi aceito, ou um pass humano fechou o
  trabalho (o report que chegar depois recebe 409).
- `FAILED`: `fail` com `retry: true` (ou report `runner-error`) conta uma
  tentativa; na terceira (`MAX_JOB_ATTEMPTS = 3`) o trabalho vira `FAILED`.
  `fail` com `retry: false` (worker desligando) devolve a `QUEUED` sem contar.
  `requeueFailed` volta `FAILED` para `QUEUED` com as tentativas zeradas.
- `CANCELLED`: um envio novo chegou com o anterior ainda `QUEUED`; o antigo é
  cancelado e não gasta envio. Com o anterior `CLAIMED`, o envio novo é
  recusado com 409.

Pull e push que aceitam o mesmo worker não têm prioridade: leva o primeiro
claim.

### Nota da questão `code`

A nota é `max_i(score_i − penalty × e_i)`, com piso 0, sobre os envios com
nota (sem `PRETEST_FAILED` nem `WILL_NOT_GRADE`), onde `e_i` é o número de
envios com nota anteriores a `i` cuja nota é menor que 1. O piso entra depois
de `scoreCode` (piso -1) e antes do `penalty` da prova. Exemplo com
`penalty: 0.2`: pré-teste falha, 0.6, 1.0 dá `max(0.6, 1.0 − 0.2) = 0.8`.
Um pass humano num envio substitui a nota do bot naquele envio. O `penalty`
vem do `meta.penalty` da questão, padrão 0.2 (`DEFAULT_CODE_PENALTY`), e vale
0 em prova `PRACTICE`. Código:
`codeQuestionScore` em `src/services/code-grading.ts`, usado por
`src/services/exam-result.ts`.

Motivo: segue o CodeRunner do Moodle. O aluno pode reenviar, cada envio
errado anterior desconta, e um envio pior nunca derruba a melhor nota já
obtida.

## Proposta

### Questão (mdq)

```yaml
---
id: elm-soma-lista
worker: elm-test
---
```

- `worker` é um slug (`[a-z0-9-]`, 1 a 40). Questão sem `worker` segue o
  fluxo de hoje: correção automática pelo mdq-js quando houver, manual no
  resto.
- O material de correção (testes, solução) não entra na questão. No pull ele
  fica no repositório do professor (`graders/<caminho>/`); no push, fica para
  outro RFC.

### Fila

Um trabalho por par (resposta, questão), não por submissão: só a submissão
mais nova de cada questão numa tentativa importa.

```prisma
model GradingJob {
  id            Int      @id @default(autoincrement())
  responseId    Int
  questionRefId Int
  /// The newest submission; replaced when a new one arrives.
  submissionId  Int
  /// Worker id declared by the question.
  worker        String
  state         GradingJobState @default(QUEUED)
  /// Who holds the lease: the bot name of the key, or the push worker id.
  claimedBy     String?
  leaseUntil    DateTime?
  attempts      Int      @default(0)
  lastError     String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([responseId, questionRefId])
  @@index([worker, state])
}

enum GradingJobState { QUEUED CLAIMED DONE FAILED }
```

Regras:

- Uma submissão a uma questão com `worker` cria o trabalho ou atualiza o
  existente: troca `submissionId` e volta para `QUEUED`. Se estava `CLAIMED`,
  o feedback que chegar para a submissão antiga vale como pass dela, mas não
  fecha o trabalho.
- Feedback gravado para a submissão atual pelo dono do lease fecha o
  trabalho (`DONE`).
- Lease vencido volta para `QUEUED` (na leitura do claim; sem cron).
- `fail` incrementa `attempts`; ao passar de N (configurável, padrão 3) vai
  para `FAILED`, visível na tela de correção da questão.
- Submissão com pass humano não gera trabalho, e um pass humano fecha o
  trabalho aberto (`runner-de-correcao` R10).
- Trabalhos para provas já existentes: um comando de gestão cria os que
  faltam, no espírito de `grade-pending` em `auto-grading` R7.

### REST para workers pull

O worker pull pode se ligar a uma disciplina, então o claim não pode morar só
debaixo de `/api/course/<disciplina>/<curso>/`.

- `POST /api/grading-jobs/claim`
  `{workers: string[], limit, lease, discipline?, course?, exam?, questions?}`.
  Devolve até `limit` trabalhos, cada um com a submissão, a resposta (texto ou
  arquivos), o slug da questão, a prova e o aluno. Só traz trabalhos de cursos
  em que o dono da chave corrige. `questions` restringe aos slugs para os
  quais o worker tem material.
- `POST /api/grading-jobs/<id>/renew` `{lease}`.
- `POST /api/grading-jobs/<id>/fail` `{error, retry: boolean}`. `retry:false`
  devolve à fila sem contar tentativa (worker desligando).
- O resultado continua em `PUT .../submission/<publicId>/feedback`.

Os endpoints entram no OpenAPI e no cliente gerado do `codehood-cli`, que o
`codehood-worker` usa. O cliente gerado também precisa de `submission`,
`response` e `feedback`, que ainda não estão lá.

### Workers push

Fora do escopo da implementação, mas o modelo precisa servir:

- registro de um worker push: id, ids aceitos, URL e segredo;
- um dispatcher no servidor pega trabalhos da mesma fila e entrega por HTTP.

## Perguntas abertas

- Q1. Autosave: o trabalho é criado a cada rascunho, ou só para a submissão
  que o aluno envia? Em `EXAM` o aluno não vê a nota antes da liberação, e
  corrigir rascunho só gasta CPU; em `PRACTICE`, o retorno imediato é o
  objetivo. Proposta: rascunho só em `PRACTICE`. Depende de o servidor
  distinguir rascunho de envio.
- Q2. Nome do campo no mdq: `worker` ou `grader`? `grader` já é o termo do
  glossário para a pasta `graders/` do curso.
- Q3. Um pull e um push que aceitam o mesmo id: quem tem prioridade? Proposta:
  nenhum, o primeiro claim leva.
- Q4. A chave `BOT` precisa de escopo (`chaves-de-api-com-escopo`) antes de
  ficar ligada numa máquina o tempo todo?
- Q5. Feedback do worker para a submissão antiga, quando já existe uma mais
  nova: aceitar como pass (proposta) ou recusar com 409?
