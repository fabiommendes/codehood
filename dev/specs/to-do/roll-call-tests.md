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
