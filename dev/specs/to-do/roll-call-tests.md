---
type: spec
status: to-do
tags: [attendance, roll-call, testing]
relatedTo: [roll-call]
---

# Chamada: casos de teste

Casos derivados de [roll-call.md](roll-call.md) pelo projetista de testes.
Runner: `@playwright/test` (`import { expect, test }`), um `test()` por caso,
sem `describe`, como em `test/csv.spec.ts` e
`test/grade-column-service.spec.ts`. Specs de service têm helpers locais
(`tag()` com prefixo do arquivo, `makeUser`, `ensureEdition`, `makeCourse`,
`makeSlot`) e não usam `src/fixtures/`.

Decisões tomadas aqui:

- O 409 de R13 é `NotAllowed` com `status: 409`, como em
  `src/db/services/question.service.ts`. Não existe erro `Conflict`.
- A entrada do próprio aluno sai com `sharedWith: []`; só o professor vê os
  nomes (privacidade).
- Um código é aceito enquanto `t < fim da janela + 30 s`; exatamente aos 30 s
  é recusado.
- As janelas de 15 s são alinhadas à época Unix (`floor(t / 15000)`), não à
  abertura da chamada.

## T2: `src/services/roll-call-code.ts` → `test/roll-call-code.spec.ts`

```ts
/// Characters a code may use: no 0/O, 1/I/L.
export const CODE_ALPHABET: string;
/** Returns a new random secret for a roll call. */
export function generateSecret(): string;
/** Returns the code shown at `at` and the instant it is replaced. */
export function codeAt(secret: string, at: Date): { code: string; nextChangeAt: Date };
/** Whether `code` (any case, surrounding spaces ignored) is accepted at `at`. */
export function isCodeValid(secret: string, code: string, at: Date): boolean;
```

Segredo fixo `S = "test-secret"`; `T0 = new Date(1_800_000_000_000)`
(múltiplo de 15000, borda de janela).

**R4 alfabeto e formato**
- **T2-01.** `codeAt(S, T0 + k*15s)`, k = 0..499: todo código casa
  `^[A-Z2-9]{6}$`, sem `0 O 1 I L`, só com caracteres de `CODE_ALPHABET`; o
  próprio alfabeto não tem esses 5.
- **T2-02.** `isCodeValid` com 5 ou 7 caracteres, ou contendo `0` ou `I`:
  `false`, sem exceção.
- **T2-03.** `isCodeValid(S, " " + c.toLowerCase() + " ", T0)` é `true` para
  `c = codeAt(S,T0).code`.

**R3 rotação**
- **T2-04.** `codeAt(S,T0)` = `codeAt(S,T0+14_999ms)` ≠ `codeAt(S,T0+15_000ms)`.
- **T2-05.** `codeAt(S,T0+7s).nextChangeAt` = `T0+15s`.
- **T2-06.** `codeAt("a",t)` e `codeAt("b",t)` diferem em ao menos uma de 10
  janelas consecutivas.
- **T2-07.** Duas chamadas de `generateSecret()` diferem.

**R3 tolerância de 30 s** (o código de `[T0, T0+15s)` sai da tela em `T0+15s`)
- **T2-08.** Aceito em `T0` e em `T0+15s+29_999ms`.
- **T2-09.** Recusado em `T0+45s` (30 s exatos) e em `T0+46s`.
- **T2-10.** O código da janela seguinte é recusado em `T0+14_999ms`: código
  futuro nunca vale.
- **T2-11.** `isCodeValid("other", codeAt(S,T0).code, T0)` é `false`.

## T3: `RollCallService` → `test/roll-call-service.spec.ts` (prefixo `rc-`)

Helpers extras: `makeEvent(course, week, kind)`, `enroll(course, user,
status)`, `setEnrolledAt(enrollment, date)` e `seedAttendance(rc, user, {
source, deviceHash })`, os dois últimos via `prisma` direto. `now` é
delimitado por `Date.now()` antes e depois da chamada.

**R1 eventos elegíveis**
- **T3-01.** Evento REGULAR, professor, `create`: `attendances` `{}`,
  `actsAsInvite` `false`, `closesAt` entre `before+15min` e `after+15min`.
- **T3-02.** Evento HOLIDAY, depois CANCELLED, `create`: `InvalidData`,
  nenhuma linha `RollCall`.
- **T3-03.** Evento já com chamada, segundo `create`: erro, continua 1 linha.

**R2 abrir e fechar**
- **T3-04.** Chamada aberta com uma presença; `close` deixa
  `closesAt <= after`; `open` mantém o `id`, `closesAt ≈ now+15min` e a
  presença.
- **T3-05.** `closesAt = now+5min` via prisma; `open` dá `≈ now+15min`, não
  +20min.

**R3/R21 `currentCode`**
- **T3-06.** Professor, `currentCode(pk)`: `code` ∈ `{codeAt(secret,
  before).code, codeAt(secret, after).code}`, com `secret` lido via prisma.

**R15 merge** (A com presença CODE, B matriculado e ausente, C com MANUAL
nota "x")
- **T3-07.** `update({attendances: {B: {}}})`: B vira MANUAL com `note:
  null`; A e C intactos, inclusive `createdAt`.
- **T3-08.** `{A: null}`: linha de A apagada (R12); B e C intactos.
- **T3-09.** `{A: {note: "atrasou"}}`: A continua CODE, mesmo `createdAt` e
  mesmo `deviceHash` (via prisma).
- **T3-10.** `{C: {}}` mantém "x"; `{C: {note: null}}` limpa.
- **T3-11.** `update({actsAsInvite: true})`: presenças intactas.
- **T3-12.** `{B: {}, outsider: {}}`: `InvalidData` e B não é criado (escrita
  atômica).

**R18 presença manual**
- **T3-13.** `{X: {}}` para usuário sem matrícula, inclusive o próprio
  professor: `InvalidData`.
- **T3-14.** `{D: {}}` para aluno DROPPED: presença MANUAL criada.

**R9 `sharedWith`**
- **T3-15.** A e B com `deviceHash` "h1", E com "h2", duas MANUAL com hash
  null; professor `findOne`: A → `[B]`, B → `[A]`, E → `[]`, MANUAL → `[]`.
  Hash null nunca agrupa.

**R24 permissões**
- **T3-16.** Aluno matriculado: `create`, `open`, `close`, `currentCode`,
  `update`, `delete` dão `NotAllowed`.
- **T3-17.** Aluno A, com presenças de A e B: `findOne` e `findMany` trazem
  só a chave A, com `sharedWith: []`. Aluno sem presença recebe `{}`.
- **T3-18.** Professor de outro curso: `findOne` e `open` recusados com o
  mesmo erro que `calendarEvent` dá nesse caso.
- **T3-19.** Admin que não é o professor: `create` e `update` funcionam.

**R13 bloqueio de exclusão**
- **T3-20.** Evento com chamada: `db.calendarEvent.delete` dá `NotAllowed`
  com `status 409`; evento continua.
- **T3-21.** `rollCall.delete` e depois `calendarEvent.delete`: os dois
  funcionam; presenças somem em cascata.
- **T3-22.** Curso com evento, chamada e presenças: `db.course.delete`
  funciona e não sobra chamada nem presença.

**R19/R20 `courseAttendance`** (semanas 1, 2, 3 com chamada, criadas na
ordem 3, 1, 2; semana 4 sem. A matriculado antes da 1, presente na 1 e na 3.
B matriculado entre a 1 e a 2, presente na 2. D DROPPED, presente na 1. F
matriculado depois do `startAt` da 3 e presente na 3)
- **T3-23.** Professor: `events` = semanas 1, 2, 3 em ordem de data, sem a 4.
- **T3-24.** A = `present/absent/present`, `present: 2`, `total: 3`. B =
  `before-enrollment/present/absent`, `present: 1`, `total: 3`. D aparece
  com status DROPPED.
- **T3-25.** Célula de F na semana 3 é `present`: presença vence a data de
  matrícula.
- **T3-26.** Aluno A: `students` só com A; `events` completos.

**Cortados**: R14 (não observável), R16 (garantido pelo whitelist de
saída), R17 (removido pelo Zod), busca por chave natural (mesmo resolver de
`calendarEvent`), curso sem chamadas (trivial).

## T4: check-in

Assinatura (adotada):

```ts
/** Marks the actor present with a code typed or scanned now. */
checkIn(input: { code: string; rollCallId?: RollCallId; deviceId: string },
        opts: ServiceOpts): Promise<CheckInResult>;
/** Completes a check-in whose code was verified at `claimedAt`, after login or signup. */
checkInClaim(input: { rollCallId: RollCallId; claimedAt: Date; deviceId: string;
                      accountCreated: boolean }, opts: ServiceOpts): Promise<CheckInResult>;
type CheckInResult = { rollCall: RollCallPK; title: string; startAt: Date; joined: AttendanceJoin | null };
class CheckInError extends Error {
  code: "invalid-code" | "expired" | "closed" | "not-enrolled" | "dropped" | "not-student" | "claim-expired"
}
// src/utils/pending-check-in.ts
signClaim(claim: { rollCallId; claimedAt: Date }, key: string): string;
readClaim(cookie: string, key: string, now: Date): Claim | null;
// src/utils/rate-limit.ts
createLimiter({ max, windowMs }): { blocked(key, now): boolean; fail(key, now): void };
```

- `deviceId` é o valor cru do cookie; o hash é feito no service.
- O cookie pendente vale 10 min a partir do scan, mesmo que a chamada tenha
  fechado nesse meio-tempo.
- Limite: 10 erros por 10 min por chave (`user:<u>` e `ip:<ip>`). Chave
  bloqueada recusa até o código certo.

`test/roll-call-check-in.spec.ts` (prefixo `rci-`). Cenário: chamada aberta,
segredo lido via prisma, `code = codeAt(secret, new Date())`.

- **T4-01.** R3. Matriculado, `checkIn({code, rollCallId})`: linha CODE,
  `joined: null`; resultado com `title` e `startAt` do evento.
- **T4-02.** R3. Código de `now-60s`: `expired`, nenhuma linha.
- **T4-03.** R2. `closesAt = now-5s` e código atual: `closed` (fechada vence
  a tolerância).
- **T4-04.** R4. Código digitado sem `rollCallId`, duas chamadas abertas de
  cursos diferentes: presença na certa. Com a chamada fechada:
  `invalid-code`.
- **T4-05.** R4. Duas chamadas abertas com o mesmo `secret`, aluno só em B:
  presença em B, não `not-enrolled` vindo de A.
- **T4-06.** R8. DROPPED, mesmo com `actsAsInvite`: `dropped`; matrícula
  continua DROPPED.
- **T4-07.** R24. Sem matrícula, `actsAsInvite` desligado: `not-enrolled`,
  sem linha nem matrícula.
- **T4-08.** R24. Professor do curso e admin: `not-student`.
- **T4-09.** R7. `actsAsInvite`, usuário existente sem matrícula: matrícula
  ACTIVE, `joined: ENROLLMENT`.
- **T4-10.** R7. Já matriculado com `actsAsInvite`: `joined: null`.
- **T4-11.** R7. `checkInClaim` com `accountCreated: true`: matriculado,
  `joined: ACCOUNT`. Com `actsAsInvite` desligado: `not-enrolled`.
- **T4-12.** Segundo `checkIn` do mesmo aluno, outro `deviceId`: sem erro, 1
  linha, `createdAt` e `deviceHash` do primeiro.
- **T4-13.** Aluno com MANUAL e nota faz `checkIn`: continua MANUAL com a
  nota.
- **T4-14.** Aluno com `joined: ENROLLMENT` repete: `joined` mantido.
- **T4-15.** R9. A e B com o mesmo `deviceId`: `deviceHash` ≠ `deviceId` e
  igual nos dois; professor vê um no `sharedWith` do outro.

`test/pending-check-in.spec.ts` (puro):

- **T4-16.** R6. `readClaim(signClaim(c), key, at + 9:59)` = `c`; `at +
  10:00` = `null`.
- **T4-17.** R6. Byte alterado ou outra chave: `null`.
- **T4-18.** R6. `checkInClaim` com `claimedAt = now-9min`, código expirado
  e chamada fechada: presença criada. `now-11min`: `claim-expired`.

`test/rate-limit.spec.ts` (puro):

- **T4-19.** R5. 10 `fail` deixam livre; o 11º bloqueia; libera em
  `primeiro fail + windowMs`.
- **T4-20.** R5. Bloquear `user:a` não bloqueia `ip:x` nem `user:b`.

Ficam para as histórias de T12: redirecionamento ao login ou cadastro e
volta, cookies no navegador, mensagens de erro, `/c/...` e `/check-in`,
texto de confirmação, limite ligado na Action, atalho na página do curso.

## T5: REST → `test/api-roll-call.spec.ts`

Arranjo pelos services, ação por `request` com `tokenFor`, estilo de
`test/api-grade-column.spec.ts`.

- **T5-01.** R22. GET da coleção (professor): itens com `week`, `timeSlot` e
  `attendances` por username (contrato da CLI, R30).
- **T5-02.** R15. PATCH `{attendances: {B: {}, A: null}}` com C presente: B
  MANUAL, A apagado, C intacto.
- **T5-03.** R18. PATCH com username sem matrícula: 400 `invalid-data`, nada
  gravado.
- **T5-04.** R13. DELETE `calendar-event/5/mon` com chamada: 409, evento
  continua. DELETE `roll-call/5/mon` e depois do evento: 2xx.
- **T5-05.** R24. Aluno: GETs trazem só a própria chave ou linha; PATCH e
  DELETE dão 403.
- **T5-06.** R24. Usuário sem relação: `/attendance` 403; curso inexistente
  404.
- **T5-07.** R23. `openapi.json` só tem GET, PATCH e DELETE sob `roll-call`,
  nada de open, close, code ou check-in; POST na coleção dá 404 ou 405.

A REST não expõe `id` nem `courseId`; `test/api-no-raw-ids.spec.ts` já
cobre.

## T7: CSV → `test/attendance-csv.spec.ts` (puro)

Funções puras no molde de `gradesCsvRows` (`src/services/grades-table.ts`):
`attendanceCsvRows(report)` e `attendancePercent(present, total)`, usadas
pela página, pelo CSV e pela coluna de `/grades`.

- **T7-01.** R28. Cabeçalho `username, name, schoolId, status`, uma coluna
  `${week}/${timeSlot}` por evento na ordem de `report.events`, depois
  `present, total, %`.
- **T7-02.** R20, R28. `present`/`absent`/`before-enrollment` saem `1`/`0`/`-`;
  DROPPED sai `dropped`.
- **T7-03.** R20. 1 de 3 com um `-` dá 33.33; `total: 0` dá célula vazia, sem
  `NaN`.

## T10: CLI (pytest)

`ServerEvent` ganha `attendances: int | None`, preenchido pelo preflight a
partir de `GET .../roll-call`.

`cli/tests/test_push_plan.py`:

- **T10-01.** R31. Servidor com `(5, mon)` e 32 presenças, local sem a aula:
  nenhum `DeleteCalendarEvent`, e `WarnEventHasRollCall(5, "mon", 32)`.
- **T10-02.** R31. Mesmo com 0 presenças: avisa.
- **T10-03.** R31. Local sem o slot `mon`: nenhum `DeleteTimeSlot("mon")`.
- **T10-04.** R32. `drop_roll_calls=True`: `DeleteRollCall` antes de
  `DeleteCalendarEvent`, ambos antes de `DeleteTimeSlot`; sem aviso.
- **T10-05.** R31. Aula com chamada ainda local, conteúdo mudado:
  `UpsertCalendarEvent`, sem aviso.

`cli/tests/test_cli_push.py` (FakeServer):

- **T10-06.** R30, R31. Sem flag: saída com "5/mon", "32" e
  `--drop-roll-calls`; nenhum DELETE; exit 0.
- **T10-07.** R32. Com flag: DELETE `roll-call/5/mon` antes do de
  `calendar-event/5/mon`.
- **T10-08.** R32. `--drop-roll-calls --no-prune`: os dois deletes pulados
  (`DeleteRollCall` em `PRUNE_OPS`).

`cli/tests/test_cli_attendance.py`, no molde de `cli/tests/test_cli_grades.py`:

- **T10-09.** R33. Sem `--csv`: tabela com DROPPED e `-`, sem arquivo.
- **T10-10.** R28, R33. `--csv out.csv`: igual byte a byte ao fixture de
  T7-01 a T7-03.
- **T10-11.** R33. Curso sem chamadas: mensagem clara, exit 0.
