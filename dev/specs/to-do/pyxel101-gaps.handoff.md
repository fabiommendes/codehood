---
type: handoff
status: to-do
tags: [seed, gaps, cli, push, resources, questions, calendar]
relatedTo: [seed-cli-pyxel101, push, push-exams]
---

# Handoff: fechar as lacunas do curso `pyxel101`

## Onde estamos

O commit `30df063` criou o curso `cli/seed/pyxel101/` e o comando
`pnpm run db:seed:cli`, que sobe o curso com `ch push` como `ada` (spec em
`dev/specs/to-review/seed-cli-pyxel101.md`). As lacunas que sobram estão em
`cli/seed/GAPS.md`. Cada linha diz o arquivo do curso que exercita a lacuna,
o esperado, o observado e quem precisa mudar.

Último push medido (2026-11-03, no servidor de rascunho): `131 operation(s)
executed, 0 failed`. O segundo push executa 0 operações.

Ao fechar uma lacuna: tire a linha do `GAPS.md` (ou aponte o estado para a
issue ou spec), suba o curso e atualize a linha "Último push medido". Se o
curso tinha um contorno para a lacuna (exclusão no `codehood.toml`, arquivo
renomeado), desfaça-o.

**Nada da sessão de 2026-11-03 foi commitado.** O `git status` mostra cerca
de 90 arquivos, entre servidor e `cli/`. Pergunte ao humano antes de
commitar: os commits vão direto para `main`, e ele pode querer separar o
trabalho em vários commits (G1; lote rápido; G17 `HIDDEN`; G15/G3/G4/G26;
G28/G29/G20).

## Feito em 2026-11-03

Cada item está no `CHANGELOG.md` da raiz ou em `cli/CHANGELOG.md`, e as
regras novas estão no mapping doc (`cli/docs/design/mapping-local-filesystem.md`).

- **G1**: o `FILE` referencia o blob por hash, e os bytes vão no mesmo
  `PUT`/`POST`/`PATCH`, em multipart (`inMultipart: "json"`), quando faltam
  (ADR 0011). O limite de taxa ficou em `dev/issues/limite-de-taxa-nos-uploads.md`.
- **G2, G5, G6, G16, G16b, G18**:
  - `.url` vira `LINK`;
  - `info.yaml` é metadado da pasta;
  - título vem do nome do arquivo;
  - slug sem acento;
  - `id:` define o slug da questão;
  - provas com `start`/`duration`.
- **G17**: status novo `HIDDEN` em `QuestionStatus`, servidor e web. O push só
  avança `DRAFT` → `PUBLISHED` → `HIDDEN`: `_` no arquivo ou numa pasta é
  rascunho e fica fora do slug, e uma questão oculta ou publicada pela web
  continua assim. O botão da tabela de questões vai de Publicada para Oculta
  e volta, e não arquiva mais.
- **G15**: questão inválida vira `RejectQuestion`, falha sozinha e não poda
  a cópia do servidor; o push sai com código 1.
- **G3**: falha no upload de recurso diz qual aula fica com link quebrado.
- **G4**: links e imagens relativos dentro de MD são reescritos para os
  recursos no servidor (`links.rewrite_body_links`).
- **G26**: a descrição do curso é o 1º parágrafo do README, ou `description`
  em `[course]` no `codehood.toml`. O README inteiro sobe como o recurso MD
  `readme` quando tem mais que esse parágrafo.
- **G28**: slug de recurso que não é Markdown mantém a extensão
  (`semana-10-aabb.py`, `semana-10-aabb.png`). O curso voltou a usar
  `aabb.png`.
- **G29**: o curso leva um `rev` (`plan.course_ref`) e não sobe sem mudança.
- **G20**: `## ~~Título~~` no `calendar.md` é aula cancelada, enviada como
  `CANCELLED`; o push nunca desfaz um cancelamento. A aula 5 do curso usa a
  marca.

## Próximos passos, na ordem combinada

Cada um é discutido com o humano antes de codar.

1. **G19** (desenho): o horário de atendimento recorrente gasta uma seção
   `##` por ocorrência (14 seções "Atendimento" no `calendar.md`). É a última
   lacuna de desenho. Ideia a levar: uma marca na entrada do `days:` que gera
   os eventos daquele horário sem consumir seções, com o título do horário.
   Leia `codehood/push/calendar.py`, `allocate`, antes de propor o formato.
2. **G10 com G13 e G25** (CLI, spec pronta em
   `cli/dev/specs/to-do/push-exams.md`):
   - G10 é o push de provas e quiz.
   - G13 liga a prova ao evento da aula e corrige o fuso do `start` (a spec
     lê `start` sem fuso como UTC, e a prova cairia 3h antes).
   - G25 é a regra de aprovação no `codehood.toml`.
   - O G24 (presença no `grades.py`; o servidor já tem `Attendance`) é só CLI
     e pode entrar junto.
   - As questões de `questions/código/` continuam excluídas no
     `codehood.toml` por causa do G14. Sem a exclusão, cada uma falharia
     sozinha, mas o `db:seed:cli` sairia com código 1.
3. **As que pedem funcionalidade nova no servidor**:
   - recursos: G7 (HTML isolado), G8 (visibilidade agendada), G9 (recurso
     em duas aulas);
   - provas: G11 (sorteio e penalidade), G12 (liberação do gabarito);
   - entregas e projeto: G21 (entrega por git), G22 (atraso com desconto),
     G23 (grupos e rubrica);
   - G27 (avisos) e G14 (questão de código, no `mdq`).

   Combinado: não implementar agora. Elas viram itens no `ROADMAP.md` ou
   issues em `dev/issues/`, e o `GAPS.md` passa a apontar para eles. Várias
   já têm issue (ver a coluna "Estado").

## Cuidados práticos

- **Idioma.** Fale com o humano em português, mesmo depois de longos trechos
  de código em inglês.
- **Dev server do humano (4321).** Na sessão anterior ele já não respondia, e
  depois disso o client do Prisma e as mensagens foram regenerados. Ele
  precisa ser reiniciado, e o `dev.db` precisa de `prisma db push` por causa
  do `HIDDEN`. Não rode `pnpm run db:reset` nem `pnpm run lint` sem avisar.
- **Prisma client.** Depois de mudar o schema, rode `pnpm exec prisma generate`
  **e** `node --import tsx scripts/brand-generated-types.ts`, que é o
  `pnpm run db:generate`. Sem o segundo passo, o `tsc` acusa dezenas de erros
  de IDs com marca de tipo.
- **Mensagens.** `node --import tsx scripts/compile-messages.ts` antes do
  `tsc` quando mexer em `messages/*/*.json`.
- **OpenAPI e cliente da CLI.**
  `ENVIRONMENT=dev node --import tsx test/.tmp/gen-openapi.ts cli/resources/openapi/codehood.json`
  e, em `cli/`,
  `uv run python -m codehood.api.generate resources/openapi/codehood.json codehood/api/generated.py`.
  O gerador sem argumentos tenta baixar de um servidor rodando.
  `test/.tmp/gen-openapi.ts` é um script temporário, fora do git: se sumir,
  ele só importa `@/api` e grava `buildOpenApiDocument()` em JSON.
- **ruff format.** Formate só os arquivos que mudou. Rodar em `cli/tests` ou
  em `cli/codehood` inteiros reformata cerca de 29 arquivos que já estavam
  fora do padrão.
- **Servidor de rascunho (4330).** `test/.tmp/t6/up.sh <comando>` sobe o
  build em `localhost:4330` com o banco `test/.tmp/t6/dev.db` e roda
  `<comando>` no mesmo shell. Refaça o build se o servidor mudou:
  `node_modules/.bin/astro build --outDir test/.tmp/t6/dist`. Para subir o
  curso: `node --import tsx scripts/seed-cli.ts --url http://localhost:4330`.
  Para recriar o banco:
  `DATABASE_URL="file:$PWD/test/.tmp/t6/dev.db" ENVIRONMENT=dev pnpm exec prisma db push --url "$DATABASE_URL"`
  e depois `node --import tsx prisma/seed.ts` com as mesmas variáveis. Para
  ver páginas logado: `POST /login?_action=auth.login` com `login=ada`,
  `password=ada` e `Origin`, guardando o cookie (`curl -c`).
- **`tsx` no sandbox.** O `tsx` direto falha com `listen EPERM`. Use
  `node --import tsx <arquivo>`. `pnpm test` roda fora do sandbox.
- **Testes.** No último `pnpm test` completo (depois do G17), 2359 passaram
  e 2 falharam: `test/openapi.spec.ts:39` e `test/schemas-browser-safe.spec.ts:6`
  (`TextEncoder is not defined`), as mesmas de antes da sessão. A CLI estava
  com 875 testes passando. Do G15 em diante só a CLI mudou; a suíte do
  Playwright não foi rodada de novo.
- **`cli/uv.lock`.** Fica fora do commit até o humano decidir. O `uv`
  reescreve o arquivo a cada `uv run` (extra `html` no `mdq` vizinho). Não
  use `git stash` em volta de `uv run`: o `pop` aborta.
- **Subtree.** `cli/` vai para o `codehood-cli` no próximo
  `git subtree push`, que só roda quando o humano pedir.
