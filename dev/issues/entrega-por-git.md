---
type: issue
status: todo
tags: [submissions, git, grading-bot, cli]
relatedTo: [auto-grading, classroom-invite]
kind: enhancement
created: 2026-10-21
creator: Fábio Macêdo Mendes
---

# Entrega por git

## Contexto

Trabalhos de programação são entregues hoje como resposta dentro de uma
prova. Para projetos maiores, o natural é o aluno trabalhar num repositório.

Combina com o `Classroom invite` que já existe e com o spec de auto-grading
(`dev/specs/to-review/auto-grading.md`, bloqueado pelo mdq-js). Os
repositórios que o servidor já serve por git (`/git/<token>/<slug>.git`) vão
no sentido contrário: do professor para o aluno, só leitura.

## Requisitos

- R1. Uma questão de tipo "repositório", em que a submissão é a URL do
  repositório e um commit (ou tag).
  - Aceitação: o aluno submete URL e commit, e a submissão guarda os dois.
- R2. O grading bot clona o commit, roda os testes e grava o `Feedback` pela
  REST API.
  - Aceitação: o `Feedback` gravado pelo bot aparece na submissão.

## A decidir

- Se o servidor confere que o commit existe (exige acesso ao GitHub) ou se
  confia no bot.
- Repositórios privados.
- Prazo medido pela data do commit ou pela data da submissão (a do commit é
  forjável).
