---
type: issue
status: backlog
tags: [course, admin, retention]
kind: feature
priority: low
created: 2026-11-03
creator: claude
---

# Arquivar curso

Ideia que só existia como requisito. **Precisa de validação antes de virar
story.**

## Problema

Curso não tem arquivamento: `Course` não tem status no schema (só `Exam` e
`Question` têm `ARCHIVED`). A story `admin#reassign-or-retire-a-course`
(`docs/user-stories/admin.md:155`) está `todo` e só fala de passar o curso a
outro instrutor, sem dizer o que "aposentar" faz.

## Proposta

- Curso arquivado some das listagens.
- Responde 404 para quem nunca esteve matriculado.
- Continua legível por inteiro para quem esteve matriculado, com um aviso
  claro de que está arquivado.
- Arquivar não apaga nenhum dado de aluno (respostas, submissões, notas).

Estender `admin#reassign-or-retire-a-course` com isso e acrescentar o caso do
curso arquivado em `student#see-my-courses`.

## Critérios de aceitação

- [ ] Story validada pelo humano.
- [ ] Teste: arquivar e conferir listagem, 404 para estranho, leitura com aviso
      para ex-matriculado, dados de aluno intactos.

## Histórico de edição de respostas

Arquivar é o momento de decidir se o histórico de edição de respostas
(`AnswerEditHistory` e filhas) é compactado ou apagado: é o maior dado de aluno
que o curso carrega e não serve à leitura de um curso arquivado. A medição da
T9 (`dev/specs/to-review/historico-de-edicao-no-servidor.md`) dá de 64 a 128 KiB
gravados por tentativa realista e de 6 a 13 MiB por prova de 100 alunos.

- `pnpm run manage answer-history-stats <curso> [prova]` mede o que o curso
  tem hoje; o evento de log `answer-history.removed` registra o que foi
  liberado quando uma tentativa é removida.
- Falta o gancho do mesmo evento na remoção de curso (`course.service.ts`, que
  apaga as tentativas por cascata). Hoje remover um curso libera o histórico
  sem deixar linha de log.
