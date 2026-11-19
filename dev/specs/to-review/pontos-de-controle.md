---
type: spec
status: to-review
tags: [assignments, teams, git, cli]
relatedTo: [trabalhos-com-repositorio, reaproveitar-equipes-de-outro-trabalho]
created: 2026-11-19
creator: claude
---

# Pontos de controle em trabalhos

## Contexto

Um trabalho (`Assignment`) tem uma entrega só: a ponta da `main` no prazo. Em
projetos longos o professor quer marcos no caminho, do tipo "o parser precisa
estar pronto até o dia 26". Hoje não há como registrar esses marcos nem saber,
depois, o que cada equipe tinha em cada data.

Esta spec cria o **ponto de controle**: uma data intermediária com nome. O
commit que conta para o ponto é a ponta da `main` da equipe naquele instante,
calculado dos pushes que o servidor já registra (`TeamPush`). O aluno não faz
nada além do push normal, e quem entrega adiantado ou avança além do pedido
não é prejudicado.

O ponto de controle é só um registro. Nada é recusado nem penalizado por
causa dele. Quando a entrega intermediária precisa de atraso próprio, o
professor cria dois trabalhos.

## Glossário

Entra no `GLOSSARY.md` (T1):

- **Checkpoint** (pt-BR "ponto de controle"): data intermediária de um
  trabalho. O commit que conta para ele é a ponta da `main` da equipe naquele
  instante.

## Requisitos

### Banco

- R1. `Assignment` ganha uma coluna, sem tabela nova:

  ```prisma
  /// Intermediate dates before dueAt, each naming the tip of main at that
  /// instant: `[{ slug, title, at }]`, ordered by `at`. Null means none.
  checkpoints Json?
  ```

- R2. O commit de um ponto de controle não é gravado: sai dos `TeamPush`
  (R5). Mudar a data de um ponto, mesmo depois que ela passou, é permitido e
  recalcula o commit sozinho.

### Entidades

- R3. `src/core/schemas/assignment.ts`:

  ```ts
  /// One intermediate date of an assignment.
  export const assignmentCheckpoint = z.object({
  	slug: slug,
  	title: z.string().trim().min(1).max(200),
  	at: instant,
  });
  ```

  `assignmentFields` ganha `checkpoints: z.array(assignmentCheckpoint).max(20).nullish()`
  e `assignmentSchema` ganha `checkpoints` (lista, vazia quando não há).
- R4. Regras, em `assignmentRuleIssues` (valem no `upsert` e no `PUT`): slug
  único dentro do trabalho; `at < dueAt`; `at >= opensAt` quando há `opensAt`.
  O service grava a lista em ordem de `at`. Lista vazia grava `null`.
- R5. `src/services/assignment-delivery.ts` ganha a função pura:

  ```ts
  /** The push each checkpoint fixes: the last one at or before its date. */
  export function checkpointDeliveries<P extends TimedPush>(
  	pushes: readonly P[],
  	checkpoints: readonly { slug: string; at: Date }[],
  ): { slug: string; push: P | null }[];
  ```

  Um push exatamente em `at` conta. Empate de instante se resolve pelo maior
  id, como em `teamDelivery`. O resultado segue a ordem de `checkpoints`.
- R6. `teamListedSchema` e `teamMineSchema` ganham
  `checkpoints: [{ slug, push }]`, com `push` no formato de `teamPushSchema`
  ou nulo. `TeamService.listWithDeliveries` e `findMine` preenchem o campo.
  Nenhum método novo.
- R7. Equipe criada de um template e sem push até a data fica com
  `push: null`: `Team.baseSha` não é entrega.
- R8. `Team.dueAt` (prorrogação) não altera ponto de controle. `pushRules` não
  muda.
- R9. `teamSummarySchema` ganha `checkpoints: [{ slug, teams }]`, com quantas
  equipes têm push em cada ponto que já passou.

### REST e permissões

- R10. Nenhuma rota e nenhuma permissão nova. O `PUT` do trabalho aceita
  `checkpoints`, o `GET` devolve, e a listagem de equipes traz o campo de R6.
  O aluno vê só os pontos da própria equipe, como a entrega.
- R11. `pnpm run openapi:cli` regenera o snapshot e o cliente da CLI na mesma
  tarefa.

### Telas

Em `/{discipline}/{course}/assignments/<slug>`, sem página nova.

- R12. Lista de prazos (`StudentView.astro`, `ManagerView.astro`): uma linha
  por ponto de controle, entre a abertura e o prazo, com título e data. O
  prazo final continua em destaque.
- R13. Painel da equipe (`TeamPanel.astro`), abaixo da entrega: uma linha por
  ponto, em um de três estados: ainda não chegou; cumprido (commit curto,
  hora, autor); passou sem push. Sem alerta novo.
- R14. Histórico de pushes (`PushHistory.astro`): o push que conta para um
  ponto ganha uma etiqueta com o título do ponto. Um push pode levar mais de
  uma etiqueta, e também a de entrega no prazo.
- R15. Tabela de equipes do professor (`TeamsManager.tsx`): uma coluna
  estreita por ponto que já passou, com o commit curto ou um traço; rolagem
  horizontal na tabela quando não couber. Ponto futuro não tem coluna. O
  resumo no topo mostra "N de M equipes" por ponto passado (R9).
- R16. Textos em `messages/{en,pt-BR}/assignments.json`. Em pt-BR o termo é
  "ponto de controle".

### CLI

- R17. Frontmatter de `assignments/<slug>.md` (`cli/codehood/push/assignment.py`):

  ```yaml
  checkpoints:
    - slug: parser
      title: Parser funcionando
      at: 2026-11-26 23:59
  ```

  `slug`, `title` e `at` são obrigatórios, e `at` exige hora, como `due`. A
  CLI valida antes de enviar: slug repetido, `at` igual ou depois de `due`,
  `at` antes de `opens`, chave desconhecida.
- R18. Tirar um ponto do arquivo o remove do servidor no próximo
  `codehood push`, sem flag e sem aviso: nenhum dado depende dele.
- R19. `codehood assignment clone <slug> --checkpoint <slug>` faz checkout do
  commit daquele ponto. Equipe sem commit no ponto é pulada e listada no fim.
  `--checkpoint` com `--late` é erro, e slug que o trabalho não tem também.
- R20. `codehood assignment status <slug>` ganha uma coluna por ponto de
  controle, com o commit curto ou vazio.
- R21. `cli/README.md` e `cli/CHANGELOG.md` descrevem o frontmatter e a opção.

### Dados de dev

- R22. Sem trabalho novo. Em `src/db/bootstrap-assignments.ts`:

  | Trabalho        | Ponto                | Estado que mostra                                   |
  | :-------------- | :------------------- | :-------------------------------------------------- |
  | `projeto-final` | um passado           | equipe de `bob` com push antes da data (cumprido)   |
  | `projeto-final` | o mesmo              | uma equipe cujo primeiro push veio depois (sem push) |
  | `projeto-final` | o mesmo              | a equipe sem repositório, que já existe             |
  | `projeto-final` | um futuro            | "ainda não chegou"                                  |
  | `lab-git`       | um passado           | ponto de controle em trabalho individual            |

  As datas dos pushes do seed são ajustadas onde for preciso para os dois
  primeiros estados existirem.

## Fora do escopo

- Marcar o ponto com uma tag git. Exigiria aceitar `refs/tags/*` no hook,
  guardar a ref em `TeamPush` e reconciliar tags, e o aluno que esquece
  `git push --tags` não entregaria nada.
- Entrega atrasada, tolerância ou prorrogação por ponto de controle.
- Arquivos obrigatórios (`require`) por ponto de controle.
- Nota ligada a um ponto de controle.
- Placar com os pontos das outras equipes para o aluno.
- Reaproveitar as equipes de outro trabalho
  (`dev/issues/reaproveitar-equipes-de-outro-trabalho.md`).

## Plano de ação

| T   | Tarefa                                                        | Arquivos                                                                                                   | Cobre      | Depende | Modelo |
| :-- | :------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------- | :--------- | :------ | :----- |
| T1  | Coluna e glossário                                            | `prisma/schema.prisma`, `GLOSSARY.md`                                                                      | R1         | —       | haiku  |
| T2  | Schemas, `checkpointDeliveries`, services, specs unit         | `src/core/schemas/{assignment,team}.ts`, `src/services/assignment-delivery.ts`, `src/db/services/{assignment,team}.service.ts`, `src/db/assignment-access.ts`, `test/assignment-{delivery,schema,service}.spec.ts`, `test/team-service.spec.ts`, `test/fill/fill.ts` | R2 a R9    | T1      | sonnet |
| T3  | OpenAPI e cliente gerado                                      | `cli/resources/openapi/codehood.json`, `cli/codehood/api/generated.py`, `test/api-assignment.spec.ts`      | R10, R11   | T2      | haiku  |
| T4  | Histórias e e2e                                               | `docs/user-stories/{student,instructor}.md`, `test/stories/{student,instructor}-assignments.test.ts`       | R12 a R15  | T2      | sonnet |
| T5  | Telas e textos                                                | `src/components/assignment/`, `src/pages/[discipline]/[course]/assignments/[slug].astro`, `messages/`      | R12 a R16  | T4      | sonnet |
| T6  | CLI: frontmatter, `clone --checkpoint`, `status`              | `cli/codehood/push/assignment.py`, `cli/codehood/cli/assignment.py`, `cli/codehood/assignments.py`, `cli/tests/`, `cli/README.md`, `cli/CHANGELOG.md` | R17 a R21 | T3 | sonnet |
| T7  | Seed e changelog                                              | `src/db/bootstrap-assignments.ts`, `CHANGELOG.md`                                                          | R22        | T2      | sonnet |

T5, T6 e T7 não têm arquivos em comum e podem rodar em paralelo.

Critério de pronto de cada tarefa:

- T1: `pnpm run db:reset` e `pnpm run typecheck` saem 0.
- T2: `rtk pnpm run test:unit` passa, com casos para `checkpointDeliveries`
  (sem push; push antes, exatamente em e depois de `at`; dois pontos com o
  mesmo push; equipe só com `baseSha`), para cada recusa de R4, para a
  mudança de data que recalcula (R2) e para o aluno que não lê os pontos de
  outra equipe (R10).
- T3: `test/openapi-snapshot.spec.ts` e
  `cli/tests/test_generated_in_sync.py` passam; o e2e da API faz `PUT` com
  `checkpoints` e lê o campo na listagem de equipes.
- T4: os e2e existem e falham porque as telas ainda não mostram os pontos.
- T5: os e2e de T4 passam e `pnpm run test:tour` sai 0.
- T6: `rtk uv run pytest` em `cli/` passa.
- T7: cada linha da tabela de R22 abre no dev server sem arrumar nada à mão.
- No fim: `pnpm exec biome check --write .`, `pnpm run lint`, `rtk pnpm test`
  e `rtk uv run pytest` saem 0.

## Critérios de aceite

- Screenshots, com os dados do seed: a página do aluno nos três estados de
  R13 e a tabela do professor com a coluna do ponto passado.
- Sessão de terminal do professor: `codehood push` com `checkpoints` no
  frontmatter, `codehood assignment status` e
  `codehood assignment clone --checkpoint`.
- `git diff --stat` do trabalho, para conferir que o diff ficou pequeno.
- Saída de `rtk pnpm test` e de `rtk uv run pytest`.
