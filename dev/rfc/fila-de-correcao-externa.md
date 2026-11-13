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
