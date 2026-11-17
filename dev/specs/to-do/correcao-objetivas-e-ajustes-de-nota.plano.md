---
type: plan
status: to-do
spec: correcao-objetivas-e-ajustes-de-nota
created: 2026-11-17
creator: claude
---

# Plano de TDD: correção de objetivas e ajustes de nota

Base: a spec `correcao-objetivas-e-ajustes-de-nota.md` e o T1 no commit
`0f17b68` (branch `worktree-agent-a9159968c0e68508b`). Tudo abaixo assume o T1
mergeado em `main`.

O que o T1 entregou e este plano usa como dado:

- Prisma `ExamAdjustment` (`op`, `value`), enum `ExamAdjustmentOp`; relações
  `Response.adjustments`, `User.adjustmentsCreated`, `User.adjustmentsRevoked`.
- `src/core/schemas/exam-adjustment.ts`: `examAdjustmentOp`,
  `adjustmentValueError(op, value, onQuestion)`, `percentToFraction`,
  `fractionToPercent`, os schemas de form (porcentagem) e de REST (fração).
- `src/db/services/exam-adjustment.service.ts` (`db.examAdjustment`):
  `create`, `findOne`, `findMany`, `update`, `revoke`, com C3 e C4. `create`
  ainda exige tentativa real (`attemptsOf`).
- `src/db/active-adjustments.ts` (`activeAdjustmentsOf`), Action
  `actions.examAdjustment.{create,update,revoke}`, permissões
  `exam-adjustment.*`, chaves `errors_exam_adjustment_*` e
  `forms_schema_adjustment_*`.
- Não feito: rotas REST ainda em `/sanction` (T3); `sanctionsByResponse` e
  `examResult` só leem `FACTOR` (T2); a UI segue com `Sanction*`,
  `grades_sanction_*`, `ExamResult.sanction` e `sanctions.astro` (T2, T6).

## 1. Revisão de arquitetura da spec

1. **B4a aponta o arquivo errado.** A promoção do último autosave a `FINAL` está
   em `src/db/services/grading-job-queue.ts` (`promoteFinalSends`), não em
   `answer-edit.service.ts`. Ela só age em questão `code` com `worker` e
   payload `string`, então o `null` do professor já é pulado hoje. *Decido
   eu:* T4 acrescenta `createdById: null` à busca do autosave mais novo (defesa
   explícita), e o teste de B4a usa uma questão `code` com `worker`, senão
   passa sem provar nada.
2. **B5 cita "R17 abaixo", que não existe.** *Decido eu:* a nota de questão sem
   resposta exige que a tentativa do aluno esteja encerrada
   (`isFinished(attemptOf(...))` com a exceção dele); sem tentativa, vale a E2
   (fase `closed` ou `archived` para o aluno). Com resposta real, não há
   condição: segue `grading.grade` como hoje.
3. **Passe automático não tem `botId`.** `gradeObjectives` grava o passe `auto`
   com `graderId` e `botId` nulos. *Decido eu:* "automático" é
   `grader === null`, "humano" é `grader !== null`. O texto da A10 continua
   correto.
4. **"Desfazer" contradiz o glossário.** O passe que volta à nota automática é
   humano e mais novo, então a resposta continuaria "alterada à mão". *Decido
   eu:* o passe de desfazer usa `ref` com prefixo `REVERT_REF_PREFIX = "revert-"`,
   e `isManualChange` não conta um passe mais novo com esse prefixo. Desfazer
   numa submissão criada pelo professor grava 0 (a nota de quem não
   respondeu). A issue da A10 (T5c) passa a dizer que a recorreção trata um
   passe `revert-` como não humano.
5. **"Revisar" sem regra.** A spec só diz "`diagnosis` presente"; os mockups usam
   limiares diferentes por tipo, escritos à mão. *Decido eu:* uma regra única
   (seção 2.4, `needsReview`): uma linha errada é "revisar" quando a média dos
   seus alunos nas outras questões é ≥ à média de quem acertou a questão (no
   V/F, de quem acertou a afirmação). Linhas certas nunca são "revisar".
6. **Numérica: "erro típico" e "unidade errada" não têm fonte.** O mdq não
   guarda erros típicos nem unidade por resposta errada. *Decido eu:* sem tag e
   sem cor âmbar. A faixa vem de `answer` e `tolerance` (seção 2.4).
7. **"Em branco" colide com lacuna.** `answerGradeBlanks`, `BlankGradeForm` e
   `blanks` já se referem às lacunas da fill-in. *Decido eu:* a operação da B3 se
   chama `gradeUnanswered` (service, Action e schema).
8. **Conflitos com a sessão do runner.** `response.service.ts` e
   `submission.service.ts` precisam de `createdBy` no `fromDb` (T4);
   `ExamAttempt.tsx` é lido por T2 e T7; `bootstrap.ts` é T8; `exam.service.ts`
   chama `sanctionsByResponse`. *Decido eu:* a operação nova vai para um service
   novo (`manual-grade.service.ts`) e para `src/db/empty-attempt.ts`, não para
   os services em conflito; `sanctionsByResponse` fica como alias até o T8, e
   assim `exam.service.ts` não muda. O coordenador confere `git status` de
   `main` antes de lançar T2, T4, T7 e T8: se algum daqueles arquivos ainda
   estiver sujo, a tarefa espera.
9. **T2 quebra tipos de UI fora do seu raio.** Remover `ExamResult.sanction`
   quebra `GradesTable.astro`, `ExamResults.tsx`, `attempts/[username].astro`,
   `ExamAttempt.tsx` e `grades-table.ts`. *Decido eu:* T2 adapta esses leitores
   no mínimo para compilar (total original riscado e total final, sem texto por
   operação). Os textos por operação chegam em T6 e T7.
10. **Bug herdado do T1 no bloqueio de revisão.** `regrade-request.service.ts`
    marca `examSanctioned` com qualquer ajuste da prova, então um bônus bloqueia
    a revisão, e passa `value` como `factor` de qualquer operação. *Decido eu:*
    T2 corrige com `reducesGrade` (D8a).
11. **Página da tentativa dá 404 sem tentativa.** A lista de alunos da G1 leva a
    alunos "sem tentativa", e a G1 permite substituir a nota deles. *Decido eu:*
    a página abre para aluno matriculado sem tentativa: cabeçalho, ações,
    questões como não respondidas. "Alterar nota" chama `gradeUnanswered`, que
    cria a tentativa vazia.
12. **Onde excluir o que o professor criou.** `countingAnswers` alimenta a fila,
    a página de correção e as estatísticas; filtrar ali esconderia as linhas da
    A7. *Decido eu:* `countingAnswers` carrega `createdBy` em cada resposta, e o
    filtro fica só em `question-stats.ts` (`questionStats`,
    `closedAttemptCount`, `scoreRows`, `answerDistribution`) e nos grupos da
    T5. Outros contadores ("N tentativas" nas listas de provas) contam a
    tentativa vazia: fora do escopo; T8 abre issue se algum ficar enganoso.
13. **Situação "em andamento" falta na G1.** *Decido eu:* a lista tem cinco
    situações: `none`, `in-progress`, `pending`, `adjusted`, `submitted`.
14. **D5 com base negativa.** Pela letra, uma penalidade `OFFSET` numa base
    negativa não tem efeito (trava em `min(base, 0)`), e os fatores se aplicam um
    a um só enquanto o valor é positivo. *Decido eu:* seguir a letra e cobrir com
    teste.
15. **Histórias quebram o lint.** `pnpm run stories --check` falha quando um
    teste cita uma história que não existe, e a spec deixa
    `docs/user-stories/*` para o T8. *Decido eu:* cada tarefa de UI escreve a
    história nova (ou renomeia a antiga) junto com o teste; o T8 só revisa.
    Pelo mesmo motivo, T4 também roda `pnpm run openapi:cli`, porque
    `Response` e `Submission` ganham `createdBy` nos modelos de leitura.

## 2. Interfaces por tarefa

Convenções: frações em `[-1, 1]` nos services; porcentagem só na borda do
formulário. Datas em `Date` nos services, ISO nas props de ilhas.

### 2.1 T2: composição em `src/services/exam-result.ts`

```ts
export type AdjustmentOp = "SET" | "FACTOR" | "OFFSET";

/** An active adjustment of an attempt: on one question by slug, or on the whole exam when `question` is `null`. */
export interface ResultAdjustment {
	question: string | null;
	op: AdjustmentOp;
	/// A decimal string, as stored.
	value: string;
	reason: string | null;
}

/** Groups the adjustments of every operation by the `publicId` of the attempt they hit, dropping any other field (notes). */
export function adjustmentsByResponse(
	views: readonly { response: string; question: string | null; op: AdjustmentOp; value: string; reason: string | null }[],
): ReadonlyMap<string, ResultAdjustment[]>;

/** @deprecated Alias kept for `exam.service.ts`; removed in T8. */
export const sanctionsByResponse = adjustmentsByResponse;

/** Whether the adjustment lowers a grade: a `FACTOR` below 1. Only these block a regrade request. */
export function reducesGrade(adjustment: { op: AdjustmentOp; value: string | number }): boolean;

/**
 * The exam total after the exam-level adjustments, or `null` when `base` is `null` and nothing fixes the total.
 *
 * Order: a FACTOR 0 gives 0; else base is the SET value or `base`; each FACTOR multiplies it while it is positive;
 * every OFFSET is added; the result is clamped to `[min(b, 0), 1]`, `b` being the base before the factors.
 */
export function adjustTotal(
	base: number | null,
	adjustments: readonly { op: AdjustmentOp; value: string | number }[],
): number | null;

/** Whether the adjustments define the total by themselves: a SET, or a FACTOR 0. */
export function fixesTotal(adjustments: readonly { op: AdjustmentOp; value: string | number }[]): boolean;
```

Mudanças de tipo:

- `examResult(questions, submissions, feedback, adjustments: readonly ResultAdjustment[], policy?)`.
  Parâmetro continua obrigatório.
- `QuestionOutcome.sanction` vira
  `adjustment?: { op: "FACTOR"; value: number; reason: string | null; original: { status; score } }`.
  Status `"sanctioned"` continua. Só `FACTOR` de questão é lido; se houver mais
  de um (dado inválido), vale o menor. Ajuste de questão fora da prova é
  ignorado (C5).
- `ExamResult.sanction` sai; entram, juntos e só quando há ajuste de prova
  ativo:
  `adjustments?: { op: AdjustmentOp; value: number; reason: string | null }[]`
  (ordem: SET, FACTORs, OFFSETs; dentro da mesma operação, a ordem da entrada) e
  `original?: { total: number | null }` (total depois de D1, antes dos ajustes
  da prova).
- `pending` é 0 quando `fixesTotal(...)`; senão conta como hoje. `total` é
  `adjustTotal(totalOf(...), exam-level)`.
- `ResultSanction` é removido (sem alias: só há usos internos e de teste).
- `AttemptRow.sanction` (em `src/services/grading.ts`) vira
  `adjustments?` + `original?`, copiados de `ExamResult`. O mesmo em
  `grades-table.ts` (célula `total`).
- `src/services/regrade.ts`: `RegradeContext.examSanctioned` vira
  `examReduced: boolean`; o blocker `"sanctioned"` dispara com
  `ctx.examReduced || outcome.adjustment !== undefined`.
- Chamadores que montam `examReduced`: `load-attempt-view.ts`
  (`result?.adjustments?.some(reducesGrade) ?? false`) e
  `regrade-request.service.ts` (ajustes da prova com `reducesGrade`; os de
  questão viram `ResultAdjustment` com `op` e `value` reais).
- Textos (novo, `src/utils/adjustment-label.ts`, usado por T6 e T7):

```ts
/** The text of one adjustment for the student and the instructor, e.g. "Bônus +10", "Penalidade ×0,5", "Nota substituída por 80%", "Zerada". */
export function adjustmentLabel(adjustment: { op: AdjustmentOp; value: number }): string;
```

  `SET` → `grades_adjustment_set({ percent })` ("Nota substituída por 80%");
  `FACTOR` 0 → `grades_adjustment_zeroed` ("Zerada"); `FACTOR` < 1 →
  `grades_adjustment_penalty_factor({ factor })` ("Penalidade ×0,5");
  `FACTOR` ≥ 1 → `grades_adjustment_bonus_factor` ("Bônus ×1,1"); `OFFSET` > 0
  → `grades_adjustment_bonus_offset({ points })` ("Bônus +10"); `OFFSET` < 0 →
  `grades_adjustment_penalty_offset({ points })` ("Penalidade −10", com U+2212
  e `points` sem sinal). Números com o separador decimal do locale, sem zeros à
  direita. Chaves novas em `messages/{pt-BR,en}/grades.json`.

### 2.2 T3: REST

- Rotas: `GET/POST /api/v1/.../exam/[slug]/adjustment`,
  `GET/PATCH /adjustment/[id]`, `POST /adjustment/[id]/revoke` (os mesmos
  verbos das rotas `/sanction` de hoje; ver `src/api/index.ts`). As rotas
  `/sanction` somem (sem alias: a CLI não as usa).
- Corpo de criação: `examAdjustmentCreateBody` (já no T1): `usernames`,
  `question?`, `op`, `value` (fração), `reason?`, `notes?`. Atualização:
  `examAdjustmentUpdate`. Entidade OpenAPI "Exam Adjustment".
- `src/api/registry/route-patterns.json`, `test/bruno/exam-adjustment/*`
  (Create, List, Update se existir, Revoke), `pnpm run openapi:cli`.

### 2.3 T4: tentativa vazia, nota sem resposta, `createdBy`, estatísticas

Schema:

- `prisma/schema.prisma`: `Submission.createdById String?` e
  `Response.createdById String?`, ambos `@relation(..., onDelete: Restrict)`
  para `User` (como `Feedback.graderId`), com relações reversas em `User`
  (`submissionsCreated`, `responsesCreated`).
- `src/core/schemas/submission.ts`: `submissionSchema` ganha
  `createdBy: username.nullable()` ("Server state: the instructor who created
  the submission; `null` for the student's own."). Fica fora de
  `submissionCreate` e `submissionUpdate`.
- `src/core/schemas/response.ts`: `responseSchema` ganha
  `createdBy: username.nullable()`. Fora dos corpos de criação e atualização.
- `fromDb` de `submission.service.ts` e `response.service.ts` preenche os campos
  (só a leitura muda nesses dois arquivos).

Helper de banco, `src/db/empty-attempt.ts` (interno a `src/db/`):

```ts
/**
 * The id of the student's graded attempt at the exam, creating an empty one when there is none.
 *
 * An empty attempt is closed (`acceptingSubmissions: false`, `closedAt: now`), `slotKey: 0`,
 * `preview: false`, has no submissions and carries `createdById`. An existing attempt is reused.
 *
 * @throws {@link InvalidData} keyed on `field`: the exam is `PRACTICE`; the student has no `ACTIVE`
 * enrollment (only checked when creating); the exam's phase for the student, with their exception, is
 * `draft`, `upcoming` or `open`; or `requireFinished` and the existing attempt is not finished.
 */
export async function attemptOrEmpty(
	tx: PrismaTx,
	input: { examId: number; author: string; createdBy: string; now: Date; field: string; requireFinished: boolean },
): Promise<{ id: number; publicId: string; created: boolean }>;
```

Chaves novas: `errors_empty_attempt_practice`, `errors_empty_attempt_not_enrolled`,
`errors_empty_attempt_exam_open` (cobre draft, upcoming e open),
`errors_empty_attempt_in_progress`.

`exam-adjustment.service.ts`: `attemptsOf` usa `attemptOrEmpty` (com
`field: "usernames"`, `requireFinished: false`) para cada aluno sem tentativa,
dentro da mesma transação: recusa de um aluno não deixa linha de nenhum.

Service novo `src/db/services/manual-grade.service.ts`, registrado como
`db.manualGrade`:

```ts
// src/core/schemas/manual-grade.ts
export const unansweredGrade = z.object({
	course: courseRef,
	exam: slug,
	author: username,
	question: slug,
	/// A stored score: a decimal string in [0, 1].
	score: z.string(),
	comment: z.string().nullish(),
});

/**
 * Grades a question the student left unanswered: creates, in one transaction, the empty attempt when
 * needed, an `AUTOSAVE` submission with JSON `null` payload, status `GRADED_MANUALLY` and `createdById`,
 * and a grading pass by the actor with that score.
 *
 * Never checks `assertAcceptingSubmissions`; never creates `SUBMIT` or `FINAL`.
 *
 * @throws {@link NotFound} course, exam, or a question the exam does not carry (`question`).
 * @throws {@link NotAllowed} actor lacks `course.update-contents` on the course.
 * @throws {@link InvalidData} the `attemptOrEmpty` refusals keyed on `author`, with `requireFinished: true`;
 * keyed on `question` when the attempt already has a submission to that question (use `grading.grade`);
 * keyed on `score` when it is not a decimal in [0, 1].
 */
gradeUnanswered(input: z.input<typeof unansweredGrade>, opts: { actor }): Promise<Submission>;
```

Chaves: `errors_manual_grade_answered`, `errors_manual_grade_score`.

Actions em `src/actions/grading.ts` (schemas em `src/core/schemas/answer.ts`):

```ts
/// What "Alterar nota" sends for a question with no answer: the exam page segments, the student, the question, a whole percentage and a comment.
export const answerGradeUnanswered = examParams.extend({ author: username, question: slug, score: <igual a answerGrade.score>, comment: z.string().optional() });

grading.gradeUnanswered  // input answerGradeUnanswered; parsePercentScore; chama db.manualGrade.gradeUnanswered
grading.revert           // input answerRef; grava passe do ator com ref `${REVERT_REF_PREFIX}${uuid}`, score = autoScoreOf(passes) ?? "0" em texto
```

Funções puras em `src/services/grading.ts`:

```ts
/// The prefix of the `ref` of a pass that undoes a change by hand.
export const REVERT_REF_PREFIX = "revert-";

/** The score of the newest pass with no grader (the automatic one), or `null` when there is none. */
export function autoScoreOf(passes: readonly Pick<GradingPass, "grader" | "score" | "updatedAt">[]): number | null;

/**
 * Whether an answer's current verdict was changed by hand: its newest pass has a grader, its `ref` does not start
 * with `REVERT_REF_PREFIX`, and either an earlier pass exists or the instructor created the submission.
 */
export function isManualChange(passes: readonly GradingPass[], createdBy: string | null | undefined): boolean;
```

`CountingAnswer` ganha `createdBy?: string` (presente só quando o professor
criou a submissão). `GradingAttempt` ganha `createdBy?: string | null`
opcional (`Partial<Pick<Response, "createdBy">>`), para não quebrar fixtures.
`ResultSubmission` aceita `createdBy?` e o ignora.

`src/services/question-stats.ts`:

```ts
/** The attempts as statistics read them: instructor-created attempts dropped, and instructor-created submissions dropped from the rest. */
export function measuredAttempts<T extends GradingAttempt>(attempts: readonly T[]): T[];
```

`questionStats` aplica `measuredAttempts` antes de `countingAnswers`,
`closedAttemptCount` e `scoreRows`. `answerDistribution` ignora respostas com
`createdBy` (tipo do parâmetro passa a `Pick<CountingAnswer, "payload" | "createdBy">`).

`grading-job-queue.ts` (`promoteFinalSends`): a busca de `newest` filtra
`createdById: null`. `objective-grading.ts` (`gradeObjectives`): ignora
submissão com `createdById` ao escolher a que conta.

### 2.4 T5a: modelo da página objetiva, `src/services/objective-review.ts` (novo, puro)

```ts
/// The fewest students a group needs for its mean on the other questions to show.
export const GROUP_MEAN_MIN = 3;

/** One counting answer as the objective page reads it. */
export interface ReviewAnswer {
	author: string;
	/// The counting submission's `publicId`.
	submission: string;
	payload: unknown;
	state: AnswerState;
	/// The current verdict in [-1, 1], or `null` unless graded.
	verdict: number | null;
	passes: GradingPass[];
	/// Set when the instructor created the submission.
	createdBy?: string;
	/// The student's mean on the other questions in [-1, 1], or `null` (see `restMeans`).
	restMean: number | null;
}

/** One student of a group. */
export interface GroupMember {
	author: string;
	submission: string;
	autoScore: number | null;   // autoScoreOf(passes)
	score: number | null;       // verdict
	changed: boolean;           // isManualChange
	restMean: number | null;
	/// What this student answered, as `responseSummary` puts it, when it differs from the row text.
	detail?: string;
}

export type ResponseCell =
	| { kind: "choice"; marker: "radio" | "checkbox"; key: boolean; text: string }
	| { kind: "choices"; boxes: { letter: string; on: boolean; key: boolean }[]; text: string }
	| { kind: "text"; text: string }
	| { kind: "chips"; chips: { text: string; ok: boolean }[]; text: string }
	| { kind: "statement"; text: string; truth: boolean; marked: { true: number; false: number } };

/** One row of a grouped table. */
export interface AnswerGroup {
	/// Unique within its section.
	id: string;
	cell: ResponseCell;
	/// A second line under the response, e.g. "3 grafias".
	sub?: string;
	count: number;
	/// count / answers of the section, in [0, 1].
	share: number;
	/// The common verdict of the graded members; "varies" when they differ; `null` with none graded.
	score: number | "varies" | null;
	/// How many members are `changed`.
	changed: number;
	/// Mean of the members' `restMean`, `null` when fewer than GROUP_MEAN_MIN members have one.
	mean: number | null;
	/// Whether the row asks to check the key (see `needsReview`).
	review: boolean;
	members: GroupMember[];
}

export type ReviewSection =
	| { kind: "groups"; block: "choices" | "alternatives" | "combinations" | "statements" | "texts" | "blank" | "values" | "orders";
	    /// The blank's label for `block: "blank"` ("Lacuna 1"), absent otherwise.
	    label?: string;
	    /// Which column the score shows: the score, accepted yes/no/partial, or none.
	    column: "score" | "accepted" | "none";
	    rows: AnswerGroup[] }
	| { kind: "histogram"; histogram: NumericHistogram }
	| { kind: "matrix"; matrix: OrderingMatrix }
	| { kind: "missed"; members: GroupMember[] };   // fill-in: who missed any blank, most misses first

export interface NumericHistogram {
	/// The accepted range of the key: answer ± max(absolute, |answer| × relative); [answer, answer] without tolerance.
	band: { low: number; high: number };
	/// The zoomed axis: the band widened by twice its width each side (by max(|answer| × 0.05, 1) when the band has width 0).
	window: { low: number; high: number };
	/// One bar per distinct value inside the window, ascending, with how many of them scored 1.
	bins: { value: number; count: number; correct: number }[];
	/// Values outside the window: the 4 largest groups by count, then one `value: null` bar with the rest.
	outside: { value: number | null; count: number }[];
}

export interface OrderingMatrix {
	/// The key's lines, in key order.
	steps: string[];
	/// cells[i][p]: how many answers placed step i at position p (line identity as `responseSummary` matches it).
	cells: number[][];
	/// The number of answers the matrix counts.
	answers: number;
}

export type AttentionRow =
	| { kind: "pending"; author: string; submission: string }
	| { kind: "regrade"; author: string; submission: string; request: string };

export interface OverrideRow {
	author: string;
	submission: string;
	kind: "grade" | "sanction";
	/// The automatic score (grade) or the score before the factor (sanction); `null` when the student did not answer.
	auto: number | null;
	final: number | null;
	comment: string | null;
	when: Date;
	/// The adjustment, for `kind: "sanction"`, so the row can revoke it.
	adjustment?: { publicId: string; updatedAt: Date };
}

export interface ObjectiveReview {
	summary: {
		/// Answers that statistics count (no instructor-created ones).
		answers: number;
		/// questionStats.correct for the question, in [0, 1], or `null`.
		correct: number | null;
		/// The discrimination value when `discriminationFlag` flags it, else `null`.
		lowDiscrimination: number | null;
		/// Answers in state `pending`.
		pending: number;
	};
	/// Pending answers first (submission order), then open regrade requests.
	attention: AttentionRow[];
	sections: ReviewSection[];
	/// Manual changes and question sanctions, newest `when` first.
	overrides: OverrideRow[];
}

/**
 * Each author's mean score on the exam's other questions, from `examResult` without adjustments: weighted by
 * the question weights, `pending` questions left out, unanswered and not-graded counting 0; `null` when no other
 * question has a score.
 */
export function restMeans(
	questions: readonly WeightedQuestion[],
	question: string,
	attempts: readonly GradingAttempt[],
	feedback: readonly GradingFeedback[],
	policy?: ResultPolicy,
): Map<string, number | null>;

/**
 * Whether a wrong row asks to check the key: its mean is at least `reference`; `false` when either is `null`
 * or the row is right.
 */
export function needsReview(row: { mean: number | null; right: boolean }, reference: number | null): boolean;

/**
 * The sections of the page for the question's type. Instructor-created answers are left out of every section.
 *
 * - multiple-choice: one "choices" section; a row per choice in document order, then one per removed id, then
 *   "Em branco" when its count > 0. `reference` is the mean of the members with verdict ≥ 1 across the question.
 * - multiple-selection: "alternatives" (a row per choice, members who ticked it, column "none", wrong = not in
 *   the key) then "combinations" (one row per exact set ticked, the 5 largest, then an "others" row; right = verdict ≥ 1).
 * - true-false: "statements"; a row per statement, `count` and members are who judged it wrong or left it
 *   unjudged, column "none"; reference = mean of who judged it right.
 * - short-answer: "texts", grouped by text lower-cased, accents stripped and whitespace collapsed; the row text
 *   is the most common spelling, `sub` the number of spellings; column "accepted".
 * - fill-in: one "blank" section per blank, rows by the blank's text as `responseSummary` gives it, right =
 *   the blank's mark from `reviewResult` is 1; column "accepted"; then one "missed" section.
 * - numeric: "histogram" then "values" (a row per distinct value, largest first; column "score").
 * - ordering: "matrix" then "orders" (a row per distinct whole order, `chips` with ok = line at its key position).
 * - any other type: [].
 */
export function answerSections(question: QuestionDocument, answers: readonly ReviewAnswer[]): ReviewSection[];

/** The whole page model; `answerSections` plus summary, attention and overrides. */
export function objectiveReview(input: {
	question: QuestionDocument;
	slug: string;
	answers: readonly ReviewAnswer[];
	stats: Pick<QuestionStats, "correct" | "discrimination">;
	/// Open regrade requests on this question: submission publicId → request publicId.
	regrades: ReadonlyMap<string, string>;
	/// Active adjustments on this question, by author.
	sanctions: ReadonlyMap<string, { publicId: string; value: number; reason: string | null; updatedAt: Date }>;
}): ObjectiveReview;
```

Regras comuns: `share` e `percent` sobre o total de respostas da seção;
`mean` como em `AnswerGroup`. "Sem nota" = `state === "pending"`. Uma linha
`sanction` em `overrides` tem `auto` = verdict antes do fator e `final` =
verdict × value (fator só em nota positiva), `when` = `updatedAt` do ajuste.

### 2.5 T5b: componentes e página

Movidos do playground (sem `_`), em `src/components/grading/`:

| Arquivo | Origem | Props públicas |
| :-- | :-- | :-- |
| `Dialog.tsx` | `_Dialog.tsx` | `{ id; title: JSX.Element; open; onClose; children; size?; action?: { label; tone; onClick; disabled? } }` e `PeopleButton` |
| `SortTable.tsx` | `_SortTable.tsx` | igual |
| `Icon.tsx`, `icons.ts` | `_Icon.tsx`, `_icons.ts` | `{ name: IconName; class? }` |
| `GroupedAnswers.tsx` | `_GroupedAnswers.tsx` | `{ rows: AnswerGroup[]; column: "score" \| "accepted" \| "none"; responseHeader; countHeader?; target: GradeTarget; names: Record<string, string> }` |
| `Members.tsx` | `_Members.tsx` | `{ members: GroupMember[]; target: GradeTarget; names: Record<string, string>; detailHeader? }` |
| `Overrides.tsx` | `_Overrides.tsx` | `{ rows: (OverrideRow com when em ISO)[]; target: GradeTarget; names }` |
| `NumericHistogram.tsx` | `numeric.astro` | `{ histogram: NumericHistogram }` |
| `OrderingMatrix.tsx` | `_Tables.tsx` | `{ matrix: OrderingMatrix }` |
| `GradeQuestionForm.tsx` | form de `_Members.tsx` | `{ target: GradeTarget; submission: string \| null; author; question; current: number \| null; onDone }` |

`GradeTarget = { discipline: string; course: string; exam: string }`.
`GradeQuestionForm` chama `actions.grading.grade` quando há `submission`, senão
`actions.grading.gradeUnanswered`; "Marcar como certa" envia 100. Depois de
salvar, recarrega a página. "Desfazer" em `Overrides` chama `grading.revert`
(`kind: "grade"`) ou `examAdjustment.revoke` (`kind: "sanction"`); o lápis só
aparece em `kind: "grade"`. Rótulos dos botões de ícone: `aria-label` e
`title` iguais, das mensagens `grades_objective_*`.

Página `grading/[question].astro`, ramo `auto`: substitui a lista de respostas,
`AnswerDistributionSection` e `SummaryDistribution` pelo modelo
`objectiveReview`. Estrutura e ids estáveis (os testes usam):
`data-testid="summary"`, `section#attention` (só se houver linha), uma
`section` por `ReviewSection`, `section#overrides` (só se N > 0), nota
`role="note"` da A11, FAB `a.fab` com `aria-label` "Editar questão" para a
página de edição da questão. Setas: `aria-label` "Questão anterior" /
"Próxima questão", href por `gradingHref(..., { names, list: wantedList })`.
Nomes sempre visíveis em objetiva (A9). O ramo manual não muda.

### 2.6 T6: telas do professor

Puro, em `src/services/grading.ts`:

```ts
export type RosterStatus = "none" | "in-progress" | "pending" | "adjusted" | "submitted";
export interface RosterRow { username: string; name: string; schoolId: string | null; total: number | null; status: RosterStatus }
/**
 * One row per active student, sorted by name: `none` without an attempt; `in-progress` while open;
 * `pending` with a pending answer; `adjusted` with any active adjustment or manual change; else `submitted`.
 */
export function attemptRoster(
	students: readonly (GradedStudent & { schoolId: string | null })[],
	rows: readonly AttemptRow[],
	adjusted: ReadonlySet<string>,
): RosterRow[];

export type QuestionMark = "correct" | "partial" | "wrong" | "blank" | "changed" | "pending" | "not-graded";
/** The state color of a question on the attempt page: `changed` wins, then blank (no counting submission or null payload), then status and score (≥ 1 correct, > 0 partial, else wrong). */
export function questionMark(outcome: QuestionOutcome, payload: unknown, changed: boolean): QuestionMark;
```

`GradedStudent` ganha `schoolId: string | null` (lido de
`db.enrollment.findMany`, que já o expõe).

Componentes (renomeados de `Sanction*`, em `src/components/grading/`):

- `AttemptActions.tsx`: `{ target: GradeTarget; author: string; base: number | null; questions: { slug; number; title }[]; adjustments: { publicId; op; value: string; reason; notes; updatedAt: string }[]; roster: RosterRow[]; attemptHref: (username) => string /* passado como prefixo string */ }`.
  Três botões de ícone ("Sancionar", "Adicionar bônus", "Lista de alunos") e
  os diálogos. Sancionar envia `op: "FACTOR"`, valor % que fica (`< 100`) ou
  zerar (0). Bônus: controle segmentado OFFSET ("Somar pontos"), FACTOR
  ("Multiplicar"), SET ("Substituir nota"), prévia com `adjustTotal`.
- `QuestionActions.tsx` (por questão): `{ target; author; question: { slug; number }; submission: string | null; score: number | null; autoScore: number | null; changed: boolean; adjustment?: {...} }`.
  Lápis "Alterar nota" (`GradeQuestionForm` em `Dialog`), martelo "Sancionar
  questão" (FACTOR < 1 na questão), e "Desfazer" quando `changed`.
- `AdjustmentDialog.tsx` (de `SanctionDialog`), `AdjustmentActions.tsx` (de
  `SanctionActions`, editar e revogar uma linha), `AdjustmentModal.tsx` some em
  favor de `Dialog.tsx`.
- `ExamResults.tsx`: "Ajustar selecionados" abre `AdjustmentDialog` com as três
  operações e o alvo prova ou questão.
- `GradesTable.astro` e `ExamResults.tsx`: total original riscado e final, link
  para `adjustments`.
- Página `adjustments.astro` (de `sanctions.astro`): ativos e revogados,
  criação em lote por usernames (aceita aluno sem tentativa), editar, revogar.
  `examNav` ganha `adjustments?: number` no lugar de `sanctions?`, item
  `.../adjustments`. `gradingExamNav` idem.
- Página da tentativa: renderiza também para aluno matriculado sem tentativa
  (achado 11); barra `nav[aria-label="Questões"]` com um link `Qn` por questão
  (`aria-label` "Questão n: <estado>"); cada questão em `QuestionFrame` com
  `AnswerView` (resposta e gabarito); seção `aria-label="Ajustes de nota"` com
  total original, uma linha por ajuste (`adjustmentLabel`) e total final.

### 2.7 T7: aluno

- `load-attempt-view.ts` e `load-review.ts` passam `adjustments` e `original`
  de `ExamResult` à ilha; `empty: boolean` (a tentativa tem
  `createdBy !== null`).
- `ExamAttempt.tsx`: depois da liberação, bloco com total original, uma linha
  por ajuste (`adjustmentLabel` + motivo) e total final; com `empty`,
  `exams_attempt_not_taken` ("Você não fez esta prova") no lugar das
  respostas. Selo da questão com `adjustmentLabel` do ajuste dela.
- `exams/[slug].astro` e `load-student-home.ts`: total final e marca de
  ajustado.
- Chaves `grades_sanction_*` usadas pelo aluno viram `grades_adjustment_*`.

## 3. Briefs

### Regras comuns (o coordenador cola no topo de todo brief)

- Leia `CLAUDE.md`, a spec `dev/specs/to-do/correcao-objetivas-e-ajustes-de-nota.md`
  e a seção desta tarefa em `dev/specs/to-do/correcao-objetivas-e-ajustes-de-nota.plano.md`
  (seções 1 e 2). As interfaces da seção 2 são o contrato: não as mude sem
  avisar o coordenador.
- Worktree novo: `pnpm install --frozen-lockfile --offline` e
  `pnpm run db:generate` dentro dele. Nunca symlink de `node_modules`, nunca
  pnpm no checkout principal. O mdq vem por `.claude/worktrees/mdq`.
- `tsx` e a suíte rodam fora do sandbox. Use um `TEST_PORT` só seu (o
  coordenador indica). Nunca a porta 4321. Mate servidores que sobrarem.
- Proibido `git stash`, `git checkout <arquivo>`, commit, push.
- Comandos: `rtk pnpm exec tsx test/run.ts <spec>` (um arquivo);
  `rtk pnpm run test:unit`; `pnpm exec biome check --write .`;
  `pnpm run lint` (relate o exit code); `pnpm run typecheck` se mudou tipo.
- Relatório final: arquivos tocados, contagem de testes (passou/falhou), exit
  code do lint, e o que não foi verificado.
- TESTER: escreve só testes (e histórias em `docs/user-stories/` quando o brief
  pede). Não lê nem cria código de produção além dos stubs já existentes. Os
  testes devem falhar pelo motivo certo (asserção, não erro de import) antes da
  implementação; relate a saída da falha.
- IMPLEMENTER: não edita os testes do tester. Se um teste parecer errado,
  pare e relate ao coordenador com o motivo.

### T2. Composição em `examResult` e bloqueio de revisão

Depende de T1. Paralela a T3, T4, T5a, T5c. Antes: conferir que `ExamAttempt.tsx`
está limpo em `main` (achado 8).

**TESTER T2**

- Objetivo: provar D1 a D9 e D8a pela API da seção 2.1.
- Ler: `src/services/exam-result.ts`, `src/services/regrade.ts`,
  `test/exam-result.spec.ts`, `test/exam-result-code.spec.ts`,
  `test/regrade.spec.ts`, `test/regrade-request-service.spec.ts`.
- Stub (o implementer escreve antes): `adjustmentsByResponse`, `reducesGrade`,
  `adjustTotal`, `fixesTotal`, `adjustmentLabel` com corpo
  `throw new Error("not implemented")`, e os tipos novos.
- Escopo `unit`. Em `test/exam-result.spec.ts`, uma tabela (`for of` com
  `test(name)`) de `examResult` com duas questões de peso 1 (a, b):
  1. sem ajuste, a=1 b=0 → total 0.5, sem `adjustments`.
  2. SET 0.8 sozinho → total 0.8, `original.total` 0.5, `adjustments` [SET].
  3. SET 0.8 + FACTOR 1.1 + OFFSET 0.05 → 0.8×1.1+0.05 = 0.93 (toBeCloseTo).
  4. FACTOR 0.5 + FACTOR 0.5 → 0.125.
  5. OFFSET 0.1 + OFFSET -0.05 → 0.55.
  6. teto: a=1 b=1, OFFSET 0.2 → 1.
  7. base negativa: notas -0.5 e 0 (total -0.25), OFFSET 0.1 → -0.15;
     OFFSET -0.1 → -0.25 (trava em min(base,0)); FACTOR 1.5 → -0.25.
  8. fator 0 terminal: SET 0.9 + FACTOR 0 + OFFSET 0.3 → 0, `pending` 0.
  9. SET com questão pendente (b sem passe) → total = SET, `pending` 0,
     `original.total` null.
  10. FACTOR 0 com pendente → 0, `pending` 0.
  11. OFFSET com pendente → total null, `pending` 1.
  12. FACTOR de questão 0.5 em nota 1 → status `sanctioned`, score 0.5,
      `adjustment.original.score` 1; em nota -0.5 → score -0.5.
  13. ajuste de questão com slug fora da prova → ignorado.
  14. ordem de `adjustments`: entrada [OFFSET, FACTOR, SET] sai [SET, FACTOR, OFFSET].
- `adjustTotal` e `fixesTotal` direto: (null, []) → null; (null, [SET 0.4]) → 0.4;
  (0.5, [FACTOR "0"]) → 0.
- Em `exam-result-code.spec.ts`: questão `code` com FACTOR de questão 0.5 aplica
  sobre a nota descontada; `codeAttempts` inalterado.
- `adjustmentsByResponse`: agrupa as três operações; descarta `notes`.
- `reducesGrade`: FACTOR 0.99 → true; FACTOR 1, SET 0, OFFSET -0.1 → false.
- Bloqueio (`test/regrade.spec.ts`): `regradeBlocker` com `examReduced: true` →
  `"sanctioned"`; com outcome sem `adjustment` e `examReduced: false` → não.
  No service (`regrade-request-service.spec.ts`): aluno com bônus OFFSET na
  prova consegue pedir revisão; com FACTOR 0.5 na prova, recusado; com SET,
  consegue.
- `adjustmentLabel` em pt-BR: os seis textos da seção 2.1 (SET 0.8 → "Nota
  substituída por 80%", FACTOR 1.1 → "Bônus ×1,1", OFFSET 0.1 → "Bônus +10",
  OFFSET -0.1 → "Penalidade −10", FACTOR 0.5 → "Penalidade ×0,5", FACTOR 0 →
  "Zerada"). Teste em `test/adjustment-label.spec.ts`.
- Não testar UI.

**IMPLEMENTER T2**

- Objetivo: seção 2.1 inteira; testes do tester verdes.
- Arquivos: `src/services/exam-result.ts`, `regrade.ts`, `grading.ts`
  (`attemptRows`), `grades-table.ts`, `exam-state.ts` se ler `sanction`,
  `src/utils/adjustment-label.ts` (novo), `messages/{pt-BR,en}/grades.json`
  (chaves `grades_adjustment_*`), `src/db/services/regrade-request.service.ts`,
  `src/utils/load-attempt-view.ts`, e os demais chamadores de
  `sanctionsByResponse`/`examResult` (lista: `rtk proxy grep -rn "sanctionsByResponse\|examResult(\|\.sanction\b" src`).
- Mantenha `sanctionsByResponse` como alias; não toque `exam.service.ts` nem
  `grading-job.service.ts` (o `[]` deles segue compilando).
- Leitores de UI (`GradesTable.astro`, `ExamResults.tsx`,
  `attempts/[username].astro`, `ExamAttempt.tsx`): adaptação mínima para
  compilar, mostrando total original riscado e final. Nada de texto novo.
- Aceite: testes do T2, `pnpm run test:unit`, `pnpm run lint` exit 0; e2e de
  `test/grading-results.spec.ts`, `test/grades-table.spec.ts`,
  `test/stories/student-exams.test.ts` verdes.

### T3. REST de ajustes

Depende de T1. Paralela a T2, T4, T5a, T5c.

**TESTER T3**

- Objetivo: rotas H1 e corpo H2.
- Ler: `test/api-exam-adjustment.spec.ts` (já renomeado no T1, ainda nas
  rotas `/sanction`), `src/api/README.md`, `src/api/index.ts`.
- Escopo `e2e` (HTTP). Trocar as URLs para `/adjustment` e cobrir:
  1. instrutor POST `{ usernames, op: "OFFSET", value: "0.1" }` → 201, corpo com
     `op` e `value`.
  2. POST com `op: "SET", value: "1.5"` → 400 com erro em `value`.
  3. POST com `question` e `op: "OFFSET"` → 400 em `op`.
  4. segundo SET ativo para o mesmo aluno → 400/409 (o que o T1 devolve hoje).
  5. aluno lê antes da liberação → vazio; depois → o seu, sem `notes`.
  6. chave de bot → recusada (403).
  7. PATCH muda `value`; POST `/revoke` revoga.
  8. a rota antiga `/sanction` → 404.
- `test/openapi-snapshot.spec.ts` e `cli/tests/test_generated_in_sync.py`
  continuam como estão (o implementer regera).

**IMPLEMENTER T3**

- Arquivos: `src/api/index.ts`, `src/api/registry/route-patterns.json`,
  `test/bruno/exam-adjustment/*`, `cli/resources/openapi/codehood.json`,
  `cli/codehood/api/generated.py` (via `pnpm run openapi:cli`).
- O corpo de criação e de atualização não tem campo só de servidor.
- Aceite: os três specs passam; `cd cli && rtk uv run pytest` verde; lint 0.
- Se T4 mergear antes, rode `pnpm run openapi:cli` de novo depois do merge.

### T4. Tentativa vazia, nota sem resposta, `createdBy`, estatísticas

Depende de T1. Paralela a T2, T3, T5a, T5c. Antes: `response.service.ts` e
`submission.service.ts` limpos em `main`.

**TESTER T4**

- Objetivo: B3, B4, B4a, B5, E1 a E3, C8 e as estatísticas, pela seção 2.3.
- Ler: `test/exam-adjustment-service.spec.ts` (fixtures e setup),
  `test/question-stats.spec.ts`, `test/grading.spec.ts` (se existir),
  `src/fixtures/`, `src/db/services/grading-job-queue.ts` (só para achar como
  montar questão `code` com `worker` nos testes existentes).
- Stubs (implementer antes): `attemptOrEmpty`, `db.manualGrade.gradeUnanswered`,
  `autoScoreOf`, `isManualChange`, `measuredAttempts`, `REVERT_REF_PREFIX`, as
  Actions `grading.gradeUnanswered` e `grading.revert`, e os campos `createdBy`.
- Escopo `unit`. Novo `test/manual-grade-service.spec.ts`:
  1. prova encerrada, aluno com tentativa fechada sem resposta à questão q →
     cria submissão `AUTOSAVE`, payload `null` lido de volta como `null`,
     `status GRADED_MANUALLY`, `createdBy` = instrutor, e um passe com o score.
  2. aluno sem tentativa → cria `Response` com `createdBy`, fechada,
     `slotKey 0`, `preview false`, mais a submissão.
  3. recusas, cada uma sem deixar `Response` nem `Submission` nova (conte as
     linhas antes e depois): prova aberta; por abrir; aberta só para ele por
     `ExamException`; `PRACTICE`; aluno não matriculado; ator aluno ou outro
     instrutor (`NotAllowed`); questão já respondida (`InvalidData` em
     `question`); tentativa ainda em andamento.
  4. transação: com `score` inválido (`"2"`) nada fica gravado.
- Em `test/exam-adjustment-service.spec.ts`: `create` para aluno sem tentativa
  cria a tentativa vazia; lote com um aluno não matriculado não cria nada;
  aluno com tentativa reutiliza (E3); `response.delete` de tentativa vazia com
  ajuste ativo → 409, depois de revogar → apaga.
- B4a: questão `code` com `worker`; nota sem resposta; reabrir; fechar; a
  submissão do professor segue `AUTOSAVE` e não há `FINAL`.
- `gradeObjectives` não grava passe na submissão do professor.
- Estatísticas (`test/question-stats.spec.ts`): `questionStats` com uma
  tentativa normal e uma com `createdBy` → `answered`, `blank`, `correct` e a
  população da discriminação ignoram a do professor; tentativa do aluno sem
  submissões segue em `blank`; submissão com `createdBy` numa tentativa do
  aluno sai de `answered`; passe humano sobre resposta real conta em
  `correct`. `answerDistribution` ignora resposta com `createdBy`.
- Puras: `autoScoreOf` (passes auto e humano misturados → o auto mais novo;
  nenhum auto → null); `isManualChange` (só auto → false; auto + humano → true;
  só um humano → false; um humano com `createdBy` → true; auto + humano +
  `revert-` → false).
- Action `grading.revert` (unit, chamando o handler como os testes de Actions
  existentes fazem, ou via service + `recordPass` se não houver padrão): grava
  passe `revert-*` com o score do auto.

**IMPLEMENTER T4**

- Arquivos: `prisma/schema.prisma`, `src/core/schemas/{submission,response,manual-grade,answer}.ts`,
  `src/db/empty-attempt.ts`, `src/db/services/manual-grade.service.ts`,
  `src/db/index.ts`, `exam-adjustment.service.ts` (`attemptsOf`),
  `grading-job-queue.ts`, `objective-grading.ts`, `fromDb` de
  `submission.service.ts` e `response.service.ts` (só isso neles),
  `src/services/{grading,question-stats}.ts`, `src/actions/grading.ts`,
  `messages/{pt-BR,en}/errors.json`.
- `pnpm run db:reset` depois do schema. Se `Prisma.JsonNull` for recusado na
  coluna obrigatória, troque para `Json?`, registre na spec (B3) e avise.
- `pnpm run openapi:cli` (os modelos de leitura ganham `createdBy`); confira
  que nenhum corpo de criação/atualização o tem.
- Aceite: testes do T4; `test:unit`; `test/openapi-snapshot.spec.ts`;
  `cd cli && rtk uv run pytest`; lint 0.

### T5a. Modelo puro da página objetiva

Aviso do T4: `CountingAnswer.passes` vem do mais novo ao mais antigo, mas `isManualChange` e `autoScoreOf` (`src/services/grading.ts`) esperam do mais antigo ao mais novo (o empate de `updatedAt` decide pelo índice). Inverta uma cópia antes de chamá-las e teste um empate no mesmo ms.

Depende de T4 (tipos `createdBy`, `isManualChange`, `autoScoreOf`); pode
começar com os stubs do T4 mergeados. Paralela a T2, T3, T5c.

**TESTER T5a**

- Objetivo: a seção 2.4.
- Ler: `src/services/response-summary.ts`, `src/services/review.ts`,
  `src/services/grading.ts`, os mockups `src/pages/design/playground/correcao-objetivas/_data.ts`
  e as páginas por tipo (só como exemplo de dados).
- Stub (implementer antes): `src/services/objective-review.ts` com os tipos e
  as funções lançando "not implemented".
- Escopo `unit`, `test/objective-review.spec.ts`. Monte `QuestionDocument`s
  à mão (veja `test/response-summary.spec.ts` ou `test/question-stats.spec.ts`
  para documentos de cada tipo) e `ReviewAnswer`s sintéticas. Casos:
  1. MC 4 alternativas, 10 respostas: uma linha por alternativa em ordem,
     `key` certo, `count` e `share` certos; "Em branco" só quando há.
  2. `mean`: grupo com 2 membros → null; com 3 → média dos `restMean`.
  3. `score`: membros com verdicts iguais → o valor; um alterado à mão →
     `"varies"` e `changed` 1; ninguém corrigido → null.
  4. `needsReview`: distrator com média 0.8 e quem acertou com 0.6 → `review`
     true; distrator com 0.5 → false; a linha certa nunca.
  5. MS: seção `alternatives` (membros = quem marcou) e `combinations` com no
     máximo 5 linhas + "outras".
  6. V/F: `count` = quem errou ou se absteve; `marked` conta V e F; referência
     = média de quem acertou a afirmação.
  7. Resposta curta: "Paris", " paris ", "París" num grupo com `sub` 3 grafias;
     texto da linha = a grafia mais comum.
  8. Lacunas: uma seção por lacuna e uma `missed` ordenada por nº de erros.
  9. Numérica: answer 2.02, tolerance absolute 0.02 → band [2.0, 2.04],
     window [1.92, 2.12]; 4.08 vai para `outside`; mais de 4 valores fora → o
     resto em `value: null`.
  10. Ordenação: `cells[i][i]` conta quem acertou a posição; ordens agrupadas.
  11. Resposta com `createdBy` fora de toda seção e do `summary.answers`, mas
      presente em `overrides` com `auto: null`.
  12. `attention`: pendentes primeiro, depois regrades; vazia quando não há.
  13. `overrides`: alteração à mão (auto riscado e final) e sanção de questão
      (`kind: "sanction"`, `final` = auto × value), ordem por `when` desc.
  14. `restMeans`: pesos respeitados, questão pendente fora, sem outra questão → null.

**IMPLEMENTER T5a**

- Arquivo: `src/services/objective-review.ts` (pode reutilizar
  `responseSummary`, `reviewResult`, `examResult`, `isManualChange`,
  `autoScoreOf`). Sem I/O, sem `m` além do que `responseSummary` já usa.
- Aceite: `test/objective-review.spec.ts`, `test:unit`, lint 0.

### T5b. Página de correção objetiva (Parte A)

Depende de T5a e T4. Antes: confirmar com o coordenador que os componentes
movidos não colidem com T6 (T6 vem depois).

**TESTER T5b**

- Objetivo: A1 a A9, A11 na página real.
- Ler: `test/stories/README.md`, `test/stories/instructor-grading.test.ts`,
  `test/stories/regrade-setup.ts`, `test/fixtures.ts`,
  `docs/user-stories/instructor.md` (seção de correção).
- Escreva a história "Review an automatically graded question" em
  `docs/user-stories/instructor.md` (texto curto, A3 a A8) e o teste
  `instructor: review an automatically graded question` (e2e). Arrange com
  services: curso, prova encerrada com uma MC e uma de ordenação, 4 alunos, um
  sem passe (pendente), um com pedido de revisão aberto, um com nota alterada.
  Act na UI:
  1. resumo mostra "4 respostas", "% corretas" e "1 sem nota".
  2. "Requer atenção" tem a linha "Sem nota" e a "Revisão pedida" (link para
     `regrades`); "Dar nota" com 100 → a linha some depois do reload.
  3. tabela agrupada: uma linha por alternativa; o botão de pessoas abre o
     diálogo; o lápis de um aluno → "Marcar como certa" → salvo (confira via
     `db.feedback.findMany`).
  4. "Alteradas à mão (1)": "Desfazer" → a seção some e há passe `revert-*`.
  5. com `?names=1` ou sem, os nomes aparecem (A9).
  6. `?view=list` numa objetiva: a seta "Próxima questão" mantém `view=list`.
  7. prova sem pendência nem regrade: não existe `#attention`.
  8. FAB "Editar questão" existe; nota `role="note"` da A11 existe.
- Spec e2e separado `test/grading-objective-page.spec.ts` para os casos 5 a 7
  se ficarem longos na história.

**IMPLEMENTER T5b**

- Arquivos: tabela da seção 2.5; `grading/[question].astro` (ramo `auto`);
  `messages/{pt-BR,en}/grades.json` (`grades_objective_*`).
- Traga os componentes do playground; remova os arquivos `_*` e as páginas de
  tipo do playground que ficarem sem uso, deixando `correcao-objetivas/` só com
  o que T6 ainda precisa (`_Attempt.astro`, `_AttemptActions.tsx`,
  `aluno-*.astro`, `_data.ts`, `_Shell.astro`, `_guard.ts`); o `index.astro`
  do playground lista o que sobra.
- Aceite: os testes do T5b; screenshots de cada tipo com dados do seed (T8
  completa o seed; use o que existir e relate o que faltou); lint 0.

### T5c. Descartada (A12 não é bug; A10 vai para a T5b)

Depende de T1. Paralela a tudo.

**TESTER T5c**

- Teste e2e `test/grading-answer-key-locale.spec.ts`: página de correção de
  uma questão de ordenação e de uma de lacunas, em pt-BR; o `<details>`
  "Enunciado e gabarito" aberto não contém "Correct order", "Correct orders",
  "Blank" nem " of ".

**IMPLEMENTER T5c**

- Achar o ramo de `QuestionPreview` (modo `key`) que não recebe `mdqMessages`.
  Se a causa for no mdq (`../mdq/mdq-js/src/solid/`), corrigir lá, commitar no
  mdq (o coordenador autoriza) e `pnpm run mdq:bump`.
- Atualizar `dev/issues/repinar-versao-nao-recorrige-objetivas.md` (A10 e
  achado 4: passe `revert-` conta como não humano).
- Aceite: o teste passa; `pnpm run check:siblings` limpo; lint 0.

### T6. Telas do professor (G1 a G5)

Débito herdado da revisão do T2: `GradesTable.astro` mostra só o primeiro `FACTOR < 1`; com `SET`/`OFFSET` o total muda sem sinal, e dois fatores 0,5 aparecem como 50%. Mostrar `original.total` riscado e o total final, com a lista de ajustes; total com bônus não fica em `text-error` (`ExamResults.tsx`).

Depende de T2, T4 e T5b. Paralela a T7.

**TESTER T6**

- Ler: `test/stories/instructor-grading.test.ts` (história de sanção do T1),
  `test/stories/sanction-support.ts`, `docs/user-stories/instructor.md`
  ("Sanction a student's grade"), `test/exam-nav.spec.ts`, mockups
  `_Attempt.astro` e `_AttemptActions.tsx`.
- Renomeie a história para "Adjust a student's grade" (texto: G1 a G5) e o
  teste junto. Puros (`unit`, `test/attempt-roster.spec.ts`): `attemptRoster`
  (cinco situações, ordem por nome, `schoolId` null), `questionMark` (sete
  estados); `test/exam-nav.spec.ts`: item `adjustments` com contador.
- História e2e, um `test.step` por item:
  1. página da tentativa: "Adicionar bônus" → "Somar pontos" 10 → total final
     = original + 10 pontos; a seção "Ajustes de nota" lista "Bônus +10".
  2. "Multiplicar" 110 e "Substituir nota" 80: linhas e totais certos;
     segundo "Substituir nota" → erro "edite o existente".
  3. "Sancionar" zerar → total 0.
  4. lápis numa questão em branco → nota 100 → a barra mostra `Qn` como
     "alterada à mão"; "Desfazer" → volta.
  5. martelo numa questão, 50% → selo "Penalidade ×0,5" e total menor.
  6. "Lista de alunos": busca por matrícula acha o aluno; aluno sem tentativa
     aparece como "sem tentativa" e o link abre a página dele (sem 404).
  7. `adjustments.astro`: criar em lote para um aluno sem tentativa; editar;
     revogar → listado como revogado.
  8. resultados: "Ajustar selecionados"; total original riscado e final com
     link para `adjustments`.

**IMPLEMENTER T6**

- Arquivos: seção 2.6; `src/utils/exam-nav.ts`, `src/utils/load-grading.ts`,
  `attempts/[username].astro`, `adjustments.astro` (git mv de
  `sanctions.astro`), `results.astro`, `ExamResults.tsx`, `GradesTable.astro`,
  `messages/{pt-BR,en}/{grades,exams}.json` (renomear `grades_sanction_*` do
  professor para `grades_adjustment_*`).
- Ao fim, apague o playground `correcao-objetivas/` (fica só
  `src/pages/design/playground/index.astro`).
- Aceite: os testes; e2e de `test/grading-results.spec.ts`,
  `test/grades-table.spec.ts`, `test/exam-nav.spec.ts`; lint 0.

### T7. Aluno (F1 a F4)

Débito herdado da revisão do T2: `ExamAttempt.tsx` mostra só o primeiro `FACTOR < 1` (mesmo problema do T6). Teste do loader ou e2e: com `OFFSET +0.1`, o pedido de revisão continua disponível (`examReduced` em `load-attempt-view.ts:128`).

Depende de T2 e T4. Paralela a T6. Antes: `ExamAttempt.tsx` limpo em `main`.

**TESTER T7**

- Ler: `test/stories/student-exams.test.ts` (história de sanção),
  `docs/user-stories/student.md` ("See that my grade was sanctioned").
- Renomeie a história para "See the adjustments to my grade" e o teste junto.
  Steps (arrange com services, act na UI do aluno):
  1. antes da liberação: nenhuma linha de ajuste nem total final.
  2. depois: total original, "Bônus +10" com o motivo, "Penalidade ×0,5",
     "Nota substituída por 80%", total final.
  3. aluno sem tentativa com SET: "Você não fez esta prova" e o total.
  4. questão com FACTOR 0: selo "Zerada"; com 0.5: "Penalidade ×0,5".
  5. D8a: com bônus o botão de pedir revisão existe; com FACTOR 0.5 na prova
     não existe (ou mostra o motivo do bloqueio).
  6. `notes` do professor nunca aparece.

**IMPLEMENTER T7**

- Arquivos: seção 2.7; `exams/[slug].astro`, `ExamAttempt.tsx`,
  `load-attempt-view.ts`, `load-review.ts`, `load-student-home.ts`,
  `messages/{pt-BR,en}/exams.json`.
- Aceite: a história; e2e de `test/stories/student-exams.test.ts` inteiro;
  lint 0.

### T8. Seed, glossário, changelog, fechamento

Depende de todas. Antes: `src/db/bootstrap.ts` limpo em `main`. Sem tester:
o aceite é o dev server e a suíte.

**IMPLEMENTER T8**

- `src/db/bootstrap.ts` (H3), só nas provas existentes: um ajuste de cada
  operação (SET, FACTOR > 1, FACTOR < 1, OFFSET > 0, OFFSET < 0); uma tentativa
  vazia com SET; uma nota sem resposta (`gradeUnanswered`); numa prova
  encerrada com objetivas (ex.: `test-01`), uma resposta sem nota, um pedido de
  revisão aberto e uma alteração à mão em questões MC, MS, V/F, curta,
  lacunas, numérica e ordenação. Se faltar algum tipo em `test-01`, use outra
  prova da lista e diga qual.
- Remover o alias `sanctionsByResponse` (e trocar em `exam.service.ts`).
- `GLOSSARY.md` (Ajuste de nota, Tentativa vazia, Sanção redefinida),
  `CHANGELOG.md`, revisão de `docs/user-stories/*`, mover a spec e este plano
  para `dev/specs/to-review/`. Issue para contadores que contam tentativa vazia
  (achado 12), se houver.
- Aceite: `pnpm run db:reset`; cada estado visível no dev server (URLs no
  relatório); `pnpm exec biome check --write .`; `pnpm run lint` 0;
  `rtk pnpm test` verde; `grep -rn "ExamSanction\|sanctionsByResponse" src`
  vazio.

### Dependências e paralelismo

```
T1 ──┬── T2 ───────────────┬── T6 ──┐
     ├── T3                │        ├── T8
     ├── T4 ── T5a ── T5b ─┘        │
     │    └────────────────── T7 ───┘  (T7 também depende de T2)
     └── T5c
```

- Onda 1 (worktrees separados): T2, T3, T4, T5c.
- Onda 2: T5a (depois de T4).
- Onda 3: T5b.
- Onda 4: T6 e T7 em paralelo.
- Onda 5: T8.
- Pontos de merge: `messages/*.json` (cada tarefa usa o seu prefixo de chave;
  conflito é só de vizinhança), gerados da OpenAPI (T3 e T4: quem mergear por
  último roda `pnpm run openapi:cli`, nunca resolve à mão).

## 4. Checklist de revisão (depois de cada tarefa)

- [ ] O commit dos testes do tester vem antes do da implementação, e a saída
  da falha inicial foi relatada (falha por asserção, não por import).
- [ ] Cada caso enumerado no brief tem um teste; nenhum foi removido, pulado
  (`skip`, `fixme`) ou trocado por asserção mais fraca (`toBeTruthy` onde havia
  valor, `toBeCloseTo` com precisão frouxa, contagem `>=` onde havia `=`).
- [ ] O implementer não editou arquivos de teste do tester (`git log -p` por
  autor/ordem dos commits, ou diff dos specs entre os dois commits).
- [ ] As asserções leem a spec: números da tabela de D, textos exatos da F1,
  recusas com o campo certo (`usernames`, `author`, `question`, `op`, `value`).
- [ ] Recusas provam ausência de linha (contagem antes e depois), não só o erro.
- [ ] Interfaces batem com a seção 2 deste plano (nomes, tipos, campos
  opcionais). Divergência só com aviso ao coordenador.
- [ ] Nada fora do raio da tarefa; em especial `exam.service.ts`,
  `grading-job.service.ts`, `bootstrap.ts` e `ExamAttempt.tsx` só nas tarefas
  que os listam.
- [ ] `pnpm run lint` exit 0 (Biome, typecheck com astro-check, stories).
- [ ] `rtk pnpm run test:unit` verde; os e2e tocados verdes, por arquivo.
- [ ] Mudou REST ou modelo de leitura: `pnpm run openapi:cli` rodado,
  `test/openapi-snapshot.spec.ts` e `cd cli && rtk uv run pytest` verdes, e
  nenhum campo só de servidor nos corpos de criação/atualização.
- [ ] Mudou schema: `pnpm run db:reset` rodado; sem migração escrita à mão.
- [ ] Comentários seguem o `CLAUDE.md` (sem referência a requisito, `/** */`
  em público, `///` em privado) e o código de produção está em inglês.
- [ ] Working tree do worktree limpo exceto pelo escopo; nenhum `git stash`.
