---
type: spec
status: to-do
tags: [repositories, git, api, tdd]
relatedTo: [repositories]
---

# Repositórios: contrato do servidor (T1, T3, T4)

Complementa `dev/specs/to-do/repositories.md`. T2 já está feito (schema
Prisma, branding, schemas, fixture). Os stubs abaixo lançam
`Error("not implemented")`; as assinaturas e os doc comments são o contrato.
O tester escreve contra eles, o implementer preenche os corpos e não muda
assinaturas sem combinar.

## Como os testes rodam

- Playwright, mesmo para testes de unidade: `test`/`expect` de
  `@playwright/test`, um arquivo `test/<nome>.spec.ts`.
- `rtk pnpm exec tsx test/run.ts test/<nome>.spec.ts` roda um arquivo.
  `test/run.ts` recria o banco de teste, faz `db push`, roda o seed e sobe o
  servidor (`astro build` + node) em `test/.tmp/<porta>/`.
- Um worker só, banco compartilhado entre arquivos: gere slugs e usernames
  com sufixo aleatório (`tag()` em `test/blob-service.spec.ts`) e não conte
  linhas globais.
- Testes de service chamam o service direto no processo do teste:
  `db.<service>.<método>(..., { actor })`. Modelos: `test/blob-service.spec.ts`
  (service isolado com raiz própria: `new BlobService(prisma, { root })`, raiz
  sob `TEST_RESOURCE_ROOT` de `test/env.ts`) e
  `test/attachment-service.spec.ts` (`db.*`, curso compartilhado em
  `beforeAll`, edição com slug aleatório).
- Atores: `FULL_ACCESS` (`@/auth/actor`) para setup; usuários reais com
  `persistedUserFactory` ou `db.user.create`; o professor do curso é o
  `instructor` passado a `persistedCourseFactory`; aluno via
  `persistedCourseFactory.create({...}, { transient: { students: 1 } })`
  (devolve `students`).
- Oráculo git (R32): o binário `git` real via `node:child_process`
  (`git hash-object --stdin`, `git mktree`, `git commit-tree`,
  `git cat-file`), num diretório temporário sob `test/.tmp/`.

## Fixtures

- `src/fixtures/repository.factory.ts`:
  - `persistedRepositoryFactory.create({ course, slug? })`: repositório vazio.
  - `repositoryTree({ "a/b.py": "x", "run.sh": { content, mode: "100755" } })`
    devolve `{ files, tree }`: `files` para `addFiles`, `tree` para `commit`.
- Existentes: `persistedCourseFactory`, `persistedUserFactory`,
  `persistedCalendarEventFactory`, `persistedBlobFactory`,
  `persistedTimeSlotFactory`.

## T1. Upload multipart (R15)

Arquivos de stub:
- `src/api/registry/multipart.ts`: `readMultipart(request, schema, maxBytes?)`.
- `src/api/registry/route.ts`: `RouteOptions.inMultipart` e
  `openApiRequest(method, path, options)`.

O implementer refatora `route()` para montar o `request` do OpenAPI com
`openApiRequest` e, quando `inMultipart`, ler a entrada com `readMultipart`
em vez de `request.json()`. 413 é `InvalidData` com `status: 413`, sem classe
nova.

Seams:
- `readMultipart` direto, com `new Request(url, { method: "POST", body:
  formData })`. Para o 413, um `Request` com `Content-Length` de 17 MB e um
  corpo `ReadableStream` que falha o teste se for lido.
- `openApiRequest("post", "/api/x", { in, inMultipart: true })` para o
  documento, sem registrar rota.
- Endpoint de teste de ponta a ponta: no próprio spec,
  `POST("/api/__test/multipart", { isPublic: true, inMultipart: true, in, out,
  handler })` de `@/api/registry/route` e depois `route.view(ctx)` com
  `ctx = { locals: {}, request, params: {}, cookies } as unknown as
  APIContext`. A rota entra no `registry` global do worker; em `afterAll`,
  tire as definições dela de `registry.definitions`, senão
  `test/openapi.spec.ts` (mesmo worker) compara um documento com uma rota a
  mais.

Arquivo de teste: `test/api-multipart.spec.ts`.

Critérios:
- Lote 1: um endpoint de teste recebe partes de arquivo (como `Buffer`) e de
  texto (coeridas pelo schema); o OpenAPI mostra `multipart/form-data`; um
  `Content-Length` acima de 16 MB dá 413 sem ler o corpo.

## T3. Serialização git e zip (R13, R32 servidor)

Arquivos de stub:
- `src/services/git/objects.ts`: `objectHeader`, `objectSha`, `blobSha`,
  `compareTreeEntries`, `serializeTree`, `parseTree`, `buildTrees`,
  `serializeCommit`, `parseCommit`, `objectStream`, `looseObject`.
- `src/services/git/zip.ts`: `writeZip(files, { root, date })`.

Seams: só funções puras (valores e streams), sem banco e sem servidor.
`looseObject(objectStream(...))` é o que as rotas git servem; teste com
`zlib.inflateSync` e compare com `git cat-file`. O zip abre com `unzip -t` e
`zipinfo` mostra os modos.

Arquivos de teste: `test/fixtures/git-vectors.json` (tabela compartilhada com a
CLI) e `test/git-objects.spec.ts`.

Critérios:
- Lote 1: os shas de blob, árvore aninhada e commit batem com o `git` real; a
  ordenação git de `a.txt`, `a/`, `a-b` está certa.
- Lote 2: o zip é byte-idêntico em duas gerações e abre com `unzip -t`,
  preservando `100755`; gerar o zip de 50 MB não aumenta o RSS em mais de
  20 MB.

## T4. Services (R4, R7–R12, R14)

Arquivos de stub:
- `src/db/services/repository.service.ts`: `RepositoryService` com `create`,
  `findOne`, `findMany`, `update` (`never`), `upsert`, `delete`, `addFiles`,
  `commit`, `findByToken`, `readObject`, `listDir`, `readFile`, `zip`,
  `rotateToken`. Registrado como `db.repository`. Construtor
  `(blob, attachment, client?, { publicUrl? })`.
- `src/db/services/blob.service.ts`: `missing(hashes, opts)`,
  `createFromFile(path, opts)`, `tempPath()`; `create` passa a gravar
  `gitSha` (sem mudança de assinatura).
- `src/db/services/attachment.service.ts`: `attach({ hash, filename,
  attachedTo, uploaderId? }, opts)` para anexar blob já existente; o `case
  "REPOSITORY"` de `attachmentSource` está como stub.
- `src/db/services/calendar-event.service.ts`: sem método novo. A leitura de
  `repositories` já está feita; falta gravar os vínculos em
  `createTx`/`updateTx`/`upsertTx` a partir de `input.repositories`.

Já implementado em T2 (o tester pode usar como está): `repositoryCommit`
rejeita R6 e as regras puras do R7 (duplicado, caixa, prefixo, limite) por
`treeConflicts`/`isRepositoryPath` em `src/core/schemas/repository.ts`. O
service só acrescenta a regra do `hash` desconhecido.

Seams:
- Métodos do service com `actor` (professor do curso, aluno matriculado,
  admin, `FULL_ACCESS`).
- `readObject` devolve o objeto sem compressão com cabeçalho: o sha1 do
  stream lido é o sha pedido. Para checar o commit, `parseCommit` do corpo.
- Serviço isolado para disco limpo: `new RepositoryService(blob, new
  AttachmentService(blob), prisma, { publicUrl: "http://test" })`.
- GC: `db.blob.collectGarbage({ actor: SYSTEM, olderThan: new Date(Date.now()
  + 1000) })`.

Arquivo de teste: `test/repository-service.spec.ts`.

Critérios:
- Lote 1: primeiro commit; commit com a mesma árvore não cria commit; segundo
  commit tem o primeiro como pai.
- Lote 2: R7 recusa cada caso da lista; arquivo de outro curso já no servidor
  entra via `missing` sem reenvio; attachment enviado e não usado sai no
  commit, blob de versão antiga fica.
- Lote 3: título vem do H1 do README e cai para o slug; aluno não vê
  repositório sem `head`, aluno não faz push; `readObject` não serve blob que
  não é attachment do repositório.
- Lote 4: `zip` zera no commit e solta o zip anterior; `rotateToken` invalida
  `findByToken`; upsert de evento com `repositories` substitui o conjunto, e
  slug inexistente é recusado.
- Lote 5: apagar o repositório remove vínculos e objetos, e o GC recolhe os
  blobs que só ele usava.

## Decisões fora do spec

- `cloneUrl` é absoluta (`z.url()`), mas o service não tem request. A origem
  vem de `PUBLIC_URL` (nova constante de runtime em `src/core/constants.ts`,
  padrão `http://localhost:4321`) ou de `publicUrl` no construtor.
- Limites ficam nos schemas, como em `report.ts`: `MAX_UPLOAD_BYTES` em
  `src/core/schemas/blob.ts`, `MAX_REPOSITORY_FILES` em
  `src/core/schemas/repository.ts` (os schemas não podem importar
  `src/core/constants.ts`, que lê o ambiente).
- Comparação de caixa no R7 vale também para o prefixo: `A` e `a/x`
  conflitam.
- `addFiles` não conhece caminhos: o attachment nasce com o nome do hash e o
  `commit` dá a ele o nome do primeiro caminho que usa o blob, para que o
  mime e o link de `/files/<hash>/<nome>` façam sentido.
- `readMultipart` sem `Content-Length` responde 411.
- `findByToken` e `readObject` não recebem ator (o token é a credencial);
  aceitam `{ tx }` opcional.
- O zip não usa zip64 (falha acima de 4 GiB) e só tem entradas de arquivo.
