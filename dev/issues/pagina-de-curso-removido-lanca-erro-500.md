---
type: issue
status: backlog
tags: [pages, auth]
kind: bug
priority: low
created: 2026-11-11
creator: claude
---

# Página renderizada para um curso removido lança erro em vez de 404

Pedir uma página de curso (por exemplo a recarga que `ExamAttempt` faz depois de
`exam.finish`) quando o curso já não existe no banco derruba a renderização com
erro no log do servidor, em vez de responder 404:

- `TypeError: Cannot read properties of null (reading 'username')`, em
  `isCourseOwner` chamado por `AppLayout`;
- `Error: Resource not found`, em `courseOf` chamado por `CourseHeader`.

Reprodução: abrir uma página de prova no e2e, terminar a prova e encerrar o teste
antes de a recarga terminar; o `resetDatabase` do teste seguinte apaga o curso
enquanto a requisição está em voo. Em produção acontece quando um curso é
apagado com a página aberta. O alvo é só o log e o código de status; nenhuma
resposta de aluno é afetada.

Corrigir: tratar o curso ausente no layout e no cabeçalho como "não encontrado".
