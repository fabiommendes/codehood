---
type: spec
status: to-do
tags: [grading, bots, chalk, api-keys]
relatedTo: [auto-grading, web-grading, chaves-de-api-com-escopo, prova-moodle-e-pesos]
---

# Correção automática de questões de código pelo chalk

## Contexto

Questões em que o aluno escreve código (`[essay]` com `content: code`) caem
todas na correção manual. Na Prova 1 de Paradigmas são 155 respostas só na
q1 (`prolog-fatorial-com-is`), e o critério é mecânico. Este semestre também
vai ter Elm; depois, Python, TypeScript, C, talvez Rust, Haskell e Pytuguês.

O chalk (`~/git/edu/chalk`) já tem o motor: perfis por ecossistema em TOML
(`python-pytest`, `rust-cargo`, `c-make`, `stdio`, `elm-test`), sandbox
`bwrap` sem rede, nota calculada fora do sandbox a partir da lista de testes
da solução de referência, guard contra quem forja o relatório e notas de
suspeita para o professor (`~/git/edu/chalk/design/sandbox.md`). O servidor
do Codehood não executa código de aluno: o chalk ganha um comando que lê as
respostas pela REST, corrige com esse motor e grava as notas como um grading
bot. A parte do chalk está em `~/git/edu/chalk/design/codehood-autograde.md`;
esta spec cobre o servidor.

## Glossário

- **Grader**: a pasta `graders/<caminho>/` do repositório do curso, com o
  `grader.yaml`, o `template/` e a `solution/` de uma questão de código.
- **Runner**: o comando `chalk codehood autograde`, que corrige as respostas
  com os graders e grava as notas pela REST.

## Requisitos

### Servidor: autoria do bot

- R1. Uma requisição autenticada por uma chave `kind = BOT` age como o dono
  da chave, mas todo feedback que ela cria ou atualiza tem `botId` igual ao
  nome da chave e `graderId` nulo, e a submissão fica `GRADED_AUTOMATICALLY`
  (como `FeedbackService` já faz para `botId`).
- R2. Uma chave `BOT` não grava feedback como humano: um `grader` explícito
  no corpo é recusado com 403. Chave `CLI` e sessão continuam como hoje
  (`bot` no corpo recusado).
- R3. O nome de uma chave `BOT` é um slug (`[a-z0-9-]`, 1 a 40 caracteres),
  validado em `apiKeyCreate`, porque vira `botId`. Nome de chave `CLI` segue
  livre.
- R4. `UserActor` ganha `bot?: string`, preenchido só na autenticação por
  chave `BOT`. Só o `FeedbackService` lê esse campo.
- R5. Escopo de chave fica para o RFC `dev/rfc/chaves-de-api-com-escopo.md`.

### Servidor: notas para o professor

- R6. `Feedback.notes String?`: texto para o professor, nunca para o aluno.
  O chalk grava ali os sinais de fraude (padrões suspeitos, recusas do guard)
  e, em `error`, o log de compilação truncado.
- R7. `feedbackCreate`/`feedbackUpdate` aceitam `notes`. Só quem pode
  corrigir a submissão (professor do curso, bot dele) lê `notes`; o schema
  de saída para o aluno (revisão da tentativa, REST com chave do aluno) não
  traz o campo.
- R8. Na correção de uma questão (`grading/[question].astro`), o passe com
  `notes` mostra um aviso "Notas da correção" com o texto, só para o
  professor, e a resposta ganha um selo "suspeita" quando há notas.

### Contrato com o runner

O runner usa só a REST que já existe, mais R1 a R7:

- R9. Lê a prova (`GET .../exam/<slug>`), lista as submissões
  (`GET .../submission?exam=&question=&statuses=PENDING_GRADE&statuses=GRADED_AUTOMATICALLY`)
  e grava com `PUT .../submission/<publicId>/feedback` (`ref` = nome do bot,
  `score`, `feedback`, `notes`).
- R10. Pula a submissão com algum feedback humano: o veredito é o passe mais
  novo por `updatedAt`, então uma nova rodada do bot passaria por cima da
  nota manual.

### Dados de dev

- R11. `src/db/bootstrap.ts` semeia uma chave `BOT` `runner` para o
  professor de dev, com token fixo (como `DEV_ADA_CLI_TOKEN`), e uma prova
  fechada com uma questão `[essay]` `content: code` `highlight: prolog` e
  respostas pendentes: uma correta, uma que inverte, uma que não carrega, e
  uma já corrigida pelo bot com `notes`.

### Glossário

- R12. `GLOSSARY.md` com "Grader" e "Runner" e "Grading bot" atualizado
  (feito junto com esta spec).

## Fora do escopo

- Correção na hora da entrega (testes enviados pelo push e um daemon).
- Chaves com escopo (RFC).
- Detecção de cola entre alunos, agrupamento de respostas iguais e a tela de
  correção em volume.
- Mostrar ao aluno o log de compilação.

## Plano de ação

- T1. Autoria do bot (`sonnet`, TDD). Arquivos: `src/auth/actor.ts`, a
  montagem do ator a partir do token em `src/api/`,
  `src/db/services/feedback.service.ts` (`resolveGrader`),
  `src/core/schemas/api-key.ts`, testes. Requisitos: R1 a R4. Pronto quando
  um teste REST com chave `BOT` cria feedback com `bot = runner` e status
  `GRADED_AUTOMATICALLY`, e recusa `grader`.
- T2. `Feedback.notes` (`sonnet`, TDD). `prisma/schema.prisma` (`db push`),
  `src/core/schemas/feedback.ts`, `feedback.service.ts`, os schemas de saída
  do aluno, OpenAPI. Requisitos: R6, R7. Pronto quando um teste mostra
  `notes` para o professor e não para o aluno, pelo service e pela REST.
- T3. Tela (`sonnet`). `grading/[question].astro`, mensagens. Requisito R8.
  Depende de T2.
- T4. Seed (`haiku`). `src/db/bootstrap.ts`. R11. Depende de T1 e T2.
  Pronto quando `pnpm run db:reset` roda e a chave `runner` lista as
  submissões pendentes da prova semeada.
- T5. Lado do chalk: `~/git/edu/chalk/design/codehood-autograde.md`, no
  repositório do chalk. Paralelo a T1 e T2 (cliente REST testado contra um
  servidor falso).
- T6. Ponta a ponta (coordenador). Dev server com o seed: `chalk codehood
  autograde` corrige a prova semeada. Depois, no `dev.db` com a cópia de
  prod mais a importação: `--dry-run` na `prova-1`, conferir a distribuição
  e amostras à mão, rodar de verdade.
- T7. Fechamento: `pnpm exec biome check --write .`, `pnpm run lint`,
  testes afetados, changelog, spec para `to-review/`.

## Critérios de aceite

- Testes de T1 e T2 passando.
- Na correção da q1 da questão semeada, as respostas aparecem como
  "Graded automatically" pelo bot `runner`, com as notas do professor
  visíveis só para ele.
- Uma nota manual dada depois sobrevive a um segundo `autograde`.
- Saída do `--dry-run` na `prova-1` com a distribuição de notas da q1 e
  amostras conferidas à mão.
