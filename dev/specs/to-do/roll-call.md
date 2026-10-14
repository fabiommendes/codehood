---
type: spec
status: to-do
tags: [attendance, roll-call, calendar, invites, api]
relatedTo: [calendar-event-service, enrollment-service, invite-service]
---

# Chamada em sala de aula

O professor hoje registra presença com um mini quiz por aula, o que dá
trabalho de preparar e de conferir. A chamada substitui isso: durante a aula,
o professor abre a chamada de um [Event](../../../GLOSSARY.md#event) e projeta
um QR code com código rotativo. O aluno, que está na sala com celular ou
notebook, escaneia o QR ou digita o código e fica presente. No fim do
semestre, o professor exporta a frequência de cada aluno.

Termos novos para o glossário: **Roll call** (a chamada de uma aula) e
**Attendance** (a presença de um aluno numa chamada).

## Requisitos

### Mecanismo

- **R1.** Uma chamada por `CalendarEvent`, aberta pelo professor. Não abre em
  eventos dos tipos holiday, recess ou cancelled.
- **R2.** A chamada fica aberta 15 min a partir da abertura. O professor pode
  fechar antes e reabrir quantas vezes quiser; cada reabertura dá mais 15 min
  a partir de agora. Continua sendo o mesmo registro.
- **R3.** O código projetado muda a cada 15 s e é aceito até 30 s depois de
  sair da tela. Os códigos são derivados de um segredo da chamada e do
  relógio (estilo TOTP); nenhum código é gravado no banco.
- **R4.** O código tem 6 caracteres de um alfabeto sem ambíguos (sem 0/O,
  1/I/L). O QR leva à URL de check-in com o id da chamada e o código. O
  código digitado é procurado entre as chamadas abertas.
- **R5.** Tentativas erradas de código têm limite por usuário e por IP.
- **R6.** Um scan válido que cai no login ou no cadastro vira uma presença
  pendente num cookie assinado, válida por 10 min. Ela é concluída quando o
  aluno termina de entrar, mesmo que o código já tenha expirado.
- **R7.** `actsAsInvite` (checkbox na abertura, desligado por padrão): se
  ligado, o check-in matricula quem tem conta sem matrícula e cria a conta de
  quem não tem, pelo mesmo fluxo de cadastro do `Classroom invite`. A presença
  registra se criou matrícula ou conta (`joined`).
- **R8.** Aluno com matrícula DROPPED não faz check-in. A presença dele só
  entra por correção manual.

### Antifraude

- **R9.** Cada navegador recebe um cookie de dispositivo. O hash dele é
  gravado na presença. Quando o mesmo dispositivo marca mais de um aluno na
  mesma chamada, cada presença expõe os outros em `sharedWith`. Nada é
  bloqueado; o professor decide e retira manualmente se for fraude.
- **R10.** Presenças com `joined` preenchido aparecem destacadas para o
  professor como "novos nesta aula".

### Banco

- **R11.** Modelos novos:

```prisma
/// The roll call of one calendar event, opened by the instructor during class.
model RollCall {
  id Int @id @default(autoincrement())

  eventId Int           @unique
  event   CalendarEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)

  /// Random key the rotating codes are derived from. Never leaves the server.
  secret String

  /// Whether a check-in also enrolls the student, or creates the account.
  actsAsInvite Boolean @default(false)

  /// End of the current window. Closing early sets it to now; reopening
  /// pushes it 15 min ahead.
  closesAt DateTime

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  attendances Attendance[]
}

/// One student marked present in a roll call. Absence is the lack of a row.
model Attendance {
  id Int @id @default(autoincrement())

  rollCallId Int
  rollCall   RollCall @relation(fields: [rollCallId], references: [id], onDelete: Cascade)

  username String
  user     User   @relation(fields: [username], references: [username], onDelete: Cascade)

  source AttendanceSource

  /// Hash of the per-browser device cookie. Null for manual entries.
  deviceHash String?

  /// Set when this check-in created the enrollment or the account.
  joined AttendanceJoin?

  /// Free text from a manual entry, e.g. "atestado".
  note String?

  createdAt DateTime @default(now())

  @@unique([rollCallId, username])
  @@index([rollCallId, deviceHash])
}

enum AttendanceSource { CODE  MANUAL }
enum AttendanceJoin   { ENROLLMENT  ACCOUNT }
```

- **R12.** Presença é só a linha existir. Retirar presença apaga a linha.
- **R13.** `CalendarEventService.delete` falha com conflito (409 na REST) se o
  evento tiver chamada. O bloqueio é no service, não em FK `Restrict`, para
  não travar a cascata que apaga um curso inteiro.

### Entidades (`src/core/schemas/roll-call.ts`)

- **R14.** `rollCallSchema` vem antes de `attendanceSchema` no arquivo; o map
  usa `z.lazy()`.

```ts
rollCallSchema = z.object({
  id: rollCallId,
  courseId: courseId,
  week: z.number().int(),
  timeSlot: slug,
  actsAsInvite: z.boolean(),
  closesAt: z.date(),
  /// Keyed by username. A student reads only their own entry.
  attendances: z.record(username, z.lazy(() => attendanceSchema)),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/// One student's presence in a roll call, as it leaves the service.
attendanceSchema = z.object({
  source: z.enum(["CODE", "MANUAL"]),
  joined: z.enum(["ENROLLMENT", "ACCOUNT"]).nullable(),
  note: z.string().nullable(),
  /// Other students of this roll call who checked in from the same browser.
  sharedWith: z.array(username),
  createdAt: z.date(),
});

/// Opens the roll call for 15 min.
rollCallCreate = z.object({
  event: calendarEventPK,
  actsAsInvite: z.boolean().default(false),
});

/// Merge semantics: null removes a student, an absent key is left alone.
rollCallUpdate = z.object({
  actsAsInvite: z.boolean(),
  attendances: z.record(
    username,
    z.object({ note: z.string().trim().max(200).nullish() }).nullable(),
  ),
}).partial();

rollCallPK = z.union([
  z.object({ id: rollCallId }),
  z.object({ course: courseRef, week: z.number().int(), timeSlot: slug }),
]);
rollCallFilter = z.object({ course: courseRef });
```

- **R15.** O update usa merge, não substituição, porque os check-ins
  continuam chegando enquanto o professor edita. Uma chave com objeto cria a
  presença como MANUAL ou altera a nota; `null` remove; chave ausente não
  muda. Uma presença CODE que recebe `note` continua CODE.
- **R16.** `deviceHash` e `secret` nunca saem do service.
- **R17.** `closesAt` não entra no update; só muda por `open` e `close`.
- **R18.** Presença manual só para usuário com matrícula no curso, ativa ou
  DROPPED.
- **R19.** Relatório de frequência:

```ts
attendanceCellSchema = z.enum(["present", "absent", "before-enrollment"]);

courseAttendanceSchema = z.object({
  /// Events that had a roll call, in date order.
  events: z.array(z.object({ week, timeSlot, title, startAt })),
  /// Enrolled students, DROPPED included. A student sees only themself.
  students: z.array(
    enrollmentSchema
      .pick({ username, name, email, schoolId, status })
      .extend({
        /// By `${week}/${timeSlot}`.
        cells: z.record(z.string(), attendanceCellSchema),
        present: z.number().int(),
        /// Every roll call of the course; "before-enrollment" counts as absence.
        total: z.number().int(),
      }),
  ),
});
```

- **R20.** Aula anterior à matrícula do aluno conta como falta (o
  denominador é sempre o total de chamadas do curso), mas aparece como `-` na
  tabela e na planilha.
- **R21.** Métodos de `RollCallService` além do CRUD:
  - `open(pk)`: reabre por 15 min.
  - `close(pk)`: `closesAt = now`.
  - `checkIn({ code, rollCallId? })`: marca a presença do aluno.
  - `currentCode(pk)`: código atual, só para o professor.
  - `courseAttendance(courseRef)`: monta o relatório de R19.

### REST e permissões

- **R22.** Rotas, no molde de `calendar-event`:

| Método | Rota                                              | Uso                                              |
| :----- | :------------------------------------------------ | :----------------------------------------------- |
| GET    | `/api/course/[d]/[c]/roll-call`                   | lista as chamadas do curso                       |
| GET    | `/api/course/[d]/[c]/roll-call/[week]/[timeSlot]` | uma chamada, com as presenças                    |
| PATCH  | `/api/course/[d]/[c]/roll-call/[week]/[timeSlot]` | merge das presenças e `actsAsInvite`             |
| DELETE | `/api/course/[d]/[c]/roll-call/[week]/[timeSlot]` | apaga a chamada (a CLI usa antes de apagar aula) |
| GET    | `/api/course/[d]/[c]/attendance`                  | relatório de frequência                          |

- **R23.** Abrir, fechar, `currentCode` e check-in não passam pela REST, só
  pela web (Astro Actions), porque exigem alguém na sala.
- **R24.** Permissões:

| Ação                               | Professor do curso | Aluno matriculado                       | Admin |
| :--------------------------------- | :----------------- | :-------------------------------------- | :---- |
| create, open, close, `currentCode` | sim                | não                                     | sim   |
| update, delete                     | sim                | não                                     | sim   |
| findOne, findMany                  | tudo               | só a própria entrada do map             | sim   |
| `courseAttendance`                 | tudo               | só a própria linha                      | sim   |
| `checkIn`                          | não                | sim (qualquer usuário se `actsAsInvite`) | não   |

### Telas

- **R25.** Professor:
  - **Agenda** (`/[d]/[c]/schedule`, existente): cada aula elegível (R1)
    ganha o botão "Chamada". Sem chamada, o botão abre um diálogo com o
    checkbox "vale como convite" e abre a chamada. Com chamada, leva à tela
    de gestão.
  - **Página inicial do curso** (`/[d]/[c]`, existente): enquanto houver uma
    aula acontecendo agora, mostra o atalho "Abrir chamada" (ou "Ver
    chamada", se já aberta).
  - **Gestão** (`/[d]/[c]/roll-call/[week]/[timeSlot]`): estado aberta ou
    fechada com contagem regressiva; botões projetar, fechar, reabrir e
    apagar; lista de todos os matriculados (DROPPED esmaecidos) com marcar e
    desmarcar presença, nota, e os badges "novo" (R10) e "mesmo dispositivo
    que X" (R9). Enquanto aberta, se atualiza sozinha.
  - **Projeção** (`.../roll-call/[week]/[timeSlot]/project`): tela cheia com
    QR grande, código em texto, contagem regressiva da janela e número de
    presentes. Busca o código por polling a cada 3 s numa Action que devolve
    o código e o instante da próxima troca.
  - **Notas** (`/[d]/[c]/grades`, existente): a tabela ganha a coluna
    "Frequência" com o % de cada aluno. O cabeçalho leva à página de
    frequência.
  - **Frequência** (`/[d]/[c]/attendance`): tabela alunos × aulas com
    presente, falta ou `-` (R20), DROPPED esmaecidos, presentes, total e %.
    Botão de download CSV.
- **R26.** Aluno:
  - **Check-in pelo QR** (`/c/[rollCallId]/[code]`): URL curta para escanear
    do fundo da sala. Sem login, passa pelo login (ou cadastro, se
    `actsAsInvite`) e volta (R6). Termina em "Presença registrada em
    <título da aula>, <data>". Erros na mesma tela: código expirado, chamada
    fechada, sem matrícula.
  - **Check-in digitado** (`/check-in`): campo de 6 caracteres e botão
    "Registrar", mesma tela de resultado. A página inicial do curso mostra o
    atalho enquanto houver chamada aberta.
  - **Página inicial do curso**: card "Frequência: 18 de 22 (82%)" com link
    para `/[d]/[c]/attendance`, que para o aluno mostra só a própria linha.
  - **Agenda**: cada aula passada com chamada mostra o selo presente ou
    falta.
- **R27.** `/attendance` não entra em `courseTabs()`; chega-se a ela pelos
  links de R25 e R26.
- **R28.** CSV: uma linha por aluno com `username`, nome, matrícula, status,
  uma coluna por aula (`1`, `0` ou `-`), presentes, total e %. Mesmo
  componente `CsvDownload` da página de notas.
- **R29.** O QR é gerado no servidor como SVG.

### CLI

- **R30.** Ao montar o plano de push do calendário, a CLI consulta
  `GET .../roll-call` para saber quais aulas têm chamada.
- **R31.** Uma aula com chamada que saiu do calendário local não é apagada
  por padrão: o plano emite `WarnEventHasRollCall` ("aula 5/mon tem chamada
  com 32 presenças; use `--drop-roll-calls` para apagar"), no molde de
  `WarnTimeSlotPinned`. A aula mantida também mantém o slot dela.
- **R32.** Com `--drop-roll-calls`, o plano gera `DeleteRollCall` antes do
  `DeleteCalendarEvent`.
- **R33.** Comando novo `codehood attendance`: baixa o relatório (R19) e
  mostra a tabela ou grava CSV com `--csv <arquivo>`, no formato de R28.

### Dados de dev

- **R34.** `src/db/bootstrap.ts` semeia no cs101:
  - 3 aulas passadas com chamada fechada.
  - Presenças por código e uma manual com nota "atestado".
  - Um par de alunos com o mesmo `deviceHash` numa chamada (R9).
  - Uma presença com `joined: ENROLLMENT` e outra com `ACCOUNT` (R10).
  - Um aluno matriculado depois da primeira chamada (célula `-`, R20).
  - O aluno DROPPED (`dijkstra`) com histórico anterior à saída.
  - Pelo menos uma aula passada sem chamada, onde o professor pode abrir uma
    na hora para ver a projeção.
- **R35.** Uma chamada aberta não é semeada: ela fecharia 15 min depois do
  seed. O estado "aberta" se vê abrindo uma chamada pela agenda.

## Fora do escopo

- Alerta de limite de faltas.
- Estados atrasado e justificado (a nota livre cobre o justificado).
- Restrição por rede ou geolocalização.
- Monitores (o Codehood ainda não tem esse papel).
- `PATCH` de `CalendarEvent` mudando a chave natural `(week, timeSlot)`.

## Plano de ação

O projeto usa `prisma db push`, sem arquivos de migração; mudar o schema é
editar `prisma/schema.prisma` e rodar `pnpm run db:generate` e
`pnpm run db:reset`.

| Tarefa | Modelo | Depende de | Requisitos |
| :----- | :----- | :--------- | :--------- |
| T1     | haiku  | -          | R11        |
| T2     | sonnet | T1         | R3, R4     |
| T3     | sonnet | T1         | R12 a R21, R24 |
| T4     | sonnet | T2, T3     | R5 a R10, R26 (check-in) |
| T5     | sonnet | T3         | R22, R23   |
| T6     | sonnet | T2, T3     | R25 (gestão, projeção), R29 |
| T7     | sonnet | T3         | R19, R20, R25 (notas, frequência), R27, R28 |
| T8     | sonnet | T4, T6, T7 | R25 e R26 (agenda e página inicial) |
| T9     | haiku  | T3         | R34, R35   |
| T10    | sonnet | T5         | R30 a R33  |
| T11    | coordenador | todas | critérios de aceite |

- **T1. Banco.** Adiciona `RollCall`, `Attendance` e os enums a
  `prisma/schema.prisma`, as relações inversas em `CalendarEvent` e `User`, o
  branding de `rollCallId` em `src/db/branding.ts` e as entradas "Roll call"
  e "Attendance" no `GLOSSARY.md`. Pronto quando `pnpm run db:generate`,
  `pnpm run db:reset` e `pnpm run typecheck` saem 0.
- **T2. Códigos rotativos.** Módulo puro em `src/services/roll-call-code.ts`:
  gerar segredo, derivar o código de um instante, validar com a tolerância
  de 30 s, alfabeto sem ambíguos. Sem banco. Pronto com testes unitários das
  bordas (troca aos 15 s, aceito aos 29 s depois de sair, recusado aos 31 s).
- **T3. Service.** Schemas em `src/core/schemas/roll-call.ts`,
  `RollCallService` (CRUD, merge de R15, `open`, `close`, `currentCode`,
  `courseAttendance`), permissões em `src/auth/permissions.ts` e o bloqueio
  de R13 em `CalendarEventService`. `checkIn` fica como stub para T4. Pronto
  com `test/roll-call-service.spec.ts` cobrindo permissões, merge, R18, R20 e
  R13.
- **T4. Check-in.** `checkIn` no service, Actions, cookie de dispositivo,
  cookie de presença pendente, limite de tentativas, integração com
  matrícula e cadastro (`actsAsInvite`), páginas `/c/[rollCallId]/[code]` e
  `/check-in`. Pronto com testes de página para: aluno logado, aluno sem
  login, conta nova por convite, código expirado, chamada fechada, DROPPED,
  mesmo dispositivo.
- **T5. REST.** Rotas de R22 no registro de `src/api/`, exemplos em
  `test/bruno`, OpenAPI regenerado. Pronto com `test/api-roll-call.spec.ts`.
- **T6. Gestão e projeção.** As duas páginas do professor, a Action de
  polling e o SVG do QR. Pronto com teste de página que abre, fecha, reabre,
  marca e desmarca manualmente, e confere os badges.
- **T7. Frequência.** Página `/attendance` (professor e aluno), coluna
  "Frequência" em `/grades`, CSV. Pronto com teste que confere células,
  `-`, % e o conteúdo do CSV.
- **T8. Pontos de entrada.** Agenda (botão "Chamada" e selos do aluno) e
  página inicial do curso (atalho "Abrir chamada", atalho de check-in, card
  de frequência). Fica numa tarefa só porque toca os mesmos arquivos. Pronto
  com testes de página para professor e aluno.
- **T9. Seed.** R34 em `src/db/bootstrap.ts`. Pronto quando
  `pnpm run db:reset` sai 0 e cada estado de R34 aparece no dev server.
- **T10. CLI.** Regenera `cli/codehood/api/generated.py`, adiciona
  `WarnEventHasRollCall`, `DeleteRollCall`, `--drop-roll-calls` e
  `codehood attendance`. Segue `cli/CLAUDE.md`. Pronto com `uv run pytest`
  em `cli/`.
- **T11. Fechamento.** `pnpm exec biome check --write .`, `pnpm run lint`,
  suíte completa, screenshots das telas com o seed, spec movido para
  `dev/specs/to-review/`, entrada no `CHANGELOG.md`.

A coluna "Modelo" é o implementador. T2 a T8 e T10 seguem TDD conforme a
skill `new-feature`: um projetista de testes `opus` lista os casos, um
escritor `haiku` ou `sonnet` escreve os testes, e só então o implementador
entra. T1 e T9 vão direto ao implementador.

Paralelismo: T2 e T3 depois de T1. Depois de T3: T5, T7 e T9 em paralelo; T4
e T6 quando T2 também terminar. T8 por último entre as telas.

## Critérios de aceite

- Com o seed, o professor abre a chamada de uma aula pela agenda, projeta, e
  um aluno em outra sessão marca presença pelo QR e pelo código digitado.
- Código fora da janela de 30 s é recusado; chamada fechada recusa qualquer
  código.
- Dois alunos no mesmo navegador aparecem um no `sharedWith` do outro.
- Com `actsAsInvite`, um usuário sem conta termina cadastrado, matriculado e
  presente.
- A página de frequência e o CSV batem com o seed, incluindo `-` e DROPPED.
- Apagar pela REST uma aula com chamada retorna 409; o push da CLI avisa e,
  com `--drop-roll-calls`, apaga as duas.
- `pnpm run lint` e a suíte completa passam.
