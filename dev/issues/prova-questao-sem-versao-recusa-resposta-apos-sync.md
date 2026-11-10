---
type: issue
status: todo
tags: [exam, questions, versioning]
kind: bug
priority: medium
created: 2026-11-10
creator: claude
---

# Questão sem versão fixada passa a recusar respostas após um sync

Plausível. Mesma raiz de
`dev/issues/versao-da-questao-fixada-ao-iniciar-o-exame.md`, aqui com o efeito
de perder resposta.

## Problema

Sem pin, `resolveExamQuestion` valida a resposta contra a versão mais recente
da questão (`src/db/services/submission.service.ts:590-610`, `latestId`). Se o
professor re-sincroniza a questão durante a prova e o formato muda (número de
lacunas ou de alternativas, por exemplo), a resposta que o aluno já tem na
tela vira "malformada" e é recusada.

## Passos

1. Aluno responde uma questão de múltipla escolha.
2. Professor faz push de uma versão com outras alternativas.
3. Aluno muda a resposta.

## O que o aluno vê e o servidor guarda

Erro de salvamento com a mensagem de resposta malformada, repetido a cada
tentativa. O servidor guarda a última resposta válida pela versão antiga.

## Direção

Fixar a versão ao iniciar a tentativa (issue acima). O cliente também poderia
avisar que a questão mudou, em vez de repetir o erro.
