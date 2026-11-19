# Handoff: autosave e quedas do servidor na prova

Escrito em 2026-11-19. Continua a investigação da prova de 2026-11-18. O
diagnóstico está fechado; os itens 1 a 3 estão implementados e falta o item 4,
na ordem abaixo. Nada foi commitado.

## Onde está o quê

| Arquivo | Conteúdo |
| :-- | :-- |
| `dev/issues/lentidao-na-prova-de-2026-11-18.md` | Medidas do log e da VPS: custo do commit, ritmo real dos saves |
| `dev/issues/sqlite-em-modo-wal.md` | WAL: implementado, aberto até a conferência em produção |
| `dev/issues/historico-de-edicao-em-um-blob-por-campo.md` | Ideia no backlog, fora deste trabalho |
| `.perf/prova-2026-11-18/prova.jsonl` | Log de produção das 14:00 às 19:00 (fora do git, horários em UTC) |
| `test/load/README.md` | Teste de carga, com as opções novas |

## O que se sabe

- O servidor morreu 19 vezes em 2026-11-18 com heap do V8 esgotado (limite de
  uns 312 MB, vindo do `MemoryMax=600M` da unit).
- Quem derruba é a home do instrutor: `src/utils/load-instructor-home.ts` chama
  `db.response.findMany({ course })`, que traz cada tentativa com todas as
  `Submission`. 98% delas são autosaves (162 632 de 165 240 em produção, 907
  bytes de payload em média).
- Cada save (`exam.answer`) manda só a questão que mudou, com o texto inteiro
  dela, e insere uma `Submission` nova. Não há deduplicação de autosave.
- O aluno salva a cada 1,6 s de mediana (9,3 saves por minuto), porque
  qualquer parada de 500 ms dispara o autosave (`SAVE_DELAY_MS` em
  `src/components/exam/ExamAttempt.tsx`).
- O `COMMIT` em `journal_mode=delete` custa 5 a 6 ms de mediana na VPS; em WAL
  com `synchronous=NORMAL`, 0,1 ms. O `fsync` simples do disco é rápido.
- A nota (`examResult` em `src/services/exam-result.ts`) usa, por questão,
  todos os `SUBMIT` e `FINAL`; sem nenhum, a submissão mais nova.

## O que fazer, nesta ordem

### 1. Listagens sem o histórico de autosave (feito em 2026-11-19)

Implementado, sem commit. Spec e medidas em
`dev/specs/to-review/listagens-sem-historico-de-autosave.md`. A rodada de
carga com `--instructor 1m` terminou sem quedas, sem saves com falha e com
`exam.answer` p95 de 54 ms.

- Falta aplicar em produção: o release gera a migração do índice novo de
  `Submission`.
- As telas de instrutor da prova ainda fazem centenas de queries cada; o
  tempo caiu, o número de queries não foi tratado.
- `settleExpired` roda `gradeObjectives` em toda tentativa encerrada a cada
  abertura de tela enquanto houver dissertativa ou código sem correção. Ficou
  barato (0,3 ms por tentativa), mas é trabalho repetido.

### 2. Frequência do autosave de texto (feito em 2026-11-19)

Implementado, sem commit.

- Uma resposta digitada é salva no máximo uma vez a cada 30 s por questão,
  contando da primeira edição não salva; continuar digitando não adia o save
  (`src/components/exam/save-schedule.ts`).
- Salvam na hora: sair do campo, esconder a aba, fechar a página, o prazo e a
  entrega. Objetivas continuam a cada clique.
- O intervalo é a chave `exam.autosaveIntervalMs` de `codehood.config.ts`
  (padrão 30000; variável `EXAM_AUTOSAVE_INTERVAL_MS` no arquivo padrão). O
  servidor de teste usa 500.
- O rascunho local cobre reload e queda do navegador; a perda possível é de
  até 30 s para quem troca de computador sem esconder a aba.
- O aluno sintético segue o mesmo ritmo (`test/load/page.ts`) e salva ao
  trocar de questão. `test/load/calibrate.ts` compara com o log de produção,
  que é do cliente antigo: só dá para recalibrar depois da próxima prova.
- Em produção, `EXAM_AUTOSAVE_INTERVAL_MS` não precisa ser definida. O
  `codehood.config.ts` do `deploy/` pode não ter a chave: vale o padrão.

### 3. WAL com `synchronous=NORMAL` (feito em 2026-11-19)

Implementado, sem commit.

- `src/db/client.ts` roda os pragmas em toda conexão. A variável de ambiente
  `DATABASE_JOURNAL_MODE` (`wal` por padrão, ou `delete`) é a saída de
  emergência: troca o modo no próximo início do servidor, sem novo build.
- Backup conferido na VPS em 2026-11-19 (leitura): `/usr/local/bin/codehood-backup`
  já usa `sqlite3 ".backup"`, que é seguro em WAL. A produção estava em
  `journal_mode=delete`, `synchronous=2`.
- Em produção o modo muda sozinho no primeiro início depois do deploy. Não
  fazer esse deploy com uma prova em andamento.
- Depois do deploy, conferir na VPS: `PRAGMA journal_mode` responde `wal`.
  `PRAGMA synchronous` é por conexão e só o servidor o vê como `1`.
- `pnpm run load` passou a usar WAL por padrão (`--wal on`); `--wal off` sobe o
  servidor com `DATABASE_JOURNAL_MODE=delete`.

### Em aberto: fila de saves no fim da prova

Com o intervalo de 30 s, quem entrega no fim manda de uma vez o que estava
esperando. Rodada de 2026-11-19 (`.load/reports/2026-11-19T17-28-27/`, 60
alunos, instrutor a cada minuto), `exam.answer`:

| | Sem WAL | Com WAL |
| :-- | --: | --: |
| Saves na prova | 445 | 428 |
| Saves com falha | 0 | 0 |
| p95 até 30 s antes do fim | 969 ms | 861 ms |
| p95 nos últimos 30 s | 10,8 s | 11,3 s |
| Máximo | 11,8 s | 12,0 s |

- O WAL não muda a fila: nesta máquina o commit já custa 3 ms sem WAL (na
  VPS, 5 a 6 ms).
- O que segura os saves são as telas de instrutor, de 0,7 a 2,6 s de CPU
  cada, abertas em sequência: a rodada do instrutor do minuto 4 caiu dentro
  dos últimos 30 s. Na rodada anterior, em que não coincidiu, o máximo foi
  4,1 s. A máquina também rodava suítes de outras sessões.
- O teste de carga não reproduz o que a página faz no prazo (a 10 s do fim
  ela salva a cada segundo): os alunos sintéticos que sobram entregam todos
  no mesmo instante.
- Ideias, nada decidido: espalhar o primeiro save final de cada aluno ao
  longo do último minuto; baratear as telas de instrutor da prova
  (`failedJobIds` em `gradingJob.summary` levou até 335 ms por consulta).

### 4. Não inserir autosave idêntico ao anterior

- Na mesma leva, depois dos três acima. Se o payload é igual ao da submissão
  mais nova da questão, o save não insere linha.
- Não se sabe quantos saves repetidos existem; medir no banco de produção
  antes, para saber o ganho.

## Decidido e adiado

- Rascunho único por questão com retrato a cada N minutos: adiado. Com os
  itens 1 e 2 deixa de ser urgente.
- Limpeza dos autosaves antigos em produção: adiada. É irreversível e só
  importa pelo tamanho do arquivo (228 MB); exige aval e backup.
- As objetivas ficam como estão: o autosave delas é o único registro de que o
  aluno trocou de opção.

## Ferramentas feitas nesta sessão

- `test/perf/routes.ts`: ranking das rotas de um log por tempo médio, máximo,
  SQLite e queries.
- `test/load/`: `--instructor`, `--history-bytes`, `--commit-delay`, reinício
  do servidor após queda, `calibrate.ts`. A opção `--commit-delay` não foi
  exercitada numa rodada.
- Lint e `test:unit` passavam ao fim da sessão; o `pnpm test` completo não foi
  rodado.

## Acesso à VPS

`ssh root@codehood.dev`, unit `codehood`, banco em
`/var/lib/codehood/codehood.db`, fuso America/Sao_Paulo (o log grava em UTC).
Para baixar um log grande, comprimir: sem `gzip` a conexão caiu aos 32 MB.
