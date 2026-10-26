---
type: spec
status: to-do
tags: [reports, feedback, triage, admin, instructor, api]
relatedTo: [attachment-service, blob-service, regrade-requests]
---

# Relatos de problemas

## Contexto

Quem usa o Codehood e encontra um bug, uma tela confusa ou um erro numa
questão não tem onde avisar, a não ser por e-mail ou na aula. Este spec cria
uma caixa de relatos: qualquer usuário logado manda uma mensagem, com captura
de tela e imagens, a partir de qualquer página. Não há conversa. O autor vê
só o status do relato. O admin faz a triagem de todos os relatos, e o
professor só dos relatos de conteúdo do seu curso. A triagem também pode ser
feita localmente, pela REST: o status no servidor serve de checkpoint, e por
isso um relato já triado não volta para a fila.

## Glossário

- **Report** (relato): o relato de um usuário sobre um problema no sistema ou
  no material de um curso, sem respostas.

## Requisitos

### Banco

**R1.** Novo modelo. `Feedback` já é o nome da correção de uma submissão; por
isso, `Report`.

```prisma
enum ReportKind {
  BUG
  SUGGESTION
  CONTENT
  OTHER
}

enum ReportStatus {
  OPEN
  TRIAGED
  RESOLVED
  DISMISSED
}

/// A user's report of a problem with Codehood or with a course's material.
/// One message, no replies: the author only sees the status.
model Report {
  id       Int    @id @default(autoincrement())
  publicId String @unique

  kind    ReportKind
  message String

  /// `OPEN` until someone triages it; `TRIAGED` is accepted as work, not done.
  status ReportStatus @default(OPEN)

  /// Written by whoever triages it, never shown to the author.
  note String?

  /// Captured by the page, not typed. Absent when sent through the REST API.
  url       String?
  userAgent String?
  viewport  String?

  authorId String
  author   User   @relation("ReportAuthor", fields: [authorId], references: [username], onDelete: Cascade)

  /// The course of the page it was sent from. Required for `CONTENT`, which
  /// the course's instructor triages.
  courseId Int?
  course   Course? @relation(fields: [courseId], references: [id], onDelete: Cascade)

  triagedById String?
  triagedBy   User?     @relation("ReportTriagedBy", fields: [triagedById], references: [username], onDelete: SetNull)
  triagedAt   DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([status, createdAt])
  @@index([courseId, status])
}
```

**R2.** `AttachmentOwner` ganha `REPORT`. O relato não tem tabela própria de
anexos: usa `Attachment`, com quota e deduplicação por hash.

**R3.** Cascatas:
- apagar o autor apaga os relatos dele (são dados pessoais);
- apagar o curso apaga os relatos dele;
- apagar quem fez a triagem só limpa `triagedById`.

`ReportService.delete` solta os anexos do relato na mesma transação, porque o
dono polimórfico de `Attachment` não cascateia sozinho. As cascatas de
`User` e `Course` passam pelo banco e não chegam ao service: deixam linhas de
`Attachment` com `attachedToType: REPORT` apontando para um relato que não
existe mais. O GC de blobs só recolhe blobs sem nenhum anexo, então ganha um
passo antes: apagar os anexos `REPORT` órfãos.

### Entidades

**R4.** `src/core/schemas/report.ts` com as constantes
`REPORT_MESSAGE_MIN = 10`, `REPORT_MESSAGE_MAX = 4000`,
`REPORT_MAX_ATTACHMENTS = 3`, `REPORT_MAX_ATTACHMENT_BYTES = 5 MiB` e
`REPORT_DAILY_LIMIT = 10`, e com os schemas:

- `reportSchema` (saída): `publicId`, `kind`, `message`, `status`, `note`
  (`.nullable().optional()`: fica ausente para quem só é autor), `url`,
  `userAgent`, `viewport`, `author` (username), `course` (chave natural ou
  `null`), `attachments` (`filename`, `mimeType`, `size`, `url`),
  `triagedBy`, `triagedAt`, `createdAt` e `updatedAt`. O `id` é interno e
  não sai pela REST.
- `reportCreate`:
  - `kind` e `message` (com trim, de 10 a 4000 caracteres);
  - `url`, `userAgent` e `viewport`, todos `.nullish()` e com tamanho máximo;
  - `course` (`courseRef.nullish()`);
  - `attachments`: `filename`, `mimeType` (só `image/png`, `image/jpeg` ou
    `image/webp`) e `bytes` (`buffer`), no máximo 3.

  Um refine recusa `CONTENT` sem `course`.
- `reportUpdate` (triagem): `status`, `kind` e `note` (`.nullish()`), todos
  opcionais. O autor nunca edita.
- `reportPK`: `{ publicId }`.
- `reportFilter`: `status[]`, `kind[]`, `course` e `author`, todos opcionais.

**R5.** `db.report` implementa `create`, `findOne`, `findMany`, `update` e
`delete`, com `upsert` como `never`, e o método extra
`attachment(pk, filename, opts)`, que devolve os bytes e o mime type. A
permissão de `attachment` é a mesma de ler o relato.

**R6.** `create`:
- o autor é o ator;
- recusa com `TooManyRequests` (429) o 11º relato do mesmo autor em 24 h;
- cada anexo acima de 5 MiB é recusado com `InvalidData`;
- grava os anexos como `Attachment` com `attachedToType: REPORT`, e o
  uploader é o autor.

**R7.** `update`:
- quando o status sai de `OPEN`, grava `triagedBy` (o ator) e `triagedAt`;
  quando volta para `OPEN`, limpa os dois;
- mudar `kind` para `CONTENT` exige que o relato tenha curso;
- um professor que muda o `kind` de um `CONTENT` passa o relato ao admin e
  deixa de vê-lo.

**R8.** `findMany` filtra no banco pelo que o ator pode ver (R10), confere a
permissão de cada linha e ordena por `createdAt` crescente.

**R9.** Novo erro `TooManyRequests` em `src/core/error.ts`, com status 429 e
`code: "too-many-requests"`, seguindo os outros erros serializáveis.

### REST e permissões

**R10.** Regras novas em `src/auth/permissions/index.ts`:

| Ação | Admin | Professor do curso | Autor | Outros |
| :-- | :-: | :-: | :-: | :-: |
| `report.create` | sim | sim | sim | sim (logado) |
| `report.read` | todos | só `CONTENT` do curso | os seus, sem `note` | não |
| `report.triage` | todos | só `CONTENT` do curso | não | não |
| `report.delete` | sim | não | enquanto `OPEN` | não |

Um professor que é autor de um relato que não é `CONTENT` só o vê como autor.

**R11.** `reportApi = CRUD("/api/report", ...)`, sem `PUT`:

| Método | Rota | Corpo / query |
| :-- | :-- | :-- |
| `POST` | `/api/report` | JSON: `kind`, `message`, `url?`, `course?`. Sem anexos |
| `GET` | `/api/report` | `?status=&kind=&course=&author=` |
| `GET` | `/api/report/[publicId]` | |
| `PATCH` | `/api/report/[publicId]` | `status?`, `kind?`, `note?` |
| `DELETE` | `/api/report/[publicId]` | |

**R12.** `GET /api/report/[publicId]/attachment/[filename]` devolve os bytes
com o `Content-Type` do anexo e responde 404 para quem não pode ler o relato.
A API nunca expõe o hash do blob.

**R13.** A triagem local é `GET /api/report?status=OPEN`, uma decisão por
relato e um `PATCH` com o status. Não há rota de lote.

### Telas

**R14.** O dialog "Reportar problema" (S1) é uma ilha Solid no `AppLayout`.
Ele abre pelo `UserMenu` e por um link no `AppFooter`.
- No clique, a página é rasterizada com `modern-screenshot` (carregado só
  nesse momento) e só depois o dialog abre, para que ele não apareça na
  captura.
- Campos: o tipo e o texto. O tipo vem pré-selecionado: `CONTENT` nas páginas
  de questão, prova ou material, e `BUG` nas outras. `CONTENT` só aparece em
  páginas de curso.
- A captura aparece numa prévia que o usuário pode remover. Ele pode
  adicionar imagens, até 3 no total contando a captura.
- O envio é feito pela Astro Action `report.create`, com `FormData`. O
  contexto (`url`, `userAgent`, `viewport` e o curso da página) vai junto, sem
  ser digitado.
- No sucesso, mostra um toast e o dialog fecha.
- Se a captura falhar, o dialog abre sem ela e mostra um aviso, sem bloquear
  o envio.

**R15.** `src/pages/500.astro` tem o link "Reportar este erro", que abre o S1
com o tipo `BUG` e a URL da página que falhou.

**R16.** `/profile` ganha a seção "Meus relatos" (S3): tipo, data, status e o
começo do texto. Abrir um relato mostra o texto inteiro e os anexos. Há um
"Apagar" enquanto o relato está `OPEN`.

**R17.** `/admin/reports` (S4), uma aba nova no `AdminHeader`, é a fila de
todos os relatos.
- Filtros por status (padrão `OPEN`) e por tipo.
- Cada relato mostra o texto, o contexto, as miniaturas dos anexos, o autor
  e o curso.
- O formulário de triagem tem status, tipo e nota, e é enviado pela Action
  `report.triage`.

**R18.** `/[discipline]/[course]/reports` (S5) é a mesma fila (o componente
`ReportQueue`), restrita ao `CONTENT` do curso. A aba no `CourseHeader`
aparece só para o professor e mostra quantos relatos estão `OPEN`.

**R19.** O S1 e o `ReportQueue` entram em `/design/components` com os estados:
vazio, com captura, enviando, erro, fila vazia e relato triado.

### Dados de dev

**R20.** `src/db/bootstrap.ts` semeia:
- um relato de cada tipo, do aluno `student` na `cs101/ada_2026-2`;
- os quatro status, com `note` nos triados;
- um relato com captura (um PNG pequeno gerado no seed) e outro com duas
  imagens;
- um `CONTENT` do curso da `ada`, para o S5;
- um relato do `instructor`, para o S3.

## Fora do escopo

- Anexos pelo `POST` da REST: esperam o multipart de
  `dev/specs/to-do/blob-upload-and-gc.md`.
- Comandos da CLI para baixar relatos e fazer a triagem:
  `cli/dev/issues/report-triage.md`.
- Resposta ao autor e conversa sobre o relato.
- Aviso por e-mail ao admin ou ao professor.
- Botão "Abrir no GitHub", com a URL de uma issue já preenchida.
- Aviso na home do professor.
- Captura com `getDisplayMedia`.
- Prioridade e tags, que se decidem na triagem local.

## Plano de ação

TDD em modo full nas tarefas com regra (T2, T3). Um único projetista de
testes (`opus`) para T2 e T3.

**T1. Banco, schemas, erro, permissões.** `prisma/schema.prisma`,
`src/db/branding.ts`, `src/core/schemas/report.ts`,
`src/core/schemas/index.ts`, `src/core/error.ts`,
`src/auth/permissions/index.ts` e `src/fixtures/report.factory.ts`. Cobre R1,
R2, R4, R9 e R10. Sem dependências. Modelo `sonnet`. Pronto quando
`pnpm exec prisma db push`, `pnpm run typecheck` e `pnpm run db:reset` saem
0.

**T2. Service.** `src/db/services/report.service.ts`, `src/db/index.ts`,
o passo de órfãos em `src/db/services/blob.service.ts` e
`test/report-service.spec.ts`. Cobre R3, R5–R8. Depende de T1. Testes com
`haiku`, implementação com `sonnet`. Pronto quando o spec do service passa,
cobrindo:
- `CONTENT` sem curso é recusado;
- o 11º relato em 24 h recebe 429;
- um anexo acima do limite e um mime fora da lista são recusados;
- o autor não lê a `note` e não faz a triagem;
- o professor lê e faz a triagem do `CONTENT` do seu curso, mas não do
  `CONTENT` de outro curso nem de um `BUG`;
- o professor que reclassifica para `BUG` deixa de ver o relato;
- `triagedBy` e `triagedAt` são gravados e limpos;
- o autor apaga enquanto `OPEN` e não depois;
- `delete` solta os anexos;
- apagar o curso apaga os relatos, e o GC depois recolhe os anexos e os
  blobs deles;
- `findMany` não vaza linhas.

**T3. REST e rota de anexo.** `src/api/index.ts`, a rota do anexo em
`src/pages/api/report/` e `test/api-report.spec.ts`. Cobre R11–R13. Depende
de T2. Testes com `haiku`, implementação com `sonnet`. Pronto quando:
- o fluxo `GET ?status=OPEN` → `PATCH` → `GET ?status=OPEN` vazio passa;
- o anexo dá 200 a quem pode ler e 404 aos outros;
- o OpenAPI não expõe `id` nem hash;
- `test/api-no-raw-ids.spec.ts` continua verde.

**T4. Histórias.** `docs/user-stories/student.md`,
`docs/user-stories/instructor.md`, `docs/user-stories/admin.md` e os e2e em
`test/stories/`. Depende de T1. Modelo `sonnet`. As histórias:
- Aluno: abre o dialog numa página de curso, tenta enviar um texto curto e
  recebe erro, remove a captura, adiciona uma imagem, envia, vê o relato em
  "Meus relatos" e o apaga.
- Professor: vê a contagem na aba "Relatos" do curso, faz a triagem de um
  `CONTENT` como `TRIAGED` com nota e reclassifica outro como `BUG`, que some
  da fila dele.
- Admin: filtra a fila por `OPEN`, abre um relato com anexo e o marca como
  `RESOLVED`.

Pronto quando os e2e falham porque as telas não existem.

**T5. Telas.** `src/components/report/` (`ReportDialog.tsx` e
`ReportQueue.tsx`), `src/actions/` (`report.create`, `report.triage` e
`report.delete`), `src/layouts/AppLayout.astro`,
`src/components/nav/UserMenu.astro`, `src/components/nav/AppFooter.astro`,
`src/pages/500.astro`, `src/pages/profile.astro`,
`src/pages/admin/reports.astro`, `src/components/AdminHeader.astro`,
`src/pages/[discipline]/[course]/reports.astro`,
`src/components/CourseHeader.astro`, `src/pages/design/components.astro` e as
mensagens de i18n. Inclui adicionar `modern-screenshot` ao `package.json`.
Cobre R14–R19. Depende de T3 e T4. Modelo `sonnet`. Pronto quando os e2e de
T4 passam.

**T6. Seed.** `src/db/bootstrap.ts`. Cobre R20. Depende de T2. Modelo `haiku`.
Pronto quando `pnpm run db:reset` sai 0 e as três telas mostram cada estado
no dev server.

**T7. Fechamento.** `GLOSSARY.md` (entrada **Report**), `CHANGELOG.md`,
`pnpm exec biome check --write .`, `pnpm run lint` e a suíte inteira. Mover
este spec para `dev/specs/to-review/`.

## Critérios de aceite

- Screenshots: o dialog com a prévia da captura; "Meus relatos" no perfil; a
  fila do admin com um relato aberto e um triado; a aba do curso com a
  contagem.
- Saída verde de `test/report-service.spec.ts`, de `test/api-report.spec.ts`
  e dos e2e.
- Uma sessão de `curl` com uma API key de admin: baixar os `OPEN`, fazer o
  `PATCH` de um e ver que ele não volta no próximo `GET ?status=OPEN`.
