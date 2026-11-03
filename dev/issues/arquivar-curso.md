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
