---
type: spec
status: to-do
tags: [repositories, git, blobs, attachments, cli, api, calendar]
relatedTo: [blob-upload-and-gc, resources-on-calendar-events, blob-service, attachment-service, calendar-event-service]
---

# Repositórios

## Contexto

Muitos problemas e exemplos de programação não cabem num arquivo só: um
mini-projeto tem código-fonte, testes, um `README.md` e dados, e às vezes dura
várias aulas ou o curso inteiro. Hoje um `Resource` é um arquivo, um link ou um
trecho de texto, e a CLI achata `resources/lab1/main.py` num recurso
`lab1-main`. O professor precisa publicar uma pasta inteira, corrigi-la ao longo
do semestre, e o aluno precisa baixá-la e receber as correções. Este spec cria o
**Repository**: uma árvore de arquivos versionada que a CLI envia a partir de
`repositories/`, que o aluno clona com `git clone` (e atualiza com `git pull`)
sem configurar nada, ou baixa como zip pela página do curso.

## Glossário

Já adicionados ao `GLOSSARY.md`: **Repository** e **Clone token**. Falta
**Repository** em `cli/GLOSSARY.md` (T9).

## Como funciona o git dumb HTTP

O cliente git clona de um servidor HTTP que só entrega arquivos:

1. `GET <url>/info/refs?service=git-upload-pack`. Resposta `text/plain` (não o
   content-type do protocolo smart) faz o cliente usar o modo dumb. Corpo:
   `<sha1>\trefs/heads/main\n`.
2. `GET <url>/HEAD` → `ref: refs/heads/main\n`.
3. `GET <url>/objects/<2 hex>/<38 hex>`, um por objeto: zlib de
   `"<tipo> <tamanho>\0<conteúdo>"`; o nome é o sha1 desse conteúdo sem
   compressão. O cliente lê o commit, a árvore, as subárvores e os blobs.
4. `GET <url>/objects/info/packs` pode ser vazio.

O servidor gera esses objetos a partir do banco, sem binário git nem
repositório em disco. Cada push que muda a árvore vira um commit filho do
anterior, então `git pull` traz as correções e faz merge com as alterações
locais do aluno.

## Requisitos

### Banco

**R1.** Modelos novos em `prisma/schema.prisma`:

```prisma
/// A versioned file tree a course shares with its students, served as a
/// read-only git repository and as a zip.
model Repository {
  id Int @id @default(autoincrement())

  courseId Int
  course   Course @relation(fields: [courseId], references: [id], onDelete: Cascade)

  /// Natural key: the folder name under `repositories/`.
  slug String

  /// H1 of the root README.md of the head tree, or the slug when there is none.
  title String

  /// Sha1 of the current commit, the target of refs/heads/main. Null until
  /// the first commit: such a repository is invisible to students.
  head String?

  /// Unguessable secret in the clone URL. Knowing it grants read access,
  /// like a blob hash.
  token String @unique

  /// Blob of the cached zip of the head tree, built on the first download
  /// and cleared on every commit.
  zipHash String?

  objects GitObject[]
  events  CalendarEventRepository[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([courseId, slug])
  @@unique([id, courseId])
}

enum GitObjectType {
  COMMIT
  TREE
}

/// A git commit or tree of one repository, stored raw. File contents are
/// not here: they are Blobs, found by Blob.gitSha.
model GitObject {
  repositoryId Int
  repository   Repository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)

  /// Sha1 of the object, header included, as git computes it.
  sha  String
  type GitObjectType

  /// Uncompressed body, without the `<type> <size>\0` header.
  content Bytes

  @@id([repositoryId, sha])
}

/// A repository cited by a lesson. Rebuilt from the lesson's text on every
/// upsert of the event.
model CalendarEventRepository {
  courseId Int

  eventId Int
  event   CalendarEvent @relation(fields: [eventId, courseId], references: [id, courseId], onDelete: Cascade)

  repositoryId Int
  repository   Repository @relation(fields: [repositoryId, courseId], references: [id, courseId], onDelete: Cascade)

  @@id([eventId, repositoryId])
  @@index([repositoryId])
}
```

**R2.** Mudanças em modelos existentes:
- `Blob.gitSha String?` com `@@index([gitSha])`, não único: sha1 git
  (`"blob <size>\0" + bytes`). Dois blobs com o mesmo sha1 (colisão) coexistem;
  ver R14.
- `AttachmentOwner` ganha `REPOSITORY`.
- `CalendarEvent` ganha `@@unique([id, courseId])` e `repositories
  CalendarEventRepository[]`.
- `Course` ganha `repositories Repository[]`.

**R3.** `GitObject` é por repositório (PK `(repositoryId, sha)`): apagar o
repositório leva os objetos em cascata, sem GC, e a URL de um repositório não
alcança objetos de outro. O mesmo vale para os blobs: o sha1 é resolvido só
entre os attachments do repositório, nunca globalmente.

**R4.** `Blob.gitSha` é calculado em todo upload novo. Blobs antigos ficam
null, sem backfill: se a CLI reenviar um arquivo que já existe, a deduplicação
por sha-256 cai no blob existente e preenche o `gitSha`.

### Entidades

**R5.** Schemas em `src/core/schemas/repository.ts`:

```ts
/// Lowercase-hex sha1, as git names objects.
export const gitSha = z.string().regex(/^[0-9a-f]{40}$/);

/// One file of a pushed tree. Directories are implied by the paths.
export const repositoryEntry = z.object({
	path: repositoryPath,
	mode: z.enum(["100644", "100755"]),
	/// Sha-256 of the bytes: the Blob the file points to.
	hash: blobHash,
});

export const repositorySchema = z.object({
	id: repositoryId,
	courseId: courseId,
	slug: slug,
	title: z.string().min(1),
	/// Null before the first commit.
	head: gitSha.nullable(),
	/// Sha1 of the head commit's root tree; the CLI compares it to its own.
	tree: gitSha.nullable(),
	/// Message and date of the head commit.
	message: z.string().nullable(),
	committedAt: z.date().nullable(),
	cloneUrl: z.url(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export const repositoryCreate = z.object({ course: courseRef, slug: slug });

export const repositoryCommit = z.object({
	tree: z.array(repositoryEntry).min(1).max(MAX_REPOSITORY_FILES),
	message: z.string().min(1).nullish(),
});

export const repositoryPK = z.union([
	z.object({ id: repositoryId }),
	z.object({ course: courseRef, slug: slug }),
]);

export const repositoryFilter = z.object({ course: courseRef });
```

`repositoryId` é branded em `src/db/branding.ts`. `zipHash` e `token` cru não
saem no schema: o token só aparece dentro de `cloneUrl`.

**R6.** `repositoryPath` rejeita: caminho absoluto, `\`, NUL, segmento vazio,
`.` ou `..`, segmento `.git` em qualquer caixa, e mais de 255 caracteres.

**R7.** Uma árvore é rejeitada se tiver: caminhos duplicados, caminhos que
diferem só na caixa, um arquivo que também é prefixo de diretório, mais de
`MAX_REPOSITORY_FILES = 2000` arquivos, ou um `hash` que não é blob anexado
ao repositório nem blob existente no servidor.

**R8.** `calendarEventCreate` ganha `repositories: z.array(slug).nullish()`;
`calendarEventSchema` ganha `repositories: { slug, title }[]`. O upsert
substitui todo o conjunto de vínculos; `null`/omitido no update mantém,
`[]` limpa. Slug inexistente no curso é erro de validação.

**R9.** `RepositoryService` (ordem do README dos services):

| Método                           | Comportamento                                                                                                     |
| :------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| `create({course, slug})`         | Repositório vazio (`head` null) com token novo. Erro se o slug existe.                                            |
| `findOne(pk)` / `findMany(f)`    | Com `tree`, `message`, `committedAt` lidos do commit do `head`. Para quem não tem `course.update-contents`, repositórios sem `head` não existem. |
| `update(pk, {})`                 | Sem campos editáveis na v1 (título deriva da árvore); declarado com `never` conforme o README.                    |
| `upsert({course, slug})`         | Cria se não existe, devolve o existente senão. É o passo 1 da CLI.                                                |
| `delete(pk)`                     | Cascata em `GitObject` e vínculos; solta os attachments, cujos blobs ficam coletáveis.                            |
| `addFiles(pk, files)`            | Cria blobs (com `gitSha`) e attachments `REPOSITORY` para os arquivos enviados. Passo 3.                          |
| `commit(pk, {tree, message})`    | Passo 4, ver R10.                                                                                                 |
| `findByToken(token, slug)`       | Resolve a URL git, sem ator; null se token ou slug não batem.                                                     |
| `readObject(repo, sha)`          | Objeto git com cabeçalho, como stream: commit/árvore de `GitObject`, blob do arquivo em disco buscado por `gitSha` entre os attachments do repositório (join). |
| `listDir(pk, path)`              | Entradas de um diretório do `head` (nome, tipo, modo, tamanho).                                                    |
| `readFile(pk, path)`             | Attachment do arquivo no `head` (link, mime, tamanho).                                                             |
| `zip(pk)`                        | Hash do zip do `head`, gerado na primeira chamada (R12).                                                           |
| `rotateToken(pk)`                | Token novo; a URL antiga passa a responder 404.                                                                    |

**R10.** `commit`:
- valida a árvore (R6, R7), anexa ao repositório os blobs existentes no
  servidor que a árvore usa e ainda não são attachments dele;
- monta as árvores e o commit com `src/services/git/` e grava os `GitObject`;
- autor e committer: nome do ator, `<username@codehood>`, data do push;
  mensagem: a recebida ou `Update YYYY-MM-DD`; pai: o `head` atual;
- se o sha da árvore raiz é igual ao do `head`, não cria commit e devolve o
  repositório como está;
- atualiza `head`, `title` (H1 do `README.md` da raiz, ou o slug) e zera
  `zipHash`, soltando o attachment do zip anterior;
- remove os attachments de arquivo que nenhum commit do repositório
  referencia (envios abandonados), exceto o do zip (`zipHash`). Os blobs de versões antigas continuam:
  um aluno numa versão antiga precisa deles para o `git pull`;
- tudo numa transação.

**R11.** `BlobService.missing(hashes)` devolve os sha-256 sem blob vivo.

**R12.** O zip:
- é gerado de forma lazy no primeiro download, escrito em streaming para um
  arquivo temporário (memória constante), registrado como `Blob` com um
  `Attachment` `REPOSITORY`, e apontado por `zipHash`;
- é determinístico: entradas ordenadas, data fixa igual à do commit, raiz
  `<slug>/`, bits de execução preservados; dois primeiros downloads
  simultâneos geram os mesmos bytes e a deduplicação resolve a corrida;
- não conta na cota do professor.

**R13.** Serialização pura em `src/services/git/` (sem banco): `objects.ts`
(sha de blob, árvore e commit; serialização com ordenação git de entradas,
diretórios ordenados como `nome/`; parse de commit e árvore) e `zip.ts`
(escritor de zip em streaming). Os objetos blob do git são servidos com
deflate em streaming a partir do arquivo em disco.

**R14.** Dedupe e lista de faltantes usam sha-256, nunca sha1: o SHA-1 tem
colisão prática e deduplicar por ele deixaria um arquivo forjado se passar pelo
de outro professor. Pelo mesmo motivo `Blob.gitSha` não é único: um blob
colidente subido antes não pode impedir a gravação do arquivo legítimo.

### REST e permissões

**R15.** Upload multipart no registry: `RouteOptions.inMultipart` registra
`multipart/form-data` no OpenAPI; `readMultipart` lê `request.formData()`,
converte `File` em `Buffer` e as partes de texto via `coerceForSchema`. Um
`Content-Length` acima de 16 MB é recusado com 413 antes de ler o corpo. Esta
peça é a mesma prevista em `dev/specs/to-do/blob-upload-and-gc.md`, que passa
a usá-la.

**R16.** Rotas da API (Bearer):

| Método   | Rota                                                  | Service                  | Permissão                |
| :------- | :---------------------------------------------------- | :----------------------- | :----------------------- |
| `GET`    | `/api/course/<d>/<c>/repository`                      | `findMany`               | `course.read-contents`   |
| `GET`    | `/api/course/<d>/<c>/repository/<slug>`               | `findOne`                | `course.read-contents`   |
| `POST`   | `/api/course/<d>/<c>/repository`                      | `create`                 | `course.update-contents` |
| `PUT`    | `/api/course/<d>/<c>/repository`                      | `upsert`                 | `course.update-contents` |
| `DELETE` | `/api/course/<d>/<c>/repository/<slug>`               | `delete`                 | `course.update-contents` |
| `POST`   | `/api/course/<d>/<c>/repository/<slug>/files` (multipart, ≤ 16 MB, uma parte por arquivo, nomeada pelo sha-256) | `addFiles` | `course.update-contents` |
| `POST`   | `/api/course/<d>/<c>/repository/<slug>/commit`        | `commit`                 | `course.update-contents` |
| `POST`   | `/api/course/<d>/<c>/repository/<slug>/rotate-token`  | `rotateToken`            | `course.update-contents` |
| `POST`   | `/api/blob/missing` `{hashes}` → `{missing}`          | `BlobService.missing`    | usuário autenticado      |
| `PUT`    | `/api/course/<d>/<c>/event` (existente)               | ganha `repositories`     | (existente)              |

`missing` é global: saber o sha-256 de um blob já dá acesso a ele em
`/files/<hash>`, então confirmar sua existência não vaza nada novo, e a
deduplicação vale entre turmas. Em `addFiles`, uma parte cujo sha-256 não
bate com o nome é recusada, assim como um arquivo acima de 16 MB.

**R17.** Rotas git, públicas (o token é a credencial):

| Rota                                              | Resposta                                                       |
| :------------------------------------------------ | :------------------------------------------------------------- |
| `GET /git/<token>/<slug>.git/info/refs`           | `text/plain`, `<head>\trefs/heads/main\n`, `no-cache`          |
| `GET /git/<token>/<slug>.git/HEAD`                | `ref: refs/heads/main\n`                                       |
| `GET /git/<token>/<slug>.git/objects/<xx>/<38>`   | Objeto zlib, `application/x-git-loose-object`, `immutable`     |
| `GET /git/<token>/<slug>.git/objects/info/packs`  | Vazio                                                          |

Token inválido, slug que não bate, repositório sem `head` ou objeto inexistente
respondem 404 (nunca 403, para não confirmar que o token existiu). `git`
entra em `RESERVED_SLUGS` no mesmo commit da rota.

**R18.** Zip em `/<course>/repositories/<slug>.zip`, autenticado pela sessão
com `course.read-contents`. A rota envia os bytes ela mesma; o hash do zip
nunca aparece em HTML nem na API.

**R19.** Papel × ação:

| Ação                                     | Anônimo com token | Aluno do curso | Professor do curso | Admin |
| :--------------------------------------- | :---------------: | :------------: | :----------------: | :---: |
| `git clone`, `git pull`                  | ✅                | ✅             | ✅                 | ✅    |
| Baixar zip, ver lista, página, URL       | ❌                | ✅             | ✅                 | ✅    |
| Ver repositório sem commit               | ❌                | ❌             | ✅                 | ✅    |
| Push, apagar, rotacionar token           | ❌                | ❌             | ✅                 | ✅    |

O aluno que sai do curso continua clonando com a URL que tem; o professor
revoga rotacionando o token. Sem permissão nova: reusa `course.read-contents`
e `course.update-contents`.

### Telas

**R20.** Aba "Repositórios" (`/<course>/repositories`), depois de "Agenda",
para que as quatro primeiras abas fiquem nas mesmas posições. Aparece para
quem vê o curso se há algum repositório com commit; para o professor, se há
qualquer repositório. Lista título, data e mensagem do último commit.

**R21.** Página do repositório (`/<course>/repositories/<slug>`): caixa com
`git clone <cloneUrl>` e botão de copiar, botão "Baixar zip", mensagem e data
do último commit, listagem da raiz e `README.md` renderizado abaixo. Sem
commit, o professor vê "Aguardando o primeiro push" e o comando da CLI.
Uma nota curta avisa que, com commits locais, a atualização é
`git pull --no-rebase`.

**R22.** Rota catch-all `/<course>/repositories/<slug>/<path…>`, que decide
pela árvore do `head`:
- diretório: listagem e o `README.md` dele, se houver;
- arquivo: markdown renderizado, código com destaque (`highlightCode`, com a
  linguagem inferida pela extensão numa tabela equivalente à `CODE_LANGUAGES`
  da CLI), imagem inline, outros tipos como link de download;
- texto acima de 1 MB vira só link de download;
- caminho inexistente: 404.

O download de arquivo avulso usa o attachment via `/files/<hash>/<nome>`, como
os recursos `FILE`.

**R23.** Na agenda, o card da aula lista os repositórios vinculados ao lado
dos recursos, com link para a página de cada um.

**R24.** Na página do repositório, o professor tem "Gerar nova URL de clone"
(rotação), com confirmação em formulário, sem diálogo JS.

### CLI

**R25.** `scan_repositories(root, exclude)` (núcleo puro, novo
`cli/codehood/push/repository.py`):
- cada subpasta direta de `repositories/` é um repositório; o slug é o nome
  da pasta, validado pela regra de slug do servidor;
- arquivo solto em `repositories/` é erro;
- produz `RepositoryTree(slug, entries, tree_sha)`, onde cada entry tem
  `path`, `mode`, `sha256`, `git_sha` e `size`, e `tree_sha` é o sha1 da
  árvore git calculado localmente.

**R26.** O scan:
- ignora diretórios `.git`;
- trata symlink como erro;
- omite diretórios vazios;
- aplica os `.gitignore` de dentro da pasta do repositório, em qualquer nível
  (dependência `pathspec`, semântica gitwildmatch com `!`). Os `.gitignore`
  também são publicados. O `.gitignore` da raiz do curso não vale;
- aplica o `[push] exclude` do `codehood.toml` a `repositories/`;
- `100755` vem do bit de execução; no Windows tudo é `100644` (documentado);
- recusa arquivo acima de 16 MB antes de qualquer request.

**R27.** Plano:
- `UpsertRepository(tree, message)` quando o repositório não existe no
  servidor ou o `tree` do servidor difere de `tree_sha`;
- ordem: curso, repositórios, calendário, recursos e questões.

**R28.** Execução de `UpsertRepository`:
1. `PUT …/repository` com `{slug}`;
2. `POST /api/blob/missing`;
3. `POST …/files` em lotes de até 16 MB;
4. `POST …/commit`.

Linha do plano: `repository lab1: 3 files (1.2 MB), commit 4f2a9c1`.

**R29.** Repositório que existe no servidor e sumiu localmente:
- não é apagado; a CLI emite `WarnRepositoryKept`;
- só apaga com `--drop-repositories`, no padrão de `--drop-roll-calls`;
- motivo: apagar mata a URL de clone e o histórico, e recriar a pasta gera um
  histórico sem relação com o antigo, que quebra o `git pull` dos alunos.

**R30.** Links no `calendar.md`:
- link para `repositories/<slug>` ou `repositories/<slug>/<path>` vincula o
  repositório à aula;
- o link é reescrito para a página do servidor (raiz ou caminho);
- slug ou caminho inexistente na árvore local é `ResourceLinkError`;
- um repositório pode estar em várias aulas;
- o evento manda `repositories: [slug]`, e a lista entra no hash do `ref`
  do evento só quando não é vazia, para que os refs atuais não mudem e as
  aulas que já citavam `repositories/` sejam reenviadas.

**R31.** `ch push -m/--message` define a mensagem do commit de todos os
repositórios alterados naquele push. `ch init` cria `repositories/`.
`cli/README.md` documenta a pasta, o `.gitignore`, os links, `-m`,
`--drop-repositories` e o `git pull --no-rebase` do aluno com commits locais.

**R32.** Os testes de sha de árvore, na CLI e no servidor, comparam com o
binário `git` real (`git hash-object`, `git mktree`/`write-tree`). A
mesma tabela de vetores (`test/fixtures/git-vectors.json`, copiada para a CLI)
alimenta os dois lados.

### Dados de dev

**R33.** `src/db/bootstrap.ts` semeia no curso demo `cs101`:
- `lab-calculadora`: dois commits (para testar `git pull`), subdiretórios,
  `README.md` na raiz e num subdiretório, um script `100755`, uma imagem PNG
  e um texto acima de 1 MB; vinculado a duas aulas;
- `exemplos-python`: um commit, sem vínculo com aula (só na aba);
- `lab-futuro`: sem commit (professor vê "Aguardando o primeiro push", aluno
  não vê).

Outro curso demo continua sem repositórios (aba oculta). O seed imprime a
URL de clone de `lab-calculadora`.

## Fora do escopo

- Histórico navegável no site (lista de commits, diff entre versões).
- Packfile para acelerar o clone de repositórios grandes.
- Git autenticado (credencial por aluno) e protocolo smart HTTP.
- Entrega de trabalho de aluno como repositório.
- Repositório oculto/agendado (publicar a solução numa data).
- Symlinks e submodules dentro do repositório.
- Mensagem de commit por repositório num mesmo push.
- Rate limit das rotas git.

## Plano de ação

TDD nas tarefas com regra (T3, T4, T5, T9): um projetista de testes (`opus`)
para a funcionalidade inteira, reaproveitado com `SendMessage`; escritor de
testes (`sonnet`); implementador (`sonnet`) que não edita os testes.

**T1. Upload multipart.** `src/api/registry/route.ts`,
`src/api/registry/crud.ts`, `src/forms/` (se `coerceForSchema` mudar) e
`test/api-multipart.spec.ts`. Cobre R15. Sem dependências. Modelo `sonnet`.
Pronto quando um endpoint de teste recebe partes de arquivo e de texto, o
OpenAPI mostra `multipart/form-data` e um `Content-Length` acima de 16 MB dá
413 sem ler o corpo.

**T2. Banco e schemas.** `prisma/schema.prisma`, `src/db/branding.ts`,
`src/core/schemas/repository.ts`, `src/core/schemas/calendar-event.ts`,
`src/core/schemas/index.ts`, `src/fixtures/repository.factory.ts`. Cobre R1–R3,
R5, R6 e R8 (só schemas). Sem dependências. Modelo `sonnet`. Pronto quando
`pnpm exec prisma db push`, `pnpm run typecheck` e `pnpm run db:reset` saem 0.

**T3. Serialização git e zip.** `src/services/git/objects.ts`,
`src/services/git/zip.ts`, `test/fixtures/git-vectors.json`,
`test/git-objects.spec.ts`. Cobre R13 e R32 (lado servidor). Sem dependências.
Modelo `sonnet`. Pronto quando:
- os shas de blob, árvore aninhada e commit batem com o `git` real;
- a ordenação git de `a.txt`, `a/`, `a-b` está certa;
- o zip é byte-idêntico em duas gerações e abre com `unzip -t`, preservando
  `100755`;
- gerar o zip de 50 MB não aumenta o RSS em mais de 20 MB.

**T4. Services.** `src/db/services/repository.service.ts`, `src/db/index.ts`,
`src/db/services/blob.service.ts` (`gitSha`, `missing`),
`src/db/services/attachment.service.ts` (dono `REPOSITORY`),
`src/db/services/calendar-event.service.ts` (vínculos),
`test/repository-service.spec.ts`. Cobre R4, R7–R12 e R14. Depende de T2 e T3.
Modelo `sonnet`. Pronto quando o spec passa, cobrindo:
- primeiro commit; commit com a mesma árvore não cria commit;
- segundo commit tem o primeiro como pai;
- R7 recusa cada caso da lista;
- arquivo de outro curso já no servidor entra via `missing` sem reenvio;
- attachment enviado e não usado sai no commit; blob de versão antiga fica;
- título vem do H1 do README e cai para o slug;
- aluno não vê repositório sem `head`; aluno não faz push;
- `readObject` não serve blob que não é attachment do repositório;
- `zip` zera no commit e solta o zip anterior;
- `rotateToken` invalida `findByToken`;
- upsert de evento com `repositories` substitui o conjunto, e slug
  inexistente é recusado;
- apagar o repositório remove vínculos e objetos, e o GC recolhe os blobs
  que só ele usava.

**T5. Rotas REST, git e zip.** `src/api/index.ts`, rotas em
`src/pages/git/`, `src/pages/[discipline]/[course]/repositories/[slug].zip.ts`,
`src/urls/constants.ts`, `src/urls/README.md` (tabela de rotas do sistema),
`test/api-repository.spec.ts`, `test/git-clone.spec.ts`. Cobre R16–R19.
Depende de T1 e T4. Modelo `sonnet`. Pronto quando:
- o fluxo upsert → missing → files → commit funciona pela API;
- `git clone` real contra o servidor de teste traz os arquivos e os modos;
- após um segundo commit, `git pull` traz a correção num clone com uma
  alteração local não commitada em outro arquivo, e `git pull --no-rebase`
  faz merge num clone com um commit local (desde o git 2.33, `git pull` sem
  `pull.rebase` configurado aborta com ramos divergentes);
- token rotacionado e slug errado dão 404;
- o zip dá 200 com sessão de aluno do curso e 403/redirect sem sessão;
- o OpenAPI não expõe `token` cru, `zipHash` nem `id`.

**T6. Histórias.** `docs/user-stories/instructor.md`,
`docs/user-stories/student.md`, `test/stories/student-repositories.test.ts`,
`test/stories/instructor-repositories.test.ts`. Depende de T2. Modelo `sonnet`.
Histórias:
- Professor: abre a aba com um repositório sem commit e vê "Aguardando o
  primeiro push"; após o commit (via service), navega até um arquivo de
  subdiretório, gera nova URL de clone e confirma que a URL mudou.
- Aluno: não vê a aba num curso sem repositórios; num curso com repositório,
  segue o link do card da aula na agenda, copia o comando de clone, abre um
  arquivo de código, vê o README de um subdiretório, acessa um caminho
  inexistente (404) e baixa o zip.

Pronto quando os testes falham porque as telas não existem e
`pnpm run stories --check` passa.

**T7. Telas.** `src/utils/course-tabs.ts`,
`src/pages/[discipline]/[course]/repositories.astro`,
`src/pages/[discipline]/[course]/repositories/[slug]/[...path].astro`,
componentes em `src/components/repository/`, o card de aula em
`src/components/schedule/`, as mensagens de i18n. Cobre R20–R24. Depende de T4,
T5 e T6. Modelo `sonnet`. Pronto quando os e2e de T6 passam e há screenshots
da aba, da raiz, de um arquivo de código e do card da aula.

**T8. Seed.** `src/db/bootstrap.ts`. Cobre R33. Depende de T4. Modelo
`haiku`. Pronto quando `pnpm run db:reset` sai 0 e `git clone` da URL impressa
traz `lab-calculadora` com dois commits.

**T9. CLI.** `cli/codehood/push/repository.py`, `plan.py`, `run.py`,
`links.py`, `exclude.py`, `cli/codehood/cli/push.py`, `cli/codehood/repo/`
(`init`), `cli/pyproject.toml` (`pathspec`), o cliente gerado (regenerar do
OpenAPI), `cli/README.md`, `cli/GLOSSARY.md`, testes em `cli/tests/`. Cobre
R25–R32. Depende de T5. Modelo `sonnet`. Lê `cli/CLAUDE.md` e `cli/README.md`.
Pronto quando `rtk uv run pytest` passa, cobrindo:
- o `tree_sha` local bate com o `git` real;
- `.gitignore` aninhado com `!` é respeitado; `.git` ignorado; symlink e
  arquivo solto dão erro;
- árvore igual à do servidor não gera op;
- pasta apagada gera `WarnRepositoryKept`, e com `--drop-repositories` gera
  `DeleteRepository`;
- os lotes respeitam 16 MB;
- link para `repositories/x/a.py` vincula e reescreve, e um caminho
  inexistente dá erro;
- evento sem repositórios mantém o `ref` antigo.

Um push real contra o dev server cria o repositório e um `git clone` dele
funciona.

**T10. Fechamento.** `pnpm exec biome check --write .`, `pnpm run lint`,
testes afetados, seed conferido no dev server, `CHANGELOG.md` (servidor e
CLI), spec movido para `dev/specs/to-review/`. Depende de todas. Feito pelo
coordenador.

Paralelismo: T1, T2 e T3 em paralelo; depois T4 e T6; depois T5 e T8; depois
T7 e T9.

## Critérios de aceite

- `git clone` da URL de `lab-calculadora` no dev server traz a árvore com o
  script executável; um segundo push pela CLI seguido de `git pull` traz a
  correção (saída do terminal).
- Screenshots: aba Repositórios, raiz com README, arquivo de código, card da
  aula com o repositório, tela "Aguardando o primeiro push".
- `pnpm run lint` e os testes de T3, T4, T5, T6 e T9 verdes.
- `ch push --dry-run` mostra a linha do repositório e o `WarnRepositoryKept`
  quando a pasta some.
