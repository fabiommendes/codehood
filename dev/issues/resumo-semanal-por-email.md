---
type: issue
status: todo
tags: [email, notifications]
relatedTo: [email-service, student-home, instructor-home]
---

# Resumo semanal por e-mail

O aluno só descobre uma prova nova se abrir o site.

Ideia: um e-mail por semana (comando de gerenciamento disparado por cron)
com as provas e os eventos da semana para o aluno e, para o professor, as
respostas que esperam correção e os pedidos de revisão abertos. O conteúdo
é o mesmo das telas iniciais (`student-home`, `instructor-home`).

A decidir: opt-out por usuário (precisa de coluna nova), idioma do e-mail e
se o servidor já tem SMTP configurado em produção.
