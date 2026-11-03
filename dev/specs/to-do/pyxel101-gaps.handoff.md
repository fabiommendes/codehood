---
type: handoff
status: to-do
tags: [seed, gaps, cli, push, resources, blobs]
relatedTo: [seed-cli-pyxel101, push, recurso-file-pede-buffer-em-rota-json]
---

# Handoff: fechar as lacunas do curso `pyxel101`

## Onde estamos

O commit `30df063` criou o curso `cli/seed/pyxel101/` e o comando
`pnpm run db:seed:cli`, que sobe o curso com `ch push` como `ada`. A spec
está em `dev/specs/to-review/seed-cli-pyxel101.md`. As lacunas medidas no
último push (`186 operation(s) executed, 32 failed, 0 skipped, 5 excluded`)
estão em `cli/seed/GAPS.md`, de G1 a G29. Cada linha diz o arquivo do
curso que exercita a lacuna, o esperado, o observado e quem precisa mudar.

Ao fechar uma lacuna: tire a linha do `GAPS.md` (ou aponte o estado para a
issue ou spec), rode `pnpm run db:seed:cli` e atualize a linha "Último push
medido". Se o curso tinha um contorno para a lacuna (exclusão no
`codehood.toml`, arquivo renomeado), desfaça-o.

## Ordem combinada com o humano

1. **G1**, upload de recursos `FILE`. Sozinho resolve 26 das 32 falhas.
2. **As rápidas**, só CLI, num lote: G2, G5, G6, G16, G16b, G18.
3. **As outras**, uma a uma, discutindo cada uma com o humano antes.

### 1. G1: recursos `FILE`

- Problema e proposta: `dev/issues/recurso-file-pede-buffer-em-rota-json.md`
  e `cli/ROADBLOCKS.md` (1ª entrada). A rota REST de recurso pede `buffer`
  num corpo JSON (`src/core/schemas/resource.ts`, `resourceFileDataCreate`),
  e nenhum corpo JSON consegue entregar isso.
- O que já existe: `src/api/registry/multipart.ts` (`readMultipart`) e o
  par `missing` + `addFiles` dos repositórios (`src/api/index.ts`, perto de
  `repositoryAddFiles`). Leia o ADR 0011
  (`dev/adr/0011-contrato-de-sync-entre-cli-e-servidor.md`) antes de
  escolher entre referenciar um blob por hash e um ramo multipart na rota do
  recurso. A issue sugere o hash.
- Lado da CLI: `cli/codehood/push/run.py`, `_run_upsert_resource`, tem um
  ramo `FileData` que hoje recusa com `blocked`. `FileData` já carrega
  `blob` e o `ref` já usa o sha256 dele (`push/resource.py`, `_data_payload`).
- Pronto quando: `pnpm run db:seed:cli` sobe os 12 PNG, os 13 PDF e o
  `.pyxres`, e o segundo push não replaneja nenhum deles. Teste REST de
  ponta a ponta no servidor e teste no `cli/tests/test_push_run.py`. A
  entrada do `cli/ROADBLOCKS.md` e a issue saem.
- Os 6 `.url` continuam falhando até G2.

### 2. Lote de rápidas (CLI)

| G | O quê | Notas |
| :-- | :-- | :-- |
| G2 | `.url` vira `LINK` | Formato no mapping doc (`cli/docs/design/mapping-local-filesystem.md`, "LINK"): text/uri-list, 1º URI é o link, 1º comentário é o título, os seguintes a descrição. O servidor já aceita `LINK` (`resourceLinkData`, só `http(s)`). Comentário em `push/resource.py:133` e item "Resource manifest" do `cli/BACKLOG.md` |
| G5 | `info.yaml` não é recurso | Decisão pendente: o mapping doc define `info.yaml`, e o `cli/BACKLOG.md` propõe `resources.toml`. Recomendação: ficar com `info.yaml` e tirar a proposta do BACKLOG. Confirme com o humano. Ler `title`, `description`, `language` e `mime` |
| G6 | Título de recurso sem título | Fallback do mapping doc: nome do arquivo em title case, separando hífen, sublinhado e camel case |
| G16 | Slug translitera acentos | Mesma regra de `src/utils/slugify.ts`: NFKD e remover combinantes antes do regex de `push/resource.py::slugify`. Não translitere `ß`, `æ`, `ø`, para ficar igual ao servidor. Sem migração: o push arquiva `la-os-*` e cria `lacos-*`, o que está aceito |
| G16b | `id:` define o slug da questão | `push/question.py` (`slug = slugify(rel_path)`) |
| G18 | `ch init` gera provas com `start`/`duration` | `cli/codehood/repo/_layout.py`; atualizar também `cli/tests/examples/*/exams` |

Depois do lote, o curso pode passar a usar `id:` (G16b) e o push deve ter
0 falhas.

### 3. As outras

Cada uma é discutida com o humano antes. Algumas pedem spec própria (`new-feature`). As
marcadas "por desenho" no `GAPS.md` (G20, G28, G29) começam por decidir se o
mapping doc muda. Antes do G17, veja o commit `1de67dd` ("settle exam and
question status ownership"), que pode já ter decidido o status das questões.

## Cuidados práticos

- **Dev server do humano.** Ele roda em `localhost:4321`. Não rode
  `pnpm run db:reset` nem `pnpm run lint` sem avisar: o reset deixa o server
  em "readonly database" até reiniciar, e o lint (`astro-check`,
  `compile-messages`) o trava.
- **Servidor de rascunho.** `test/.tmp/t6/up.sh <comando>` sobe um build em
  `localhost:4330` com o banco `test/.tmp/t6/dev.db` e roda `<comando>` no
  mesmo shell, porque cada comando no sandbox tem seu próprio loopback.
  Antes, refaça o build (`node_modules/.bin/astro build --outDir test/.tmp/t6/dist`)
  se o servidor mudou. Para recriar o banco:
  `DATABASE_URL="file:$PWD/test/.tmp/t6/dev.db" ENVIRONMENT=dev pnpm exec prisma db push --url "$DATABASE_URL"`
  e depois `node --import tsx prisma/seed.ts` com as mesmas variáveis. Para
  subir o curso: `node --import tsx scripts/seed-cli.ts --url http://localhost:4330`.
- **`tsx` no sandbox.** O `tsx` direto falha com `listen EPERM` (socket IPC).
  Use `node --import tsx <arquivo>`. `pnpm test` precisa rodar fora do
  sandbox.
- **Testes do Playwright.** No último `pnpm test`, 2352 passaram e 2 falharam
  em `test/openapi.spec.ts:39` e `test/schemas-browser-safe.spec.ts:6`
  (`TextEncoder is not defined`). Nenhum dos dois toca o seed, mas não foi
  confirmado que já falhavam antes do `30df063`.
- **`cli/uv.lock`.** Ficou fora do commit. Ele mudou por causa do extra
  `html` no pyproject do `mdq` vizinho, e o `uv` reinstala um pacote a cada
  `uv run` até alguém commitá-lo.
- **Subtree.** `cli/seed/` vai para o `codehood-cli` no próximo
  `git subtree push`, que só roda quando o humano pedir.
