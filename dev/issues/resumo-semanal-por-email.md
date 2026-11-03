---
type: issue
status: todo
tags: [email, notifications]
relatedTo: [email-service, student-home, instructor-home]
kind: enhancement
created: 2026-10-21
creator: Fábio Macêdo Mendes
---

# Resumo semanal por e-mail

## Contexto

O aluno só descobre uma prova nova se abrir o site.

O conteúdo seria o mesmo das telas iniciais, que já existem
(`src/services/student-home.ts`, `src/services/instructor-home.ts`). O envio
de e-mail ainda não está ligado a um provedor: `ConsoleEmailSender` só
escreve no log (`src/services/email.ts:12`).

## Requisitos

- R1. Um comando de gerenciamento, disparado por cron, envia um e-mail por
  semana.
  - Aceitação: rodar o comando envia um e-mail a cada usuário com conteúdo
    na semana.
- R2. O e-mail do aluno traz as provas e os eventos da semana.
  - Aceitação: o conteúdo bate com o da tela inicial do aluno.
- R3. O e-mail do professor traz as respostas que esperam correção e os
  pedidos de revisão abertos.
  - Aceitação: o conteúdo bate com o da tela inicial do professor.

## A decidir

- Opt-out por usuário (precisa de coluna nova).
- Idioma do e-mail.
- Se o servidor já tem SMTP configurado em produção.
