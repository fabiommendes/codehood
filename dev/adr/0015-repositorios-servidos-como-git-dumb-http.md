---
type: adr
status: accepted
tags: [repositorios, git, blobs, cli, rest, seguranca]
relatedTo: [0010-blobs-publicos-e-permanentes, 0011-contrato-de-sync-entre-cli-e-servidor, 0012-conteudo-no-repositorio-dados-do-aluno-no-servidor]
created: 2026-11-17
creator: claude
---

# Repositórios servidos como git dumb HTTP gerado do banco

Um `Repository` é uma árvore de arquivos versionada que a CLI envia a partir de
`repositories/<slug>/`. O aluno clona com `git clone` e atualiza com
`git pull`, sem configurar nada, ou baixa um zip pela página do curso.

## Decisão

- **Git dumb HTTP gerado do banco.** O servidor responde `info/refs`, `HEAD`,
  `objects/<xx>/<38>` e `objects/info/packs` (vazio) em
  `src/pages/git/[token]/[...rest].ts`, gerando os objetos a partir do banco.
  Não há binário git nem repositório em disco. Commits e árvores ficam em
  `GitObject`; o conteúdo dos arquivos são os `Blob`s, achados por
  `Blob.gitSha`. A serialização pura fica em `src/services/git/`. Cada push
  que muda a árvore vira um commit filho do anterior, então `git pull` traz as
  correções e mescla com as alterações locais do aluno. Protocolo smart,
  packfile e credencial por aluno ficam de fora.
- **Dedupe por sha-256, nunca sha1.** `BlobService.missing` e a deduplicação
  usam sha-256. O SHA-1 tem colisão prática: deduplicar por ele deixaria um
  arquivo forjado se passar pelo de outro professor. Pelo mesmo motivo
  `Blob.gitSha` tem índice, mas não é único: um blob colidente enviado antes
  não pode impedir a gravação do legítimo.
- **Objetos por repositório.** A PK de `GitObject` é `(repositoryId, sha)` e o
  sha1 de um blob só é resolvido entre os attachments do próprio repositório.
  A URL de um repositório não alcança objetos de outro, e apagar o repositório
  leva os objetos em cascata, sem GC.
- **O token é a credencial, e toda falha é 404.** As rotas git são públicas; o
  token na URL dá acesso de leitura, como o hash de um blob (ADR 0010). Token
  inválido, slug errado, repositório sem commit ou objeto inexistente
  respondem 404, nunca 403, para não confirmar que o token existiu. O aluno
  que sai do curso continua clonando; o professor revoga rotacionando o token.
- **Pasta apagada só avisa.** Repositório que existe no servidor e sumiu do
  disco gera `WarnRepositoryKept`; só é apagado com `--drop-repositories`.
  Apagar mata a URL de clone, e recriar a pasta gera um histórico sem relação
  com o antigo, que quebra o `git pull` dos alunos.
- **Versões antigas ficam.** O commit remove só attachments que nenhum commit
  referencia. Um aluno numa versão antiga precisa dos blobs dela para o
  `git pull`.
- **Limites nos schemas.** `MAX_UPLOAD_BYTES` (16 MB) em
  `src/core/schemas/blob.ts`, `MAX_REPOSITORY_FILES` (2000) e
  `MAX_REPOSITORY_PATH` (255) em `src/core/schemas/repository.ts`. Os schemas
  não importam `src/core/constants.ts`, que lê o ambiente.
- **Multipart limitado contando bytes.** `Content-Length` acima do limite dá
  413 sem ler o corpo. Sem `Content-Length`, o corpo é lido contando bytes e
  aborta com 413 ao passar do limite (`src/api/registry/multipart.ts`), em vez
  de exigir o cabeçalho com 411.
- **Zip sem zip64.** Gerado no primeiro download, em streaming, determinístico
  (entradas ordenadas, data do commit, raiz `<slug>/`), guardado como blob e
  invalidado a cada commit. Sem zip64: o escritor (`src/services/git/zip.ts`)
  falha acima de 4 GiB ou 65535 entradas, o que os limites acima já evitam.

## Consequências

- Os testes de sha de árvore, no servidor e na CLI, comparam com o binário
  `git` real usando a mesma tabela de vetores
  (`test/fixtures/git-vectors.json`, copiada para a CLI).
- Com commits locais, o aluno atualiza com `git pull --no-rebase`.
- Sem rate limit nas rotas git.
