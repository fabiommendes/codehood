---
type: spec
status: implemented
tags: [calendar, ical, profile, auth]
relatedTo: [calendar-entries, roll-call, exam-state]
---

# Feed iCal do calendário

## Contexto

O calendário (`/calendar`) mostra as aulas e provas dos cursos do usuário, mas
só dentro do site. Aluno e professor vivem no Google Calendar, no Thunderbird
ou no calendário do celular. Este spec dá a cada usuário uma URL secreta com um
arquivo `.ics` (RFC 5545) que esses aplicativos assinam e atualizam sozinhos.

O conteúdo do feed é o mesmo da página `/calendar`: `calendarEntries` em
`src/services/calendar-entries.ts` já junta eventos e provas; o feed só muda a
saída.

## Glossário

- **Feed do calendário**: URL secreta e só de leitura que devolve, em iCal, os
  eventos e provas que o dono veria em `/calendar`. Entra no `GLOSSARY.md`.

## Requisitos

### Banco

**R1.** Novo modelo, um por usuário no máximo:

```prisma
/// The secret behind a user's calendar feed URL. Grants read-only access to
/// what the user sees on /calendar and nothing else.
model CalendarFeed {
  username String @id
  user     User   @relation(fields: [username], references: [username], onDelete: Cascade)

  /// Random, URL-safe. Stored readable so the profile can show the URL again.
  token String @unique

  /// Last time a calendar app fetched the feed. Null if never.
  lastUsedAt DateTime?

  createdAt DateTime @default(now())
}
```

**R2.** O token não é uma `ApiKey`. Uma `ApiKey` vale como `Bearer` com todas
as permissões do dono; o token do feed só abre o feed. O middleware de API key
nunca consulta `CalendarFeed`.

**R3.** O token é guardado legível (não em hash), para o perfil mostrar a URL
de novo sem obrigar a regerar. O risco de um vazamento do banco se limita à
leitura do calendário. Gerado com `generateToken()` de `src/auth/token.ts`
(32 bytes, base64url).

### Service

**R4.** `CalendarFeedService` em `src/db/services/calendar-feed.service.ts`,
seguindo `src/db/services/README.md`, com:

- `get(username, opts)`: o feed do usuário ou `null`.
- `rotate(username, opts)`: cria o feed se não existe, ou troca o token se
  existe. A URL antiga deixa de funcionar na hora. Devolve o feed.
- `remove(username, opts)`: apaga o feed. Sem feed, não faz nada.
- `resolve(token)`: o `UserActor` dono do token, ou `null` se o token não
  existe. Atualiza `lastUsedAt`. Não recebe actor (como `ApiKeyService.validate`).

**R5.** Só o próprio usuário lê, cria, troca ou apaga o seu feed. Nem admin
mexe no feed de outro (o admin pode apagar o usuário, o que apaga o feed em
cascata). A regra entra no registro de permissões em `src/auth/permissions/`.

### Conteúdo do feed

**R6.** Função pura `renderCalendar(entries, opts): string` em
`src/services/calendar-feed.ts`, sobre o tipo de entrada de
`calendar-entries.ts`. A serialização iCal (escape de `\`, `;`, `,` e quebra de
linha; dobra de linhas em 75 octetos; `CRLF`) fica num módulo genérico
`src/utils/ical.ts`, sem dependência nova. Sem biblioteca externa: o formato
usado aqui é pequeno.

**R7.** O feed tem `VERSION:2.0`, `PRODID:-//Codehood//Calendar//<locale>`,
`CALSCALE:GREGORIAN`, `METHOD:PUBLISH` e `X-WR-CALNAME` com "Codehood — <nome
do usuário>" localizado. Horários em UTC (`...Z`), sem `VTIMEZONE`.

**R8.** Um `VEVENT` por evento de calendário:

- `UID`: `event-<id>@<host>`, estável entre requisições.
- `SUMMARY`: `<disciplina> · <título do evento>`.
- `DTSTART`/`DTEND`: `startAt` e `startAt + durationMin`.
- `DESCRIPTION`: a descrição do evento, se houver, mais a URL da página do
  curso.
- `URL`: a URL absoluta da semana do evento na agenda do curso.
- `DTSTAMP`: `updatedAt` do evento.
- Evento `CANCELLED` sai com `STATUS:CANCELLED`, não some, para o aplicativo
  riscar o compromisso que já tinha. `HOLIDAY` sai como evento normal com o
  título do feriado.

**R9.** Um `VEVENT` por prova com `scheduledAt`:

- `UID`: `exam-<id>@<host>`.
- `SUMMARY`: `<disciplina> · <rótulo do tipo>: <título>` (ex.: "cs101 · Prova:
  P1").
- `DTSTART`: `scheduledAt`. `DTEND`: o fim da janela (`windowEnd` em
  `exam-state.ts`). Prova sem duração vira evento de 0 minutos.
- `URL`: a página da prova.
- Provas `DRAFT` e `ARCHIVED` ficam fora para todos, inclusive para o professor
  (no `/calendar` o professor vê rascunhos; no feed, que vai para fora do site,
  não).
- A janela é a geral da prova. Quando [exceções por
  aluno](per-student-exceptions.md) entrar, o R8 daquele spec troca pela
  janela pessoal em `calendar-entries.ts`, e o feed herda isso.

**R10.** Quais cursos entram: os que o dono vê em `/calendar` (`db.course.findMany`
com o actor do dono), menos os que terminaram (`endAt`) há mais de 60 dias.
Um admin recebe só os cursos que ensina ou em que está matriculado, não todos
(o feed é pessoal; a regra de `/calendar` para admin não serve aqui). As
provas são carregadas numa consulta só, não uma por curso.

### Rota

**R11.** `GET /calendar/<token>.ics` em `src/pages/calendar/[token].ics.ts`,
rota bruta como `src/pages/openapi.json.ts`:

- Token válido: 200, `content-type: text/calendar; charset=utf-8`,
  `cache-control: private, max-age=300`.
- Token inexistente ou malformado: 404, corpo vazio. Mesma resposta nos dois
  casos.
- Não usa sessão nem cookie: funciona sem login, e uma sessão de outro usuário
  no navegador não muda o resultado.

### Perfil

**R12.** Nova aba "Calendário" no perfil (`src/pages/profile.astro`) com:

- Sem feed: um texto curto explicando o feed e o botão "Criar link".
- Com feed: a URL absoluta num campo só de leitura com botão de copiar, a data
  do último acesso ("nunca usado" se `lastUsedAt` é nulo), o botão "Gerar novo
  link" (avisa que o anterior para de funcionar) e o botão "Desativar".
- Ações `profile.rotateCalendarFeed` e `profile.removeCalendarFeed` em
  `src/actions/profile.ts`, finas sobre o service.
- Textos em `messages/{en,pt-BR}/` (Paraglide).

**R13.** A página `/calendar` ganha um link discreto "Assinar no seu
calendário" que leva à aba do perfil.

### Dados de dev

**R14.** `src/db/bootstrap.ts` cria um feed com token fixo e conhecido para o
aluno de dev (ex.: `dev-student-calendar`), para a URL funcionar logo após o
`db:reset`, e deixa o professor de dev sem feed (estado "sem feed" no perfil).
O token fixo só existe no seed de dev.

## Fora do escopo

- Feed por curso (público ou para quem não tem conta).
- `VALARM` (lembretes): fica a cargo do aplicativo do usuário.
- `VTIMEZONE` e horários locais: UTC basta para todo aplicativo de
  calendário.
- Prazos de outras coisas que não provas (não existem ainda).

## Plano de ação

TDD em modo full: o orquestrador desenha os stubs, o `tester` escreve os testes
por lote e o `implementer` faz passar sem ler os testes.

**T1. Banco e service.** `prisma/schema.prisma`, `src/core/schemas/calendar-feed.ts`,
`src/db/services/calendar-feed.service.ts`, registro em `src/db/`, permissões
em `src/auth/permissions/`. Cobre R1–R5. Sem dependências. Pronto quando os
testes do service (R4, R5) passam e `pnpm run typecheck` sai 0.

**T2. Serialização.** `src/utils/ical.ts`, `src/services/calendar-feed.ts`.
Cobre R6–R9. Sem dependências (paralelo a T1). Pronto quando os testes de
`renderCalendar` passam: escape, dobra de linha, UIDs estáveis, evento
cancelado, prova sem duração, rascunho fora.

**T3. Rota.** `src/pages/calendar/[token].ics.ts`, carregamento das entradas
com o actor do dono. Cobre R10, R11. Depende de T1 e T2. Pronto quando o teste
da rota passa (200 com `text/calendar`, 404 para token errado, curso antigo
fora).

**T4. Histórias e telas.** História em `docs/user-stories/student.md` e e2e em
`test/stories/student-managing-my-account.test.ts`: o aluno cria o link,
copia, baixa o `.ics` com a URL e vê sua aula e sua prova; gera um novo link e
o antigo dá 404; desativa. Depois as telas (R12, R13) e o seed (R14). Depende
de T3. Pronto quando o e2e passa.

**T5. Fechamento.** `GLOSSARY.md`, `CHANGELOG.md`, `pnpm exec biome check
--write .`, `pnpm run lint`, suíte inteira.

## Critérios de aceite

- `curl http://localhost:4321/calendar/dev-student-calendar.ics` devolve um
  calendário válido (conferido com um validador iCal ou importado no
  Thunderbird) com as aulas e as provas do aluno de dev.
- Screenshot da aba "Calendário" do perfil, com e sem feed.
- Saída verde dos testes de service, de serialização, da rota e do e2e.
