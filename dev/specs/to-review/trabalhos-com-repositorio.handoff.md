---
type: handoff
status: to-review
tags: [assignments, teams, git, submissions, cli]
relatedTo: [trabalhos-com-repositorio, 0021-repositorios-de-equipe-em-disco-com-binario-git]
created: 2026-11-19
creator: claude
---

# Handoff: trabalhos entregues por repositório git, implementados e commitados

## Onde estamos

A spec `dev/specs/to-review/trabalhos-com-repositorio.md` foi implementada de
T1 a T11 em 2026-11-18 e 19 e commitada no `main` em 2026-11-19, em um commit
sobre `66d33305` (v0.6.0). O professor ainda não revisou o resultado.

O que falta é a revisão e as pendências listadas abaixo. Não há tarefa do
plano em aberto. A seção "Ao commitar" fica como registro do que ficou de
fora: os trechos da outra sessão nos arquivos compartilhados não entraram.

## O que existe

| Parte                | Onde                                                                                   |
| :------------------- | :------------------------------------------------------------------------------------- |
| Models               | `Assignment`, `Team`, `TeamMember`, `TeamPush` em `prisma/schema.prisma`               |
| Configuração         | `storage.repositoryRoot`, `storage.assignment.{maxRepoBytes,maxFileBytes}`             |
| Repositório bare     | `src/services/git/{bare,hook,http,boot}.ts`                                            |
| Schemas e regras     | `src/core/schemas/{assignment,team,assignment-actions}.ts`, `src/services/assignment-{delivery,status}.ts` |
| Services             | `src/db/services/{assignment,team}.service.ts`, `src/db/assignment-access.ts`          |
| Rota git do aluno    | `src/pages/git/[token]/[...rest].ts`                                                   |
| Rota git do professor | `src/pages/api/course/[discipline]/[course]/assignment/[slug]/team/[team]/git/[...rest].ts`, `src/api/team-git.ts` |
| REST                 | `assignmentApi` e `teamApi` em `src/api/index.ts`                                      |
| Telas e actions      | `src/pages/[discipline]/[course]/assignments/`, `src/components/assignment/`, `src/actions/assignment.ts` |
| Textos               | `messages/{en,pt-BR}/{assignments,git}.json`                                           |
| Seed                 | `src/db/bootstrap-assignments.ts`, chamado de `src/db/bootstrap.ts`                    |
| Comando de gestão    | `src/commands/prune-team-repositories.ts`                                              |
| CLI                  | `cli/codehood/push/assignment.py`, `cli/codehood/{assignments,submissions}.py`, `cli/codehood/cli/assignment.py`, `cli/codehood/api/teams.py` |
| Documentos           | ADR 0021, glossário (Assignment, Delivery, Team, Team push), README ("Configuration" e "Deploying"), `CHANGELOG.md`, `cli/CHANGELOG.md`, `cli/README.md` |

O playground `src/pages/design/playground/assignments/` foi apagado, como a
T11 mandava.

## Verificações feitas em 2026-11-19

- `pnpm exec biome check --write .` e `pnpm run lint`: saem 0.
- `rtk pnpm test`: unit com 4449 passando; e2e com 1185 de 1186. A falha foi
  em `test/island-conditional-write.spec.ts` (editor de rubrica). Rodado
  sozinho duas vezes, passa.
- `rtk uv run pytest` em `cli/`: 7860 passando e 1 falha em
  `tests/test_hypothesis.py`. Rodado sozinho três vezes, passa.
- As duas falhas apareceram com as duas suítes rodando ao mesmo tempo. A causa
  não foi confirmada.
- Mais tarde no mesmo dia, cada suíte sozinha: `pnpm run lint` sai 0; unit
  com 4453 passando; `uv run pytest` com 7861 passando; e2e com 1185 de 1186.
  A falha foi em `test/exam-code-answer.spec.ts:266` (rascunho de prova em
  duas abas, fora deste trabalho). O arquivo rodado sozinho passa, 21 de 21.
- `pnpm run test:tour`: passa, e alcança as rotas novas como aluno e como
  professor.
- Sessão de terminal de aluno contra o dev server: clone e push funcionam;
  outra branch, force-push, arquivo de 12 MB e push em trabalho encerrado são
  recusados com `remote:`.
- Sessão de terminal do professor: `ch push` cria, mantém com aviso e apaga um
  trabalho; `ch assignment status` e `ch assignment clone` com e sem `--late`
  funcionam.
- Screenshots de 18 estados com o seed em `tmp/assignments-screens/`. Só a
  página do professor foi comparada lado a lado com o protótipo.

Não foram rodados: `pnpm run test:perf`, o CI e `pnpm run release`.

## O que mudou em relação à spec que o professor aprovou

A spec já traz tudo isto. O professor foi avisado, mas não respondeu a nenhum
ponto: se ele discordar de algum, a mudança é localizada.

- `Team.baseSha`: coluna nova com o commit do template. Sem ela, a
  reconciliação criava um push falso para toda equipe semeada.
- O aviso de arquivo obrigatório faltando só aparece depois do primeiro push.
  A spec dizia "em todo estado com equipe".
- Na CLI, `due`, `closes` e `team.lock` exigem hora. Data sem hora viraria
  meia-noite UTC.
- `ch assignment clone --late` usa a entrega atrasada, ou a do prazo quando
  não houve atraso. A spec dizia "a ponta da `main`".
- O comando de limpeza é `prune-team-repositories [--dry-run]`, não
  `assignment:prune`.
- `ch assignment status` não mostra alunos sem equipe: a REST não tem essa
  lista.
- Arquivo "novo", para os limites de tamanho e de caminho, é o que chega no
  push e não era alcançável de nenhuma ref.
- Os globs de `deny` seguem `path.matchesGlob`: `*.zip` não casa `a/b.zip`.
- Trabalho individual é o que tem `teamMax` 1, e o `upsert` recusa trocar
  entre individual e em equipe quando já há equipes.
- A REST responde 200 em todo sucesso, como as rotas vizinhas.

As três decisões que o handoff anterior deixou em aberto foram implementadas
como recomendado: token do membro em texto (R11), trava de equipe por data
(R19), `--drop-assignments` (R35).

## Pendências

1. **Etapas de entrega.** O professor perguntou se os vários prazos do mock
   eram pontos de entrega. Não são: há uma entrega por trabalho, e as datas
   são abertura, trava das equipes, prazo e encerramento. Ofereci desenhar
   entregas parciais como spec separada (várias datas no mesmo trabalho, um
   commit fixado por etapa). Ele ainda não respondeu.
2. ~~Teste que falta para `storage.repositoryRoot` relativo.~~ Feito:
   `test/git-relative-root.spec.ts` faz os pushes num processo filho
   (`test/git-relative-root-child.ts`) com a raiz relativa. Falha quando o
   `path.resolve` de `hooksDirectory` é desfeito.
3. **Cliente gerado da CLI.** O PUT do trabalho, o PATCH de equipe e a
   listagem paginada usam HTTP direto, porque o gerado não serve
   (`team_update` manda `name: null`; `team_list` não aceita `after`). O
   ajuste é em `cli/codehood/api/generate.py`.
4. ~~`TeamService.pushCounts` sem teste unit.~~ Feito: bloco `pushCounts`
   em `test/team-service.spec.ts`.
5. **Desempenho.** O hook lê a lista de objetos do push inteira na memória e
   roda um `diff-tree` por commit. `listWithDeliveries` e `summary` carregam
   todos os pushes do trabalho. Rodar `pnpm run test:perf`.
6. **Proxy de produção.** O README diz o que ele precisa permitir em `/git/`
   e na rota git da API. A configuração mora em `deploy/`, outro repositório,
   e não foi tocada. A imagem de deploy precisa do binário git.
7. ~~Checagem de boot no build.~~ Verificado: `astro build` com um `git`
   que sai 127 no `PATH` termina com 0. A checagem só roda quando o servidor
   sobe.
8. **`pnpm run db:seed:cli` está quebrado** por um motivo anterior
   (`dev/issues/seed-cli-quebra-na-lista-de-edicoes.md`).
9. **Bibliotecas git em TypeScript.** Existem `@fusebit/cloud-git` e
   `chr33s/git`. Nenhuma é madura, e o ADR 0021 registra por que ficou o
   binário. O professor não comentou.

## Ao commitar

Outra sessão trabalha na mesma árvore, em outro assunto (tour das telas,
registro de rotas em `src/urls/`, salvamento de prova). Adicione os arquivos
deste trabalho por nome.

Arquivos com edições das duas sessões, que vão levar os dois trabalhos:
`package.json`, `playwright.config.ts`, `test/env.ts`, `CHANGELOG.md`,
`test/tour/config.ts`.

Não são deste trabalho, pelo que foi possível ver: `AGENTS.md`,
`dev/adr/0022-*.md`, `src/urls/{routes,integration}.ts`,
`test/url-registry.spec.ts`, `test/tour/` (fora o `config.ts`),
`test/tour-routes.spec.ts`, `test/coverage-exit.mjs`, `test/load/`,
`test/perf/routes.ts`, `src/pages/admin/index.astro`,
`src/pages/design/layouts.astro`, `src/utils/admin-tabs.ts` e os issues
`lentidao-na-prova-de-2026-11-18`, `oom-ao-carregar-submissoes-do-curso` e
`seed-sem-chamada-aberta`. Confira com `git diff` antes de decidir: a lista
foi montada pelo nome dos arquivos, não pelo conteúdo.

`package.json` tem duas edições deste trabalho: `db:reset` apaga
`storage/repos`, e o `typecheck` dá 4 GB de heap ao `astro-check`, que passou
dos 2 GB padrão do Node.

## Estado do ambiente

- O dev server roda como daemon em `localhost:4321`, com `dev.db` refeito por
  `pnpm run db:reset` no fim do trabalho. `pnpm exec astro dev stop` o
  derruba.
- Trabalhos do seed em `cs101` (curso corrente de `ada`): `projeto-final`
  (equipes de 2 a 3, com template), `lab-git` e `trabalho-zero`
  (individuais), `projeto-surpresa` (ainda não aberto).
- Contas: `ada`/`ada` (professora); `bob`/`bob` (em equipe e com entrega nos
  três trabalhos visíveis). Os estados sem equipe, equipe incompleta e sem
  repositório aparecem com `student`, `knuth` e `liskov`; a prorrogação, com
  `hamilton` em `lab-git`. As senhas desses estão em `src/db/bootstrap.ts`.
- Chave de API de `ada` para a CLI no dev: `CODEHOOD_TOKEN=dev-ada-cli`.
- Depois de um `db:reset`, reinicie o dev server: ele mantém o banco antigo
  aberto e falha em toda escrita.
