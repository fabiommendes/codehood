---
type: handoff
status: to-do
tags: [deploy, ops, observability, validation, questions]
relatedTo: [log-de-erros-no-servidor-e-no-cliente, validar-json-do-banco-antes-do-deploy]
---

# Handoff: depois do deploy da 0.3 em codehood.dev

## Onde estamos

Produção (`codehood.dev`, VPS em `deploy/inventories/prod.yml`) roda a
**v0.3.2** desde 2026-11-05. Árvore limpa, `main` e as tags `v0.3.0` a
`v0.3.2` no origin. O repositório `deploy/` tem um commit local (`5d9be2f`,
IP da VPS no inventário) que **não foi enviado** ao origin.

## O que aconteceu

1. **v0.3.0** (2026-11-04): primeiro deploy desde a 0.2.0, 104 commits. Antes
   dele entraram duas correções: um 500 não mostra mais a mensagem da exceção
   em produção, e há no máximo 2 uploads multipart por usuário e 6 por servidor
   (`src/utils/concurrency.ts`). Detalhes no `CHANGELOG.md`.
2. Depois do deploy, o instrutor via 500 na home, na home da disciplina e no
   banco de questões. Causa: o commit `0054708` mudou o formato de
   `QuestionData.privatePayload` (de complemento da parte pública para
   documento inteiro) e o spec mdq (`preamble`, `input`, `oneOf`), sem
   converter os dados. O `returns:` de `db.question.findMany` recusava as 105
   versões. O ensaio do deploy não pegou porque só aplica SQL.
3. **v0.3.1**: `codehood-manage upgrade-questions [--dry-run]`
   (`src/mdq/legacy.ts`, `QuestionService.upgradeLegacyVersions`). Junta as
   metades e mapeia `preamble` para o início do `stem`, `input` para `content`
   e `oneOf` para `accept`. Também acrescenta `+from-0.2` ao `versionHash`:
   o rótulo é o md5 do arquivo, e sem a troca o próximo push do arquivo
   inalterado daria 409. Uma URL de chamada com `timeSlot` inválido passou a
   dar 404.
4. **v0.3.2**: o `codehood-manage` inteiro quebrava em produção desde a 0.3.0
   (`Cannot find package 'mdq'`, porque o `mdq` é devDependency). O
   `scripts/build-manage.ts` agora deixa externas só as `dependencies`, e o
   teste `test/build-manage.spec.ts` confere isso.
5. O upgrade rodou no servidor: 105 versões convertidas, e a segunda execução
   não acha nada. Antes disso, o crawler sobre a cópia do banco tinha passado
   por 130 páginas do instrutor sem 5xx.

## Pendente

- **Confirmar com o humano** que as páginas do instrutor carregam em
  produção. A verificação logada foi feita só na cópia do banco.
- O primeiro `ch push` do curso `paradigmas` vai gravar uma versão nova de
  cada questão (por causa do `+from-0.2`). É esperado; confira que termina
  sem 409.
- Enviar o commit do `deploy/` (`git -C deploy push`), se o humano quiser.
- Duas issues abertas pelo humano, ainda sem desenho:
  - `dev/issues/validar-json-do-banco-antes-do-deploy.md`: comando que valida
    toda coluna `Json` contra o schema da sua forma armazenada, rodando no
    `--rehearse` do `pnpm run package`. Recomendação: fazer esta primeiro, é
    menor e fecha o buraco do incidente. O backup
    `deploy/backups/codehood/pre-deploy/codehood-0.3.0-20261104T160417Z.db`
    é um caso real (as 105 questões no formato 0.2).
  - `dev/issues/log-de-erros-no-servidor-e-no-cliente.md`: log de exceções
    do servidor e do cliente, algo como o Sentry, mais leve. Desenhar com a
    skill `new-feature`.
- Continua aberta a issue `dev/issues/limite-de-taxa-nos-uploads.md`: falta
  checar a permissão antes de ler o corpo.

## Notas de operação

- `pnpm test`, `pnpm run typecheck` e tudo que passa pelo CLI do `tsx`
  falham dentro do sandbox do Bash (o `tsx` abre um socket Unix). Rode fora
  do sandbox ou com `node --import tsx`.
- Não pule o `astro-check`: ele pegou um erro de tipo nas páginas `.astro`
  que o `tsc` não vê, e isso custou um ciclo de release. `biome check --write`
  com um caminho que contém `[...]` não formatou os arquivos; passe o
  diretório entre aspas e rode `biome ci .` antes de commitar.
- Cada `pnpm run release` leva uns 7 minutos (lint e suíte inteira). Rode
  `pnpm run lint` antes, para não perder um ciclo por formatação.
- Para reproduzir um bug de produção: copie um snapshot de
  `deploy/backups/codehood/pre-deploy/`, rode `prisma migrate deploy` nele,
  faça o build em `test/.tmp/<dir>/dist` e suba com `ENVIRONMENT=prod` numa
  porta livre (ver a memória `second-server-instance`). Crie a sessão com
  `db.session.create`. Apague as cópias do banco ao terminar: elas têm dados
  de alunos.
- O servidor não guarda log de acesso (o Caddy não registra). Para achar a
  URL de um 500, hoje só há o stack trace no `journalctl -u codehood`.
