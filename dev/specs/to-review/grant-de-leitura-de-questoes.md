---
type: spec
status: to-do
tags: [security, exams, questions, versioning, permissions]
relatedTo: [per-student-exceptions, simulacao-e-previa-da-prova, anexos-de-questoes-e-provas, fila-de-correcao-externa, correcao-objetivas-e-ajustes-de-nota]
created: 2026-11-17
creator: claude
---

# Grant de leitura de questões

## Contexto

Um aluno matriculado lia, pelo service de questões, o enunciado de questões de
provas que ainda não tinham aberto para ele. O conserto interino (commit
`8aa84fc`, `isReleased` e `releasedRefIds` em
`src/db/services/question.service.ts`) libera a questão quando alguma prova que
a contém está aberta ou encerrada para o aluno. Ele deixa estes furos:

- **B1, versão.** A liberação é por questão, não por versão. Uma versão nova,
  editada para a final, fica legível por causa de um quiz encerrado.
- **B6, tentativa.** A liberação vale para a prova aberta, não para a
  tentativa. Em prova com duração e sem data, o aluno lê o enunciado pelo REST
  antes de iniciar o relógio.
- **B7, `load-review`.** `src/utils/load-review.ts` lê o documento privado com
  `FULL_ACCESS` para montar a revisão do aluno.
- **B8, home.** `src/utils/load-student-home.ts` lê o título da questão fora de
  qualquer prova.
- **C3, guarda.** `submission.service.ts`, `grading-job.service.ts`,
  `exam.service.ts`, `answer-edit.service.ts` e `rubric-store.ts` leem
  `tx.questionData` direto, cada um com a sua cópia da regra "versão fixada ou
  a última". Nada impede um caminho novo de fazer o mesmo.
- **C5, estado.** Arquivar a prova, remover a exceção ou desmatricular o aluno
  precisa valer na leitura seguinte.
- **Custo.** A página da tentativa faz cerca de três consultas por questão.

Fato de domínio: o aluno não tem leitura legítima de questão fora de uma
prova. Esta spec troca a regra "membro lê questão liberada" por um **grant**:
um objeto que só um módulo emite, depois de conferir a tentativa do aluno, e
que os leitores de questão para aluno exigem. O instrutor continua lendo tudo
pelo `db.question`, como autor. A versão das questões passa a ser congelada
quando a prova começa, o que também fecha
`dev/issues/versao-da-questao-fixada-ao-iniciar-o-exame.md` e
`dev/issues/prova-questao-sem-versao-recusa-resposta-apos-sync.md`.

## Glossário

- **Grant de prova** (`ExamGrant`): prova de que um aluno pode ler as questões
  de uma prova, emitida a partir da tentativa dele. Vale 60 s e nunca sai de
  `src/db/`.
- **Congelamento de versões**: momento em que cada questão sem versão fixada
  de uma prova recebe a última versão. Registrado em `Exam.questionsFrozenAt`.
- **Faltante** (`missed`): aluno com a prova encerrada para ele e sem
  tentativa própria.

## Requisitos

### A. Banco

```prisma
model Exam {
  /// When the versions of the exam's questions were frozen: the creation of
  /// its first attempt that is not a simulation, its closing or the release
  /// of its grades, whichever came first. Null before that, and always null
  /// for a PRACTICE exam. Server-side state the course repository must not
  /// set (dev/adr/0011-contrato-de-sync-entre-cli-e-servidor.md).
  questionsFrozenAt DateTime?
}

model QuestionsForExam {
  /// The `versionHash` the exam serves and grades against. Null follows the
  /// question's latest version, which lasts only until
  /// `Exam.questionsFrozenAt` is set: from then on every row of the exam
  /// holds a version, and rewriting the exam's questions keeps it.
  version String?
}
```

- **R1.** `Exam.questionsFrozenAt DateTime?` entra no schema. A migration sai
  de `pnpm run release`; em dev, `prisma db push` e `pnpm run db:reset`.
- **R2.** Não há FK de versão: `QuestionsForExam.version` continua string, e o
  par `(refId, versionHash)` de `QuestionData` já é único.
- **R3.** `freezeQuestionVersions(tx, examId)` grava em cada linha de
  `QuestionsForExam` da prova com `version` nula o `versionHash` de
  `QuestionRef.latest`, e depois grava `questionsFrozenAt`. Linha já fixada
  fica como está. Questão sem nenhuma versão continua nula. A função não faz
  nada quando `questionsFrozenAt` já existe ou a prova é `PRACTICE`.
- **R4.** O carimbo de cada linha é um `updateMany` com `version: null` no
  `where`, para duas primeiras tentativas simultâneas gravarem o mesmo pin.
- **R5.** O congelamento roda, na mesma transação, em todo caminho que cria
  uma `Response` que não é simulação: `response.create`,
  `resolveOrCreateAttempt` (`src/db/services/response.service.ts`) e
  `attemptOrEmpty` (`src/db/empty-attempt.ts`).
- **R6.** O congelamento também roda em `exam.close` e em
  `exam.releaseGrades`.
- **R7.** Prova `PRACTICE` nunca congela: questão sem pin segue a última
  versão. Quem reusa uma questão de prática numa prova quer premiar quem
  treinou e sabe que os alunos já a conhecem.
- **R8.** Simulação do instrutor (`preview`) não congela.
- **R9.** Provas antigas, com tentativa e pin nulo, congelam de forma
  preguiçosa: `issueExamGrant` chama `freezeQuestionVersions` quando emite um
  grant que não é de simulação para uma prova não `PRACTICE` com
  `questionsFrozenAt` nulo. Não há comando `manage`.
- **R10.** Antes do congelamento, um push continua trocando a versão servida.
- **R11.** Depois do congelamento, `exam.update` e `exam.upsert` deixam de
  apagar e recriar as linhas com o `version` do payload (hoje
  `questionsForExams: { deleteMany: {}, create }`). A questão que continua na
  prova mantém o pin e o `version` enviado é ignorado em silêncio. A questão
  nova entra fixada na última versão. A questão removida sai. A posição segue
  o payload.
- **R12.** O read model da prova devolve o pin real de cada questão e
  `questionsFrozenAt`. O campo não existe nos corpos de create e update.
- **R13.** `GLOSSARY.md` (Exam, Question version) e a nota de `BACKLOG.md`
  sobre o pin passam a descrever o congelamento como feito.

### B. Grant (`src/db/services/exam-questions.ts`)

Módulo auxiliar, como `rubric-store.ts`. Emite, verifica e lê no mesmo
arquivo. Não importa nenhum service: `examTimingFromDb`, `examTimingSelect` e
`loadExceptionTiming` mudam de `submission.service.ts` para cá, e os services
passam a importá-los daqui.

```ts
declare const grantBrand: unique symbol;

/// `answer`: the public half. `review`: the public half plus what the review derives from the key.
export type GrantView = "answer" | "review";

/** Proof that `username` may read the questions of one exam, through one attempt or after its release. */
export interface ExamGrant {
	readonly [grantBrand]: true;
	readonly username: string;
	readonly courseId: CourseId;
	readonly examId: ExamId;
	/// `null` only for a student who missed the exam.
	readonly responseId: ResponseId | null;
	readonly view: GrantView;
	/// Whether the attempt still takes answers; pretest sources leave only then.
	readonly answering: boolean;
	/// Each question at the version resolved when the grant was issued, in exam order.
	readonly questions: readonly {
		refId: QuestionRefId;
		slug: string;
		dataId: QuestionDataId;
		version: string;
	}[];
	readonly expiresAt: Date;
}

/** Issues the grant of `actor` for their attempt at the exam, or `null` when they have none to read through. */
export async function issueExamGrant(
	tx: PrismaTx,
	target: { course: CourseRef; exam: string } | { response: string },
	actor: Actor,
	now?: Date,
): Promise<ExamGrant | null>;

/** What `actor` would be granted on each exam, by exam id, without resolving versions or writing anything. */
export async function grantViews(
	tx: PrismaTx,
	examIds: readonly ExamId[],
	actor: Actor,
	now?: Date,
): Promise<Map<ExamId, GrantView | null>>;

/** @throws {@link ImproperBehavior} Not issued here, issued to someone else, or expired. */
export function assertExamGrant(grant: ExamGrant, actor: Actor, now?: Date): void;

/** The public half of every question of the grant, in exam order, in one query. */
export async function grantedQuestions(tx: PrismaTx, grant: ExamGrant, actor: Actor): Promise<GrantedQuestion[]>;

/// The private document of one question of the grant, for a sibling service that derives a student view from it.
export async function grantedDocument(tx: PrismaTx, grant: ExamGrant, actor: Actor, slug: string): Promise<QuestionDocument>;

/// The private document an exam serves, with no actor behind the read: validation, grading, worker jobs.
export async function unsafePinnedDocument(
	tx: PrismaTx,
	examId: number,
	question: { id: number; latestId: number | null },
): Promise<QuestionDocument>;

/** Stamps the latest version on every unpinned question of the exam and sets `questionsFrozenAt`. */
export async function freezeQuestionVersions(tx: PrismaTx, examId: number): Promise<void>;
```

- **R14.** `ExamGrant` tem só os campos acima. Não leva peso.
- **R15.** O grant é criado apenas dentro de `issueExamGrant`, congelado com
  `Object.freeze` e registrado em um `WeakSet` privado do módulo. O `WeakSet`
  só prova a origem; não é cache.
- **R16.** `assertExamGrant` confere, em runtime: o objeto está no `WeakSet`;
  `actor` é um usuário e `grant.username === actor.username`;
  `now < grant.expiresAt`. Falha com `ImproperBehavior`. Um objeto montado com
  `as` ou `unsafeBrand` é recusado.
- **R17.** `expiresAt` é a emissão mais 60 s. Não há cache entre requisições:
  cada operação pública emite o seu grant. Com isso, arquivar a prova, remover
  a exceção ou desmatricular o aluno vale na chamada seguinte (C5).
- **R18.** `grantedQuestions` e `grantedDocument` chamam `assertExamGrant`
  antes de ler.
- **R19.** `issueExamGrant` e `grantViews` são os únicos pontos do código que
  chamam `personalTiming`, `viewerTiming` ou `previewTiming` para decidir
  leitura de questão. Os dois usam a mesma função interna com a tabela de
  emissão:

  | Situação do ator | Grant |
  | :-- | :-- |
  | `SYSTEM`, ou usuário que não é o autor da tentativa | `null` |
  | Sem `course.read-contents` no curso | `null` |
  | Prova `DRAFT` ou `ARCHIVED`, fora de simulação | `null` |
  | Estado `not-open` ou `can-start` | `null` |
  | `in-progress` | `answer`, `answering: true` |
  | `submitted`, tentativa do próprio aluno | `answer` |
  | `results` | `review` |
  | Faltante com notas liberadas e fase pessoal `closed` | `answer`, `responseId: null` |
  | Faltante antes da liberação, ou com segunda chamada `upcoming` ou `open` | `null` |
  | Simulação do instrutor | o que `previewAttemptState` der, pela mesma tabela |

- **R20.** Uma tentativa vazia (`Response.createdById` preenchido, criada por
  `attemptOrEmpty`) conta como faltante enquanto as notas não saem: sem grant.
  Depois da liberação o estado é `results` e o grant é `review`.
- **R21.** A liberação das notas usa todas as exceções da prova
  (`released(schedule)`), não só a do ator. A regra duplicada em
  `releasedToStudents` de `grading-job.service.ts` passa a vir deste módulo.
- **R22.** `issueExamGrant` resolve cada questão para um `dataId` na emissão:
  a versão fixada ou, sem pin, a última. Questão cuja versão fixada não existe
  fica fora de `questions`; não há queda para a última versão.
- **R23.** `grantedQuestions` faz uma consulta: `questionData` por
  `id in dataIds`, lendo só `publicPayload`.
- **R24.** `unsafePinnedDocument` e um leitor em lote equivalente são a única
  implementação da regra "versão fixada ou a última" para leitores de sistema.
  Passam a usá-los: `resolveExamQuestion` (`submission.service.ts`),
  `privateDocument` (`grading-job.service.ts`), `loadWeights` e
  `questionAttachment` (`exam.service.ts`), `answer-edit.service.ts` e
  `rubric-store.ts`.

### C. Service `db.examQuestion` e mudanças nos outros services

`src/db/services/exam-question.service.ts`, com `defineService()` sem CRUD.
As três operações são leituras (`transaction: false`) e cada uma emite o seu
grant.

```ts
forAttempt: op({
	args: [examAttemptRef],                      // { course, exam }
	returns: attemptQuestionsSchema.nullable(),  // null: no grant
})
// { view, answering, questions: [{ slug, version, weight, question, code? }] }

reviews: op({
	args: [examAttemptRef, reviewOutcomes],      // [{ question, submission, score, blanks }]
	returns: z.record(slug, reviewResultSchema),
})

titles: op({
	args: [examAttemptRef],
	returns: z.record(slug, z.string()),
})
```

- **R25.** `forAttempt` devolve `null` sem grant. Com grant, devolve as
  questões na ordem da prova, cada uma com `slug`, `version`, `weight` (o
  `weight` da versão servida, 1 quando ausente) e `question` na forma pública.
- **R26.** `question` em `forAttempt` não leva `tags`. O schema de `returns:`
  é uma whitelist da forma pública sem esse campo (ADR 0006).
- **R27.** `code` existe só em questão `code`: `sendable` sempre, `pretests`
  só quando `grant.answering`. Substitui `question.codeAnswer`, que é
  removida.
- **R28.** `reviews` exige grant com view `review`; sem ele devolve `{}`. Lê
  as respostas das submissões da tentativa do próprio grant, o documento por
  `grantedDocument`, e devolve só `ReviewResult` por slug, validado por
  `reviewResultSchema`. Os resultados (`score`, `blanks`) chegam de quem
  chama; a operação não recalcula nota. `src/utils/load-review.ts` é apagado.
- **R29.** `titles` devolve o título de cada questão do grant, por slug, e
  `{}` sem grant.
- **R30.** Saem de `question.service.ts`: `isReleased`, `releasedRefIds`, o
  terceiro argumento de `questionWhere` e `codeAnswer`.
- **R31.** `visibility(status, { author, member })` devolve `full`, `refused`
  ou `absent`; um membro que não é autor recebe sempre `absent`.
  `questionAccess` perde o terceiro parâmetro e `QuestionWithCourse.released`
  some.
- **R32.** `question.read-public` passa a valer só para o autor.
  `filter.public: true` continua existindo para o autor pedir a metade
  pública. `question.findOne` devolve `null` e `findMany`/`findPage` devolvem
  lista vazia para qualquer membro que não é autor.
- **R33.** `exam.findOne` e `exam.findMany` devolvem `questions: []` para quem
  não escreve o conteúdo do curso e não tem grant naquela prova. A decisão vem
  de `grantViews`, em lote, sem escrita.
- **R34.** `studentViews` (`grading-job.service.ts`) emite o grant pela
  `response`, lê o documento por `grantedDocument` e usa
  `grant.view === "review"` como liberação. Sem grant, o relatório não sai.
- **R35.** `exam.questionAttachment`: quem escreve o conteúdo do curso lê como
  hoje; o aluno precisa de grant e recebe o anexo da versão do grant.
- **R36.** `exam.attachment` (anexos da prova em si) continua pela fase
  pessoal, sem grant.
- **R37.** A simulação do instrutor usa o caminho do aluno: `forAttempt`,
  `reviews` e `studentViews` com a tentativa `preview`.
- **R38.** O aluno com a tentativa `submitted` continua lendo o enunciado.
- **R39.** O faltante, depois da liberação, lê só os enunciados públicos. Sem
  revisão e sem gabarito.

Troca nos chamadores:

| Chamador | Hoje | Passa a |
| :-- | :-- | :-- |
| `src/pages/[discipline]/[course]/exams/[slug].astro` | `loadExamQuestions(..., true, { actor })` | `db.examQuestion.forAttempt` |
| `.../exams/[slug]/preview.astro` | idem, com o ator instrutor | `forAttempt` com a simulação |
| `src/utils/load-attempt-view.ts` | `db.question.codeAnswer` por questão; `showQuestions` | campo `code` de `forAttempt`; `showQuestions` sai |
| `src/utils/load-review.ts` | `findOne` com `FULL_ACCESS` | apagado; `db.examQuestion.reviews` |
| `src/utils/load-student-home.ts` | `db.question.findOne` por slug | `db.examQuestion.titles` por prova com regrade resolvido |
| `resolveExamQuestion` | `tx.questionData.findFirst` | `unsafePinnedDocument` |
| `studentViews` | `releasedToStudents` e `codeDocument` | grant e `grantedDocument` |
| `exam.questionAttachment` | `downloadableExam` | autor como hoje; aluno com grant |

`loadExamQuestions` fica para os chamadores de instrutor.

### D. REST e permissões

| Rota | Mudança |
| :-- | :-- |
| `GET /api/course/{d}/{c}/question` e `/{slug}` | Aluno: lista vazia e 404 sempre. Schema igual. |
| `GET /api/course/{d}/{c}/exam/{slug}/questions` (nova) | `forAttempt`; 404 sem grant. |
| `GET .../exam/{slug}/question/{q}/attachment/{name}` | Aluno precisa de grant. |
| `POST .../submit`, `POST .../response` | Contrato igual; criar a tentativa congela as versões. |
| `GET` e `PUT .../exam/{slug}` | Saída ganha `questionsFrozenAt`; `questions` vazia sem grant; `version` enviado é ignorado depois do congelamento. |
| `GET /api/question/{publicId}/attachment/{name}` | Sem mudança. |

| Papel | Ler durante | Ler entregue | Revisão | `db.question` | Enviar resposta |
| :-- | :-- | :-- | :-- | :-- | :-- |
| Aluno | na tentativa | sim | após liberar | nada | na janela |
| Aluno de segunda chamada | na janela pessoal, mesmo com a turma encerrada | sim | após liberar | nada | na janela pessoal |
| Faltante | não | não | só enunciado, após liberar | nada | não |
| Instrutor do curso | tudo, como autor | tudo | tudo | tudo | só simulação |
| Admin fora do curso | o que `course.update-contents` já dá, sem mudança | idem | idem | idem | não |
| `SYSTEM` | nunca recebe grant; lê por `unsafePinnedDocument` | | | tudo | |

- **R40.** A rota nova é declarada em `src/api/index.ts` com `GET(...)`,
  `operationId: "examAttemptQuestions"`, saída `attemptQuestionsSchema`, e
  ganha exemplo em `test/bruno/`.
- **R41.** `pnpm run openapi:cli` roda uma vez, no fim, e o snapshot e o
  cliente gerado entram no mesmo commit. Se a sessão da correção de objetivas
  ainda tiver mudança de API pendente, quem chegar por último regenera.
- **R42.** Não há rota REST de revisão do aluno.

### E. Telas

- **R43.** Aluno com tentativa: nada muda na tela.
- **R44.** Faltante, depois da liberação: a página da prova lista os
  enunciados em modo leitura, sem campos de resposta, sem revisão e sem
  gabarito. Antes da liberação a página fica como hoje.
- **R45.** Instrutor: o cartão da prova mostra "versões congeladas em <data>"
  quando `questionsFrozenAt` existe. A mensagem entra no i18n.

### F. CLI

- **R46.** Em `cli/` muda só o cliente gerado.
- **R47.** `cli/README.md` ganha um aviso: o slug da questão fica visível ao
  aluno durante a prova, então não deve entregar a resposta nem a pegadinha.

### G. Dados de dev

Hoje toda prova do seed fixa `v1`. Nenhuma prova nova: os estados entram nas
que existem.

- **R48 (X1).** `midterm`, agendada: uma questão sem versão.
- **R49 (X2).** `test-03`, aberta: uma questão entra sem versão, a primeira
  tentativa congela, e depois o seed grava uma `v2` dela. O pin fica diferente
  da última versão.
- **R50 (X3).** `midterm` fixa `factorial-of-five` em `v2`; `quiz-01` e
  `test-01` seguem em `v1`. É o caso B1.
- **R51 (X4).** `test-01`, notas liberadas: um aluno matriculado sem
  tentativa, o faltante que lê.
- **R52 (X5).** `test-02`, em correção: um aluno sem tentativa, o faltante que
  não lê, e uma exceção com data futura, a segunda chamada pendente.
- **R53 (X6).** `practice`: uma questão sem versão, que segue a última.

### H. Guarda por lint

- **R54 (K3).** `noRestrictedImports` proíbe importar
  `@/db/services/exam-questions` em todo o projeto, com `overrides` no
  `biome.json` liberando `src/db/**`.
- **R55 (K1).** Plugin GritQL em `lint/` proíbe `.questionData.`,
  `privatePayload`, `publicPayload` e `latest: true` fora de
  `question.service.ts`, `exam-questions.ts`, `src/db/bootstrap.ts`,
  `src/fixtures/` e `src/mdq/legacy.ts`.
- **R56 (K2).** `unsafePinnedDocument` só é chamado em `submission.service.ts`,
  `grading-job.service.ts`, `exam.service.ts`, `rubric-store.ts` e
  `answer-edit.service.ts`.
- **R57 (K4).** `db.question.*` com `FULL_ACCESS` ou `actor: SYSTEM` é
  proibido em `src/utils/`, `src/pages/`, `src/actions/` e `src/api/`.
- **R58.** A tarefa começa por um spike: o plugin GritQL do Biome 2.5 pode ser
  restrito por arquivo? Se não puder, K1, K2 e K4 viram
  `test/question-data-sweep.spec.ts`, unit, no molde de
  `test/conditional-write-sweep.spec.ts`, com os limites da varredura no topo
  do arquivo. O resultado do spike fica registrado nesta spec.
- **R59.** `pnpm run lint` falha quando qualquer regra K é violada, seja por
  lint ou por teste.

**Resultado do spike (T9).** K1 a K4 couberam no Biome; não há
`test/question-data-sweep.spec.ts`. O `plugins` aceita `overrides` com
`includes` e negações (`!caminho/**`), então cada plugin GritQL
(`lint/question-content.grit`, `pinned-document.grit`,
`question-system-access.grit`) roda só fora da sua lista de exceções; K3 é um
override de `noRestrictedImports` (repete o caminho de `@/core/schemas`, pois o
override substitui as opções). Duas exceções além das listadas: K1 libera
também os cinco serviços de K2 (eles selecionam `privatePayload` ao chamar
`unsafePinnedDocument`) e `test/**`; K3 libera `test/exam-grant.spec.ts` e
`test/exam-freeze.spec.ts`. Limite: a regra é textual, um alias de `db.question`
não é visto.

## Fora do escopo

- **`publicId` no lugar do slug** para o aluno. Depois de R33 o slug só chega
  a quem já lê o enunciado, o título entrega o mesmo tema, e a troca tocaria
  `Submission`, `ExamResult`, regrade, feedback e a fila de correção. Se um
  dia houver sorteio de questões, a chave certa é por tentativa, não o
  `publicId`.
- **Gabarito para o aluno**: `dev/issues/aluno-ve-gabarito-apos-liberacao.md`,
  em outra sessão.
- **Rota REST de revisão do aluno.**
- **Trocar o pin de uma prova congelada**: ação da web, ligada a
  `dev/issues/repinar-versao-nao-recorrige-objetivas.md`.
- **Sorteio de questões por aluno.**

## Coordenação com a sessão da correção de objetivas

- A spec `correcao-objetivas-e-ajustes-de-nota` mexe em
  `src/utils/load-attempt-view.ts`, `src/utils/load-review.ts` e
  `src/components/exam/ExamAttempt.tsx` nas tarefas T6 e T7 dela.
- As nossas T6 e T11 tocam os mesmos arquivos e só começam depois de combinar
  a ordem com aquela sessão.
- Se ela já tiver posto `adjustments` e `original` em `load-review.ts`, a
  nossa `reviews` leva essa lógica junto ao apagar o arquivo.
- Quem chegar por último regenera `openapi:cli` (R41).

## Plano de ação

Papéis, como na skill `new-feature`: um projetista de testes (`opus`), o mesmo
do começo ao fim, lista os casos de cada tarefa com lógica; um escritor de
testes transforma a lista em código e confirma que falha pelo motivo certo; um
implementador (`sonnet`) faz passar sem editar os testes. Tarefa mecânica vai
direto ao implementador. Todo subagente lê os ADRs 0004 a 0006 e o RFC
`como-criar-e-escrever-um-service` antes de tocar `src/db/`.

Ordem: T1 sozinha. Depois T2 e T3 em paralelo, em worktrees. T4 depois de T3.
T5 depois de T2 e T3. T6, T8 e T10 depois de T4. T7 depois de T5 e T6. T9 tem
o spike a qualquer momento e a lista final depois de T7. T11 depois de T6 e
T10. T12 depois de T2 e T6. T13 por último. `exam.service.ts` é tocado por T1,
T2 e T5, e `exam-questions.ts` por T1, T2 e T3: merge nessa ordem.

### T1. Módulo e leitores de sistema

- Arquivos: `src/db/services/exam-questions.ts` (novo),
  `submission.service.ts`, `grading-job.service.ts`, `exam.service.ts`,
  `answer-edit.service.ts`, `rubric-store.ts`, `src/db/empty-attempt.ts` (só
  imports).
- Requisitos: R24, e a mudança de `examTimingFromDb`, `examTimingSelect` e
  `loadExceptionTiming` para o módulo.
- Dependências: nenhuma.
- Modelo: `sonnet`. Refatoração pura, sem projetista.
- Pronto: `rtk pnpm run test:unit` e `pnpm run typecheck` saem 0;
  `grep -rn "\.questionData\." src/db/services` só mostra
  `question.service.ts` e `exam-questions.ts`.

### T2. `questionsFrozenAt` e congelamento

- Arquivos: `prisma/schema.prisma`, `src/core/schemas/exam.ts`,
  `exam-questions.ts`, `exam.service.ts`, `response.service.ts`,
  `src/db/empty-attempt.ts`, `test/exam-freeze.spec.ts` (novo).
- Requisitos: R1 a R8, R10 a R12.
- Dependências: T1.
- Modelo: escritor `sonnet`, implementador `sonnet`.
- Pronto: `test/exam-freeze.spec.ts` passa, com os casos: primeira tentativa
  congela; push depois não troca a versão validada e corrigida; push antes
  troca; reenviar a lista mantém os pins, fixa a questão nova e tira a
  removida; `PRACTICE` e simulação não congelam; `close` e `releaseGrades`
  congelam; duas criações seguidas gravam o mesmo pin.

### T3. Grant: emissão, verificação e leitores

- Arquivos: `exam-questions.ts`, `src/fixtures/exam.factory.ts`,
  `test/exam-grant.spec.ts` (novo).
- Requisitos: R9, R14 a R23.
- Dependências: T1. Paralela a T2.
- Modelo: escritor `sonnet`, implementador `sonnet`.
- Pronto: `test/exam-grant.spec.ts` passa, com uma linha de teste por linha da
  tabela de R19, mais: segunda chamada com a turma encerrada; tentativa vazia
  (R20); grant forjado, de outro usuário e vencido são recusados (R16); versão
  fixada inexistente fica fora (R22); mesma questão em duas provas dá `dataId`
  diferentes; prova antiga congela na emissão (R9).

### T4. Service `db.examQuestion`

- Arquivos: `src/db/services/exam-question.service.ts` (novo),
  `src/core/schemas/exam-question.ts` (novo), `src/core/schemas/all.ts`,
  `src/db/index.ts`, `src/services/review.ts` (schema de `ReviewResult`),
  `test/exam-question-service.spec.ts` (novo).
- Requisitos: R25 a R29, R37 a R39.
- Dependências: T3.
- Modelo: escritor `sonnet`, implementador `sonnet`.
- Pronto: a spec passa, com: `forAttempt` é `null` em `can-start` com a prova
  aberta (B6); não devolve `tags`; `pretests` só com `answering`; `reviews` é
  `{}` antes da liberação e nunca devolve a chave de resposta; faltante lê só
  depois da liberação; simulação lê pelo mesmo caminho.

### T5. `studentViews`, anexo de questão e `exam.findOne`

- Arquivos: `grading-job.service.ts`, `exam.service.ts`, `exam-questions.ts`
  (`grantViews`, se T3 não entregou), specs existentes desses services.
- Requisitos: R21, R33 a R36.
- Dependências: T2, T3.
- Modelo: escritor `sonnet`, implementador `sonnet`.
- Pronto: `test:unit` passa com casos novos: aluno sem tentativa não baixa
  anexo de questão com a prova aberta; `exam.findOne` e `findMany` devolvem
  `questions: []` sem grant e a lista com grant; o relatório do runner não sai
  sem grant.

### T6. Chamadores de página e utils

- Arquivos: `src/pages/[discipline]/[course]/exams/[slug].astro`,
  `.../exams/[slug]/preview.astro`, `src/utils/load-attempt-view.ts`,
  `src/utils/load-review.ts` (apagar), `src/utils/load-student-home.ts`.
- Requisitos: R28 (apagar o arquivo), R37, R43, tabela de chamadores.
- Dependências: T4. Espera a combinação com a sessão da correção de objetivas.
- Modelo: `sonnet`.
- Pronto: `rtk pnpm exec tsx test/run.ts --scope=e2e` nas specs de prova do
  aluno, da simulação e da home passa; `grep -rn "FULL_ACCESS" src/utils` não
  mostra leitura de questão; `pnpm run typecheck` sai 0.

### T7. Tirar o ramo de membro do question service

- Arquivos: `question.service.ts`, `src/services/question-status.ts`,
  `src/auth/access.ts`, `src/auth/permissions/index.ts`,
  `test/question-service.spec.ts`, `test/access.spec.ts`,
  `test/permissions.spec.ts`, `test/permission-where.spec.ts`,
  `test/question-status.spec.ts`, `test/question-pages.spec.ts`,
  `test/api-attachments.spec.ts`, `test/question-attachments.spec.ts`.
- Requisitos: R30 a R32.
- Dependências: T5, T6.
- Modelo: escritor `sonnet`, implementador `sonnet`.
- Pronto: `test:unit` passa; um membro não autor recebe `null` e lista vazia
  de `db.question` com a prova aberta, encerrada e liberada;
  `grep -n "isReleased\|releasedRefIds\|codeAnswer" src/db/services/question.service.ts`
  não devolve nada.

### T8. REST

- Arquivos: `src/api/index.ts`, `test/bruno/`, spec de API da rota nova,
  `cli/resources/openapi/codehood.json`, `cli/codehood/api/generated.py`.
- Requisitos: R40 a R42, R46.
- Dependências: T2, T4.
- Modelo: `sonnet`.
- Pronto: a spec da rota passa (200 com grant, 404 sem);
  `test/openapi-snapshot.spec.ts` passa; em `cli/`, `rtk uv run pytest` passa.

### T9. Guarda

- Arquivos: `biome.json`, `lint/` (novo), ou
  `test/question-data-sweep.spec.ts`; esta spec (resultado do spike).
- Requisitos: R54 a R59.
- Dependências: spike sem dependência; lista final depois de T7.
- Modelo: `sonnet`.
- Pronto: `pnpm run lint` sai 0; um arquivo de prova com cada violação (K1 a
  K4), criado e removido na tarefa, faz o lint ou o teste falhar.

### T10. Histórias e e2e do faltante

- Arquivos: `docs/user-stories/student.md`,
  `test/stories/student-exams.test.ts`.
- Requisitos: R44.
- Dependências: T4.
- Modelo: escritor `sonnet`.
- Pronto: uma história, "Read the questions of an exam I missed": antes da
  liberação não há enunciado; depois, a lista aparece sem campos de resposta.
  O teste falha porque a tela não existe; `pnpm run stories --check` sai 0.

### T11. Telas

- Arquivos: `src/components/exam/ExamAttempt.tsx`,
  `src/pages/[discipline]/[course]/exams/[slug].astro`, cartão da prova do
  instrutor, mensagens de i18n.
- Requisitos: R44, R45.
- Dependências: T6, T10. Espera a combinação com a sessão da correção de
  objetivas.
- Modelo: `sonnet`.
- Pronto: a história de T10 passa; o cartão do instrutor mostra a data em
  `test-03`.

### T12. Seed

- Arquivos: `src/db/bootstrap.ts`.
- Requisitos: R48 a R53.
- Dependências: T2, T6.
- Modelo: `sonnet`. A ordem importa em X2 (a `v2` nasce depois da primeira
  tentativa), então não é tarefa de `haiku`.
- Pronto: `pnpm run db:reset` sai 0; os seis estados são vistos no dev server
  com o aluno e o instrutor do seed.

### T13. Fechamento

- Arquivos: `cli/README.md`, `GLOSSARY.md`, `BACKLOG.md`, `CHANGELOG.md`,
  apagar `dev/issues/versao-da-questao-fixada-ao-iniciar-o-exame.md` e
  `dev/issues/prova-questao-sem-versao-recusa-resposta-apos-sync.md`, mover
  esta spec para `dev/specs/to-review/`.
- Requisitos: R13, R47.
- Dependências: todas.
- Modelo: `haiku`.
- Pronto: `pnpm exec biome check --write .`, `pnpm run lint` e `rtk pnpm test`
  saem 0.

## Critérios de aceite

Cada furo fechado tem um teste que o prova. A evidência é a saída do teste.

| Furo | Prova |
| :-- | :-- |
| B1, versão | `test/exam-grant.spec.ts`: questão em `v1` num quiz encerrado e em `v2` numa prova agendada; o aluno recebe `v1` pelo quiz e nada pela prova. `test/exam-freeze.spec.ts`: push depois do congelamento não troca a versão servida. |
| B6, tentativa | `test/exam-question-service.spec.ts`: prova aberta, aluno sem tentativa, `forAttempt` é `null`; a rota REST responde 404; o anexo de questão responde 404. |
| B7, `load-review` | `src/utils/load-review.ts` não existe; `reviews` é `{}` antes da liberação; a regra K4 falha com um `db.question.findOne(..., FULL_ACCESS)` posto em `src/utils/`. |
| B8, home | `test/question-service.spec.ts`: membro não autor recebe `null` com a prova liberada; a home mostra o título do regrade por `titles`. |
| C3, guarda | `pnpm run lint` falha com `tx.questionData.findFirst` posto em outro service, e com um import de `exam-questions` posto em `src/pages/`. |
| C5, estado | `test/exam-grant.spec.ts`: depois de arquivar a prova, de remover a exceção e de desmatricular, a emissão seguinte é `null`; um grant vencido é recusado. |
| Custo | Com `TEST_PERF_LOG`, a página da tentativa lê as questões em uma consulta a `questionData`, não uma por questão. |

O humano confere no dev server, com o seed:

- Aluno em `test-03` vê as questões só depois de iniciar a tentativa.
- Faltante de `test-01` vê os enunciados em leitura; o de `test-02` não vê.
- Instrutor vê "versões congeladas em <data>" em `test-03`, e a simulação
  mostra as mesmas questões que o aluno vê.

## Termos propostos para o `GLOSSARY.md`

- **Exam grant**: prova, emitida pelo servidor a partir da tentativa, de que
  um aluno pode ler as questões de uma prova.
- **Version freeze**: fixação da última versão em cada questão sem pin, na
  primeira tentativa, no encerramento ou na liberação das notas.
- **Missed**: estado do aluno com a prova encerrada e sem tentativa própria.
