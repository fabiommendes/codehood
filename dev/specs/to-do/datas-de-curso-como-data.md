# Datas de curso e de edição como data, não instante

O início e o fim de um curso (`Course.startAt`/`endAt`) e a janela de uma
edição (`Edition.startAt`/`endAt`) são datas do calendário, mas estão gravados
como `DateTime`, que é um instante. Para saber "que dia é" o código escolhe um
fuso, e o banco tem dois formatos misturados: meia-noite local (formulário) e
meia-noite UTC (`dateInput`, CLI). `courseWeekZero` adivinha qual dos dois lendo
o instante com `+12h`, o que erra para instantes com hora (as fixtures dos
testes fazem a agenda pular uma semana aos domingos depois do meio-dia, ver
`dev/issues/story-da-chamada-falha-aos-domingos.md`).

## Decisão

As quatro colunas viram `String` no formato ISO `YYYY-MM-DD`, como o Django
grava um `DateField` no SQLite. A data não tem fuso; o fuso do servidor só entra
ao transformar "dia + horário" num instante (`slotInstant`), como já acontece.

- Os campos passam a se chamar `startDate`/`endDate` (Prisma, schemas zod, REST,
  CLI). O nome `*At` fica para instantes, e a troca de nome faz o compilador
  apontar cada uso.
- Tipo de marca `IsoDate` em `src/typing/` e schema `isoDate` em
  `src/core/schemas/base.ts` (aceita só `YYYY-MM-DD` válido; OpenAPI
  `format: date`). `dateInput` deixa de converter para `Date` e vira esse schema.
- Helpers puros em `src/utils/` para o que o código precisa: data de hoje no
  fuso do servidor (`todayIn(zone)`), comparar e somar dias, e o instante de
  início/fim de uma data no fuso (para comparar com `now` e para o feed de
  calendário). Nada de `new Date("YYYY-MM-DD")` espalhado pelo código.

## Regras

- **Semana 0** é a semana ISO (segunda a domingo) que contém `startDate`.
  `courseWeekZero(startDate)` não recebe fuso nem faz heurística. A CLI já conta
  assim (`cli/codehood/push/calendar.py`, `_iso_week_start(calendar.start)` com
  `datetime.date`); servidor e CLI seguem a mesma regra.
- **Comparação com agora:** uma data vale o dia inteiro no fuso do servidor. Um
  curso está em andamento enquanto `startDate <= hoje <= endDate`; a janela da
  edição vale do mesmo modo, com o fim inclusivo.
- **Validação:** `endDate >= startDate` (o refine atual com `>` passa a `>=`
  só se fizer sentido no caso; um curso de um dia é válido).

## Mudanças

1. `prisma/schema.prisma`: `Course.startDate`/`endDate`, `Edition.startDate`/
   `endDate` como `String`. `db push` no dev; nenhuma migração escrita à mão.
2. Schemas, services e actions de curso e edição, o seed
   (`src/db/bootstrap.ts`) e as fixtures (`src/fixtures/`).
3. Leitores: `src/utils/schedule-time.ts`, `src/services/course-schedule.ts`
   (`weekOf` passa a receber `IsoDate`), `src/db/event-times.ts`,
   `src/db/services/calendar-event.service.ts`,
   `src/db/services/edition.service.ts`, `src/utils/load-calendar-feed.ts`,
   páginas (`index`, `schedule`, `settings`, `calendar`, `admin/editions`) e
   `ScheduleWeek.astro`. A lista vem de um grep; o typecheck acha o resto.
4. REST e OpenAPI: os campos renomeados com `format: date`. Regenerar com
   `pnpm run openapi:cli`.
5. CLI (a CLI já trabalha com `datetime.date`; só o transporte converte para
   instante). Testes com `uv run pytest` em `cli/`.
   - `cli/codehood/push/wire.py:76-96`: `course_payload` manda
     `startDate`/`endDate` com `date.isoformat()`; `instant(day)` sai se não
     sobrar outro uso de curso.
   - `cli/codehood/push/plan.py`: `_timestamp` (~1980) sai; `course_ref`
     (~1966) digere as chaves novas e passa a `"v": "v2"`.
   - `cli/codehood/push/project.py:75-76` e `_instant` (~266):
     `project_course` lê `start_date`/`end_date` do GET como data.
   - `cli/codehood/push/run.py:705`: kwargs com os nomes novos.
   - Comentário em `cli/codehood/push/calendar.py:428`.
   - Testes com payload de curso: `tests/test_push_attachments.py:562-570`,
     `tests/test_push_project_integration.py:142-167`.
   - `push/exam.py:245` (`scheduledAt` de prova) e `startAt` de evento não
     mudam.
   - **Base antiga:** a base salva em `.local/codehood/base/` guarda o payload
     do curso com `startAt`/`endAt` em instante. Ao carregar a base, um payload
     de curso com as chaves antigas é normalizado para `startDate`/`endDate`
     (data UTC do instante), para que o primeiro push depois da atualização
     não acuse drift ou conflito falso. Teste: uma base antiga e um curso sem
     mudança resultam em push sem conflito.
   - Entrada no `cli/CHANGELOG.md`.
6. Formulários: o input `type="date"` já entrega `YYYY-MM-DD`; o valor vai
   direto, sem conversão.

## Migração dos dados existentes

`pnpm run release` vai gerar uma migração que remove as colunas antigas e para
por perda de dados. Quem fizer a release edita a migração para copiar os
valores. A conversão de um valor antigo para a data é a regra de hoje, válida
para os dois formatos gravados em fusos entre UTC-12 e UTC+12:

```sql
-- startAt em milissegundos desde a época (formato do Prisma no SQLite;
-- conferir no banco antes)
strftime('%Y-%m-%d', startAt / 1000 + 43200, 'unixepoch')
```

A tarefa deixa o SQL de conversão, testado contra uma cópia do `dev.db` com o
schema antigo, numa seção "Migração" do `CHANGELOG.md` (Unreleased), para a
release usar.

## Testes

- Unit: `courseWeekZero` e `weekOf` com início numa segunda, num domingo e num
  sábado; `todayIn` perto da meia-noite em UTC-3; janela da edição no último
  dia; schema `isoDate` recusando `2026-02-30` e instantes com hora.
- Os dois casos do issue passam a qualquer dia da semana. Rodar
  `test/stories/instructor-attendance.test.ts` e
  `test/course-schedule-page.spec.ts` com o relógio num domingo à tarde (se o
  runner não permitir fixar o relógio, o unit de `courseWeekZero` cobre o caso).
- Snapshot do OpenAPI e client da CLI em dia.

## Critérios de aceitação

- Nenhum `startAt`/`endAt` de curso ou edição no código, na API ou na CLI.
- `courseWeekZero` não tem `+12h` nem parâmetro de fuso.
- `pnpm run lint`, `pnpm test` e os testes da CLI passam.
- O issue `dev/issues/story-da-chamada-falha-aos-domingos.md` é apagado e
  registrado no changelog.
