---
type: spec
status: to-review
tags: [course, settings, enrollment, invite, passphrase, cli, instructor]
relatedTo: [course-tabs-nav, roster, sync-bidirecional]
---

# Configurações do curso

## Contexto

O professor não tem um lugar para ver os dados do curso nem para controlar
como os alunos entram nele. A passphrase, o link de convite e a revogação de
convites ficam em três dialogs no roster, misturados com a lista de alunos.
Os dados do curso (descrição e datas) só aparecem para quem abre os arquivos
na CLI. A página de configurações reúne essas coisas e é ligada pelo card do
curso na sidebar da home, ao lado de Relatos.

## Requisitos

### Banco e entidades

- R1. Nenhuma mudança no schema Prisma nem nos services. `Course`,
  `Passphrase` e `Invite` já cobrem o escopo.
- R2. Nenhuma rota REST nova e nenhuma Action nova: a página usa
  `course.generatePassphrase`, `auth.createClassroomInvite` e
  `admin.revokeInvite`, que o roster já usa.

### Permissões

- R3. A página exige `enrollment.manage` (`loadCourse(..., { manage: true })`),
  como o roster. Um aluno, outro docente ou um admin que não é dono do curso
  recebem a mesma resposta que recebem hoje no roster.

### Telas e fluxos

- R4. Rota `<curso>/settings`, título "Configurações" / "Settings". Não é uma
  aba: a faixa marca Início como aba atual, e o card do curso mostra a aba
  Início (`TAB_OF_PAGE` em `src/layouts/AppLayout.astro`).
- R5. `homeNav` (`src/utils/course-tabs-nav.ts`) liga Relatos e
  Configurações, nessa ordem. O card aparece na home do professor, em
  `/reports` e em `/settings`.
- R6. Seção "Curso", só leitura: disciplina (slug e nome), edição, docente,
  início, fim e descrição. Cada campo diz de onde vem:
  - descrição: `README.md` do repositório do curso;
  - início e fim: `calendar.md`;
  - disciplina, edição e docente: fixados na criação do curso.
  Descrição vazia mostra um texto de ausência, não some.
- R7. Seção "Entrada na turma", com o que sai do roster:
  - passphrase atual (valor e validade), com os formulários de gerar uma nova
    e de definir uma personalizada;
  - gerar link de convite da turma (com limite de usos opcional) e mostrar o
    link gerado com botão de copiar;
  - lista dos convites da turma, cada um com data de criação, usos/limite,
    validade (expirado em vermelho) e botão "Revogar". Sem convites, um texto
    de ausência.
  Esses blocos ficam na página, não em dialogs.
- R8. Seção "CLI": o comando `codehood init` com `--discipline`,
  `--instructor`, `--edition` e `--server` preenchidos para este curso
  (`--server` é a origem da instância), e `codehood login`, cada um com botão
  de copiar, mais o link para `/getting-started`.
- R9. O roster perde os botões e dialogs de passphrase, link de convite e
  revogação, e o tratamento do POST de convite. Fica com "Adicionar
  estudante", a lista e o CSV, e ganha uma linha que leva a Configurações
  para passphrase e convites.
- R10. Erros e confirmações das três ações aparecem na página de
  configurações, como apareciam no roster (`FormAlert`, alerta de sucesso na
  revogação).

### CLI

- R11. Nada muda em `cli/`.

### Dados de dev

- R12. `src/db/bootstrap.ts` semeia, no curso `cs101/ada_2026-2`, um convite
  de turma ativo com limite de usos e um convite expirado. O curso já tem
  descrição e datas. A passphrase não é semeada: vive 5 minutos, então o
  estado "sem passphrase" é o que o seed alcança, e gerar uma é um clique.

## Fora do escopo

- Editar descrição e datas pela web. A CLI ainda não manda `If-Match` e o
  próximo `push` sobrescreveria a edição. Entra quando o sync bidirecional
  chegar à CLI.
- Gerar de novo os clone tokens de todos os repositórios de uma vez.
- URL do calendar feed do curso.
- Encerrar ou apagar o curso.

## Plano de ação

- T1. Histórias e e2e (`sonnet`). Lê `test/stories/README.md` e
  `docs/user-stories/README.md`. Escreve em `docs/user-stories/instructor.md`
  a história "configurar a entrada na turma" e em
  `test/stories/instructor-course-settings.test.ts` um teste que percorre:
  acesso negado ao aluno, card da home leva a Configurações, seção Curso com
  as fontes, passphrase personalizada inválida e depois válida, link de
  convite gerado, revogação de um convite, comando `codehood init` com os
  valores do curso. Ajusta `test/stories/instructor-enrollment.test.ts` e
  `test/stories/student-joining-the-platform.test.ts`, que hoje abrem os
  dialogs do roster, para ir a `/settings`. Pronto: os testes novos falham
  porque a página não existe; `pnpm run stories --check` passa.
  Requisitos: R3 a R10.
- T2. Página e navegação (`sonnet`, depende de T1). Arquivos:
  `src/pages/[discipline]/[course]/settings.astro`,
  `src/pages/[discipline]/[course]/roster.astro`,
  `src/utils/course-tabs-nav.ts`, `src/layouts/AppLayout.astro`,
  `src/utils/breadcrumbs.ts` (rótulo do crumb), `messages/*/`,
  `test/course-tabs-nav.spec.ts`. Lê `src/urls/README.md` e
  `dev/adr/` sobre forms. Pronto: os e2e de T1 passam sem edição.
  Requisitos: R2 a R10.
- T3. Seed (`haiku`, independente). Arquivo: `src/db/bootstrap.ts`. Pronto:
  `pnpm run db:reset` e a página mostra passphrase, convite ativo e
  expirado. Requisito: R12.
- T4. Fechamento (coordenador). `biome check --write`, `pnpm run lint`,
  `pnpm test`, conferência no dev server, spec para `to-review`, changelog.

## Critérios de aceite

- Screenshot de `/settings` com as três seções e os dados do seed.
- Screenshot do roster sem os dialogs.
- `pnpm test` verde, com `instructor-course-settings.test.ts`.
