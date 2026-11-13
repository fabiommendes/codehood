---
type: issue
status: todo
tags: [performance, load-test, exam, grading-bot, e2e]
relatedTo: [metricas-de-performance-no-servidor, tempo-dos-services-no-log, sqlite-em-modo-wal, pre-testes-elm-e2e]
kind: feature
priority: high
created: 2026-11-13
creator: claude
---

# Teste de carga do cenário de prova

## Problema

Na `teste2-elm` (2026-11-13), com a turma fazendo a prova e workers
consumindo a fila, o servidor respondeu com 502 e timeouts
(`metricas-de-performance-no-servidor.md`). Não existe como reproduzir essa
carga fora de uma prova real, então nenhuma correção (WAL, índices, vários
processos) pode ser validada antes da próxima prova.

## Objetivo

Reproduzir, sob demanda, uma prova com **~100 alunos simultâneos** digitando
respostas de código em questões diferentes e **um `chalk-worker`** consumindo
a fila. Medir latência (p50/p95/p99), erros e o atraso do event loop, e
separar os suspeitos, nesta ordem:

1. **Monitoramento dos alunos:** muitas escritas concorrentes. Hoje, por
   aluno (`src/components/exam/ExamAttempt.tsx`,
   `answer-edit-session.ts`):
   - autosave `actions.exam.answer` 500 ms depois de parar de digitar
     (`SAVE_DELAY_MS`);
   - histórico de edição `actions.answerHistory.send`, com flush a cada
     ≤ 1,5 s (`FLUSH_CEILING_MS`), e `inspect`;
   - `exam.start` / `exam.finish` e a renovação de sessão
     (`SESSION_KICK_MIN_MS`).
2. **Fila de correção:**
   - escrita: envios (`SUBMIT`), `claim`, renovação de reserva, `result`,
     `fail`;
   - leitura: polling de `actions.gradingJob.forStudent` a cada 5 s por aluno
     com envio pendente (`SENDS_POLL_MS`). Com 100 alunos, isso dá ~20 req/s
     só de leitura.
3. **Memória ou VPS fraca** (improvável): observar memória do processo, CPU e
   disco durante o teste.

Cada suspeito é um cenário que roda separado e também combinado, para isolar
o efeito.

## Proposta

### Dados (seed)

- Um cenário de seed (`prisma/seed.ts` ou `cli/seed/`) com um curso, uma
  prova `QUIZ` aberta com `meta.codeRun`, e **5–10 questões `code`** em
  linguagens que o worker corrige (Elm, `worker: elm-test`), com solução de
  referência e pré-testes. Pode reaproveitar as questões da `teste2-elm`.
- **100 alunos de teste** matriculados, com credenciais previsíveis, e uma
  chave `BOT` do professor de teste para o worker.
- Para cada questão, um conjunto de respostas: correta, que falha num
  pré-teste, que falha num teste privado, que não compila. Pode ser
  compartilhado com o ensaio de `pre-testes-elm-e2e.md`.

### Geração da carga

Duas opções, possivelmente combinadas:

- **A. Requisições sintéticas** (preferida para os 100 alunos): um script
  (Node com `undici`, ou k6) que faz login de cada aluno, abre a prova e
  reproduz o ritmo de digitação. Envia o texto crescendo caractere a
  caractere, com o mesmo debounce, flush e polling do cliente real, e envia
  a resposta no fim. Roda numa máquina só, sem navegador.
- **B. Gravação com Playwright:** um acceptance test em que um aluno real
  (navegador) responde a prova. As requisições (`/_actions/*`, cabeçalhos,
  corpos e intervalos) são gravadas num arquivo (HAR ou formato próprio), e o
  script da opção A reproduz essa gravação em 100 cópias, trocando a sessão e
  o aluno. Isso garante que a carga sintética continua igual ao cliente de
  verdade quando o front mudar. O teste falha se o formato das actions mudar
  e a gravação ficar velha.
- Opcional: uma rodada com N navegadores reais (Playwright, várias abas) no
  r2d2, para validar que a carga sintética e a real dão números parecidos.

### Alvo e medição

- Rodar contra um servidor de **build de produção** (`node dist/server`),
  com o mesmo modo de banco da VPS, não contra o dev server. Idealmente
  também contra uma VPS igual à de produção.
- Coletar, durante o teste: latência e status por action (do lado do script),
  as linhas lentas de `tempo-dos-services-no-log.md`, as métricas periódicas
  de `metricas-de-performance-no-servidor.md` (memória, atraso do event loop,
  fila) e o tempo de correção do worker.
- Um relatório no fim: p50/p95/p99 e erros por action, por cenário.

### Cenários

1. Só monitoramento: 100 alunos digitando, sem envios.
2. Só fila: envios em rajada e o worker consumindo, sem digitação.
3. Combinado: o ritmo de uma prova real (digitação contínua e envios
   espalhados), com 1 worker e depois com 4.
4. Repetir 1–3 com WAL ligado (`sqlite-em-modo-wal.md`) para medir o ganho.

## Critérios de aceitação

- [ ] Um comando sobe o cenário (seed), roda a carga com N alunos
  configurável e um worker, e imprime o relatório.
- [ ] O cenário combinado com 100 alunos reproduz a degradação vista na
  `teste2-elm` (ou mostra que ela não vem daí).
- [ ] O relatório separa os três suspeitos.
- [ ] A carga sintética vem de uma gravação do cliente real (opção B), ou há
  um teste que falha quando o cliente muda de ritmo ou de actions.
- [ ] Documentado em `docs/` ou `test/load/README.md`: como rodar, contra qual
  servidor e como ler o relatório.
