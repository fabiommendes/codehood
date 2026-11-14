---
type: spec
status: to-do
tags: [mdq, attachments, blobs, questions, exams, cli]
relatedTo: [blob-upload-and-gc, mdq-biblioteca, historico-de-edicao-no-servidor]
created: 2026-11-13
---

# Anexos de questões e provas

## Contexto

O MDQ ganhou a seção `## [attachments]` (questão e prova): arquivos que o aluno
baixa, declarados como bloco cercado (`text`) ou como link (`origin`). Ver
`../mdq/docs/question-types/question-base.md` ("Attachments"),
`../mdq/docs/exam.md` ("Attachments") e `../mdq/docs/public-form.md`. O MDQ
nunca lê o arquivo de um link: o host serve. Hoje a mdq-js não conhece o campo
e o Zod o descarta calado, e a CLI avisa que ignora `exam.attachments`. Esta
spec leva os anexos da pasta do professor até o download do aluno, sem que o
aluno baixe o anexo de uma prova antes de ela abrir para ele.

## Requisitos

### mdq-js

- **R1.** Porte completo na mdq-js (`../mdq/mdq-js`), segundo a issue
  `../mdq/dev/issues/mdq-js-porte-de-anexos-e-da-posicao-livre-do-answer-key.md`:
  parser (questão e prova, nova regra de fim do `## [answer-key]`), modelo Zod
  `Attachment`, campo `attachments` na base das questões e na prova, os três
  erros novos, `invalid-frontmatter-field`, e a forma pública sem `origin`. Os
  exemplos do corpus saem de `mdq-js/tests/not-ported.ts`. O servidor importa
  `mdq` por `link:../mdq/mdq-js`; se o pacote precisar de build para o servidor
  enxergar as mudanças, o build faz parte da tarefa.

### Segurança

- **R2.** Adendo à ADR 0010 (`dev/adr/0010-blobs-publicos-e-permanentes.md`):
  um blob de anexo de questão ou de prova também é servido por `/files/<hash>`.
  O sigilo vem de o hash nunca chegar ao aluno: nenhum read model de aluno,
  página de aluno ou cabeçalho de resposta (ETag incluso) contém o sha256 de um
  anexo. O aluno só baixa pelas rotas de R15, que conferem a janela da prova.

### Banco

- **R3.** `AttachmentOwner` ganha `EXAM`.
- **R4.** `QuestionData.files Json?`: mapa `nome -> sha256` dos anexos por link
  daquela versão. Nulo quando a versão não tem link.
- **R5.** `Exam.attachments Json?`: a lista `attachments` do documento MDQ da
  prova, com `origin`. `Exam.files Json?`: o mapa `nome -> sha256` de R4.
- **R6.** Uma linha `Attachment` por (blob, nome sanitizado, dono). Na questão,
  o dono é o `QuestionRef` (`attachedToType = QUESTION`, `attachedToId =
  QuestionRef.id`), não a versão: a linha serve para contagem de referências e
  cota. Qual blob uma versão usa vem de `QuestionData.files`. Na prova, dono
  `EXAM` com `attachedToId = Exam.id`. A cota soma por linha (`usageBytes`):
  o mesmo blob com dois nomes cobra duas vezes. Aceito.

### Services

- **R7.** Contrato de bytes. A entrada de escrita de questão e de prova ganha
  `files?: Record<nome, sha256>` (no schema e no OpenAPI) e
  `blobs?: Record<sha256, Buffer>`, preenchido só pelo hook `withFiles` (R13),
  fora do schema REST e do OpenAPI. O service recalcula o sha256 de cada buffer
  e recusa o que não confere (`InvalidData`). Um buffer que nenhum `files` cita
  também é `InvalidData`.
- **R8.** Escrita de questão (`create`, `update`, `upsert`). Regras, todas antes
  de gravar:
  - `files` ausente herda os hashes da versão com o mesmo rótulo ou, se ela não
    existe, da `latest`, para os mesmos nomes. Isso mantém funcionando a
    escrita da web (`src/actions/question.ts`), que reenvia o documento sem
    `files`;
  - depois disso, cada anexo por link do documento tem um hash, e `files` não
    tem nome que não seja um anexo por link (`InvalidData`);
  - cada hash existe como blob vivo ou chega em `blobs` (`NotFound("blob")`);
  - a soma do `text` dos anexos cercados de uma questão, em bytes UTF-8, não
    passa de `MAX_FENCED_ATTACHMENT_BYTES` (256 KiB, em
    `src/core/constants.ts`).
- **R9.** `writeVersion` grava `files` na `QuestionData` e o inclui na
  comparação do rótulo de versão, com `null` e `{}` tratados como iguais: mesma
  `version` com `files` diferente é o 409 `errors_question_version_conflict`.
  Para cada par (hash, nome) que o `QuestionRef` ainda não tem, cria a linha
  `Attachment` (R6) na mesma transação, cobrando a cota do ator.
- **R10.** Escrita de prova: `files` sem `attachments` é `InvalidData`;
  `attachments` sem `files` vale `files: {}` (basta numa prova só com
  cercados). Os dois ausentes num update mantêm o que há. Valem as regras de R8, exceto a herança.
  O update substitui a lista: na mesma transação, cria as linhas novas e apaga
  as linhas `EXAM` cujo (hash, nome) saiu. Trocar anexo de prova aberta é
  permitido; o aluno vê a lista atual.
- **R11.** Exclusão. Hoje nenhum caminho apaga de vez uma `Exam` ou um
  `QuestionRef`: `question.delete` e `exam.delete` só arquivam, e
  `course.delete` é recusado pela FK quando o curso tem prova ou questão. Por
  isso esta spec não chama `detach`: arquivar não solta nada e as versões
  antigas continuam baixáveis. Quem criar um caminho de exclusão definitiva
  chama `attachment.detach` com o dono certo.
- **R12.** Janela de anexo para o aluno: a função pura
  `attachmentsOpen(exam: ExamTiming, exception, now): boolean` em
  `src/services/exam-state.ts`, usada por R13 e R14, é
  `examPhase(personalTiming(exam, exception), now)` em `open` ou `closed`.
  Assim `draft`, `archived` e `upcoming` (inclusive `SCHEDULED` sem data)
  negam, a `ExamException` adia ou adianta a abertura para o aluno dela, e
  depois do fim da janela o aluno continua vendo. O autor e quem tem
  `course.update-contents` (admin incluso) sempre veem, sem passar pela
  função.
- **R13.** Leitura:
  - questão: o read model completo (autor) traz `files`; o público nunca traz
    `files` nem hash, e os anexos vêm sem `origin` (forma pública do MDQ). O
    `text` dos cercados segue o `publicPayload` (limitação de R18);
  - prova: o read model completo traz `attachments` com `origin` e `files`; o
    do aluno traz `attachments` sem `origin` só sob R12, e lista vazia antes
    disso (o `text` de um anexo cercado é o próprio conteúdo).
- **R14.** Download, no molde de `report.attachment`, devolvendo
  `{bytes, mimeType, filename}`:
  - `exam.attachment({course, slug}, name, {actor})`: anexo da prova, sob R12;
  - `exam.questionAttachment({course, slug}, questionSlug, name, {actor})`:
    anexo da versão da questão que a prova fixa (`QuestionsForExam.version`, ou
    a `latest` quando nula), sob R12. É o único caminho do aluno para anexo de
    questão;
  - `question.attachment({publicId, version?}, name, {actor})`: só para quem
    tem leitura completa da questão (`questionAccess` = `full`). Rótulo de
    versão que não existe é `NotFound`, sem cair na `latest`;
  - um anexo cercado é servido do payload como `text/plain; charset=utf-8`; um
    link, pelo blob de `files[name]`;
  - negado ou inexistente é `NotFound` (404), sem distinguir os dois;
  - `filename` é o nome exato do MDQ, não o sanitizado. Nome fora de ASCII vai
    no `Content-Disposition` também como `filename*` (RFC 5987), em
    `src/utils/blob-response.ts`. Teste com `%20`
    literal no nome (`%2520` na URL), unicode e maiúsculas distintas.

### REST

- **R15.** Rotas de download (páginas `src/pages/api/...`, como a de report),
  com `contentDisposition` e `blobSecurityHeaders`
  (`src/utils/blob-response.ts`):

  | Rota | Service |
  | :--- | :------ |
  | `GET /api/course/[discipline]/[course]/exam/[slug]/attachment/[name]` | `exam.attachment` |
  | `GET /api/course/[discipline]/[course]/exam/[slug]/question/[question]/attachment/[name]` | `exam.questionAttachment` |
  | `GET /api/question/[publicId]/attachment/[name]?version=<rótulo>` | `question.attachment` |

- **R16.** `questionApi` e `examApi` ganham `withFiles`: aceitam JSON ou
  multipart, com as partes de arquivo nomeadas pelo sha256, como em
  `resourceApi`; o hook põe as partes em `blobs` (R7). `files` entra nos
  schemas de create/update de questão e de prova; `attachments` nos de prova.
  `files` é estado da escrita, não do documento MDQ, e fica fora de `question`.
- **R17.** Snapshot OpenAPI e cliente gerado da CLI regenerados
  (`pnpm run openapi:cli`).
- **R18.** Issue em `dev/issues/`: o `publicPayload` de uma questão de prova
  agendada é legível por qualquer membro do curso antes de a prova abrir
  (`visibility()` em `src/services/question-status.ts` não olha a janela).
  Isso inclui o `text` dos anexos cercados da questão, que vai no
  `publicPayload`: R12 protege só os anexos por link. Limitação conhecida da
  v1, fora desta spec.

### Telas

- **R19.** Componente `AttachmentList` (SolidJS, DaisyUI): uma linha por anexo
  com nome, rótulo (quando houver), formato e botão de baixar. Um anexo cercado
  também mostra o código num bloco colapsado, fechado por padrão. Recebe a
  lista e uma função `nome -> URL`.
- **R20.** A lista aparece logo abaixo do enunciado em: tentativa do aluno
  (`AnswerField`, `CodeAnswer`, `CodeEssayAnswer`, com URLs da rota
  `exam.questionAttachment`), preview do professor (`QuestionPreview`,
  `ExamPreview`), página da questão (`questions/[slug].astro`) e correção
  (`attempts/[username].astro`), estas com a rota `question.attachment` na
  versão mostrada para quem tem leitura `full`. Quem não tem (aluno revendo a
  própria tentativa, monitor) recebe a URL de `exam.questionAttachment` quando
  a página tem uma prova no contexto; sem prova, a lista aparece sem botão de
  baixar. Os anexos da prova aparecem abaixo do preâmbulo em
  `exams/[slug].astro`, sob R12.

### CLI

- **R21.** Questão em arquivo: lê os anexos por link relativos ao arquivo da
  questão e calcula o sha256 de cada um. Receita da versão: os bytes dos
  anexos entram depois das fontes de `[tests]`, na ordem do documento, cada um
  precedido de `b"\0"`, como as fontes. Questão sem link mantém a versão byte a
  byte igual à de hoje (teste). Arquivo ausente é `QuestionSourceError` (ou
  irmão no mesmo estilo) e, como hoje, recusa o push inteiro antes de qualquer
  requisição.
- **R22.** Questão inline de prova: os links são relativos ao arquivo da prova;
  o JSON canônico que gera a versão ganha a chave `files` (mapa `nome ->
  sha256`, ordenado por nome) só quando há link, para não mudar a versão das
  questões sem anexo. Questão incluída resolve contra o próprio arquivo (R21).
- **R23.** Prova: os anexos da prova, relativos ao arquivo da prova, vão em
  `attachments` e `files`; o aviso que ignora `exam.attachments` sai. A CLI
  manda sempre os dois campos, `attachments: []` e `files: {}` quando a prova
  não tem anexo, para que apagar a seção limpe o servidor. O mapa `files` e a lista
  `attachments` entram no `exam_rev` só quando há anexo: o `rev` de uma prova
  sem anexo não muda.
- **R24.** Envio: um único `POST /api/blob/missing` por push com todos os
  hashes; as questões (inline e incluídas) sobem antes da prova; cada PUT vai
  em multipart com só os blobs que faltam e ainda não subiram neste push, ou em
  JSON quando não falta nenhum. Antes de qualquer requisição, a CLI recusa
  o push inteiro se um anexo passa de `MAX_UPLOAD_BYTES` (16 MiB), como em
  R21. Um 413 do servidor vira erro daquela questão ou prova
  (`OpResult(ok=False)`), com o limite e o maior arquivo na mensagem, e o push
  segue com as outras operações.
- **R25.** O push real contra o dev server, como pede `cli/AGENTS.md`, faz
  parte da tarefa.

### Dados de dev

- **R26.** `src/db/bootstrap.ts` semeia: uma questão com um anexo cercado e um
  por link (CSV); uma questão com um PDF por link; uma prova aberta com um
  anexo próprio que inclui uma dessas questões; uma prova agendada com anexo
  (para ver o 404 antes de abrir); uma questão com duas versões em que o CSV
  muda.

### Documentação

- **R27.** `GLOSSARY.md`: a entrada `Attachment` cita a prova como dono e
  ganha a acepção do MDQ (arquivo que a questão ou a prova dá ao aluno).
  `CHANGELOG.md` recebe a entrada.

## Fora do escopo

- Pull dos anexos pela CLI (sync de volta para a pasta do professor). A rota
  `question.attachment` já serve ao professor qualquer versão.
- Sigilo forte de blob (recusar `/files/<hash>` para blobs privados).
- Upload em lotes de anexos que somam mais que `MAX_UPLOAD_BYTES`.
- Pré-visualização embutida de PDF ou imagem na lista.
- `## [tests]` com nome no info string (issue do mdq).
- Esconder o `publicPayload` antes da prova abrir (R18).

## Plano de ação

| T   | O quê | Arquivos | R | Depende | Modelo | Pronto quando |
| :-- | :---- | :------- | :- | :------ | :----- | :------------ |
| T0  | Porte na mdq-js | `../mdq/mdq-js/**`, issue do mdq | R1 | - | sonnet (TDD com o corpus) | testes da mdq-js e `r2 check` do mdq saem 0; `pnpm run typecheck` do servidor ok |
| T1  | ADR, schema Prisma e issue | `dev/adr/0010-*.md`, `prisma/schema.prisma`, `dev/issues/` | R2-R6, R18 | - | haiku | `prisma db push` + `pnpm run typecheck` ok |
| T2a | Service de questão | `src/db/services/{question,attachment}.service.ts`, `src/core/schemas/question.ts`, `src/core/constants.ts`, `src/mdq/` | R7-R9, R13 (questão), R14 (`question.attachment`), R11 (só `QuestionRef`) | T0, T1 | sonnet (TDD, projetista opus) | specs `unit` novos passam; `test:unit` verde |
| T2b | Service de prova e janela | `src/db/services/exam.service.ts`, `src/services/exam-state.ts`, `src/core/schemas/exam.ts`, caminho de exclusão de curso | R10, R11 (prova e curso), R12, R13 (prova), R14 (`exam.*`) | T2a | sonnet (TDD) | specs `unit` novos passam; `test:unit` verde |
| T3  | REST e download | `src/api/index.ts`, `src/pages/api/...`, OpenAPI da CLI | R15-R17 | T2b | sonnet (TDD) | e2e das rotas passa, incluindo 404 antes de a prova abrir; `openapi-snapshot.spec.ts` verde |
| T4  | Histórias e e2e | `docs/user-stories/*.md`, `test/stories/*` | R19, R20 | T3 | sonnet | histórias escritas; e2e falha porque a lista não existe |
| T5  | Telas | `src/components/question/AttachmentList.tsx` e os componentes de R20 | R19, R20 | T4 | sonnet | e2e de T4 passa |
| T6  | CLI | `cli/codehood/push/*.py`, `cli/tests/` | R21-R25 | T3 | sonnet (TDD) | `uv run pytest` verde em `cli/`; push real ok |
| T7  | Seed | `src/db/bootstrap.ts` e fixtures | R26 | T3 | haiku | `pnpm run db:reset` ok e os anexos baixam no dev server |
| T8  | Glossário e changelog | `GLOSSARY.md`, `CHANGELOG.md` | R27 | T5, T6 | haiku | revisado pelo coordenador |

T0 e T1 rodam em paralelo. T5, T6 e T7 rodam em paralelo (sem arquivos em
comum).

## Critérios de aceite

- Um push de uma pasta com questão e prova com anexos sobe os arquivos, e um
  segundo push sem mudança não manda bytes (saída da CLI).
- Editar só o CSV linkado gera versão nova; a versão antiga continua baixando o
  CSV antigo.
- O aluno vê e baixa os anexos na tentativa; antes de a prova abrir, as rotas
  da prova respondem 404 e o read model da prova vem sem anexos (e2e e unit).
- Nenhum read model de aluno tem hash (teste unit).
- Screenshot da lista de anexos na tentativa e no preview.
- `pnpm run lint` e `pnpm test` verdes; `uv run pytest` verde em `cli/`.
