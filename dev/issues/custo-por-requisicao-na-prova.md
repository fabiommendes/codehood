---
type: issue
status: todo
tags: [performance, exam, grading-bot]
relatedTo: [teste-de-carga-da-prova, metricas-de-performance-no-servidor, sqlite-em-modo-wal]
kind: enhancement
priority: medium
created: 2026-11-14
creator: claude
---

# Custo por requisição durante a prova

## Problema

A causa do travamento da `teste2-elm` foi corrigida (índices em `Submission`
e a busca do `claim`, ver o changelog). O teste de carga com
`--history 50000` mostra o que sobra, em ordem de peso. Nenhum destes itens
derruba o servidor com 100 alunos, mas juntos decidem quantos alunos cabem
num núcleo.

1. **Polling por questão.** `ExamAttempt.tsx` chama
   `gradingJob.forStudent` a cada 5 s para cada questão com envio pendente,
   não uma vez por aluno. Com 100 alunos e 6 envios pendentes foram
   113 req/s, cada uma com ~10 queries e 4 a 5 ms de CPU: metade de um
   núcleo só em polling (relatório `workers`, cenário `queue-0w`). Uma
   action que recebe a lista de questões resolve.
2. **Matrículas da turma inteira a cada requisição.** As regras de permissão
   carregam todas as matrículas ativas do curso (`enrollments` em
   `submission.service.ts`, `answer-edit.service.ts` e outros) para saber se
   o ator é uma delas: 11,7 mil leituras de 100 linhas em 4 min. Filtrar pelo
   `username` do ator na query.
3. **Escrita por requisição de bot.** `validateApiKey` grava
   `ApiKey.lastUsedAt` em toda chamada, um commit com `fsync` (3 ms local,
   mais na VPS). Gravar só quando o valor tiver mais de um minuto.
4. **`promoteExpiredSends` em todo `claim`.** Custa ~40 ms por `claim` com
   100 tentativas abertas, e durante a prova nenhuma delas está vencida.
   Filtrar primeiro as tentativas vencidas pelo horário e só então olhar as
   submissões.
5. **Um autosave é uma linha nova.** Uma prova de 4 min com 100 alunos criou
   ~2 mil linhas em `Submission`; uma prova real cria dezenas de milhares.
   Com os índices isso deixou de pesar nas leituras, mas o banco cresce sem
   limite. Avaliar apagar os autosaves antigos ao fechar a tentativa.
6. **Statements não reaproveitados.** O adapter compila cada SQL de novo
   (`prepare` é ~40% do tempo de SQLite nos relatórios).

## Critérios de aceitação

- [ ] Itens 1 a 3 corrigidos, com o antes e depois de
  `pnpm run load --scenario queue --history 50000`.
- [ ] Itens 4 a 6 decididos (corrigir ou registrar por que não).
