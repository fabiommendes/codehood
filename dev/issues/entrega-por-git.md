---
type: issue
status: todo
tags: [submissions, git, grading-bot, cli]
relatedTo: [auto-grading, classroom-invite]
---

# Entrega por git

Trabalhos de programação são entregues hoje como resposta dentro de uma
prova. Para projetos maiores, o natural é o aluno trabalhar num repositório.

Ideia: uma questão de tipo "repositório", em que a submissão é a URL do
repositório e um commit (ou tag). O grading bot clona o commit, roda os
testes e grava o `Feedback` pela REST API. Combina com o `Classroom invite`
que já existe e com o spec de auto-grading.

A decidir: se o servidor confere que o commit existe (exige acesso ao
GitHub) ou se confia no bot; repositórios privados; prazo medido pela data
do commit ou pela data da submissão (a do commit é forjável).
