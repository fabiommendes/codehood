---
type: issue
status: backlog
tags: [api, rest, feedback, grading]
kind: defect
priority: high
created: 2026-11-13
creator: claude
---

# `GET submission/<publicId>/feedback` devolve feedback de outras submissões

Visto em produção (codehood.dev) em 2026-11-13, ao corrigir a prova `lista1-elm`
do curso `paradigmas/chips_2026-2` com `chalk codehood autograde`. A versão em
produção é a `v0.3.2` ou anterior. Avaliar se o defeito ainda existe na `main`.

## O que acontece

Depois de gravar feedback numa única submissão (`9AqwVNEx8w3M`, questão
`primes`, `ref: chalk`), a listagem de feedback de qualquer outra submissão da
prova devolve esse mesmo item:

```
GET /api/course/paradigmas/chips_2026-2/submission/vZa7rKYDktOx/feedback
[{"ref": "chalk", "submission": "9AqwVNEx8w3M", "score": "1/1", "grader": "chips", ...}]
```

O campo `submission` da resposta mostra que o item é de outra submissão. O mesmo
vale para submissões de outras questões (`palindromes`). Depois de gravar as 129
notas de `primes`, a listagem de uma submissão qualquer devolvia os 129 itens.

## Impacto

Quem lê o feedback de uma submissão pela REST vê o de outra. O
`chalk codehood autograde` pula submissões que já têm feedback humano e, por
causa disso, pulou 383 das 384 submissões da prova. O chalk passou a filtrar
pelo campo `submission` como defesa (chalk fda10b5), mas outros clientes
(worker, scripts, interface) podem ter o mesmo problema.

## Pista

Em `v0.3.2:src/api/index.ts`, `feedbackApi.parseListParams` monta o filtro com
`submission: submissionInCourse(params)`. Verificar se o serviço
`db.feedback` aplica esse filtro na listagem ou se ele se perde (formato do
filtro, `filter` do CRUD com `.omit({ submission: true })`).

## Critérios de aceite

- A listagem de `submission/<publicId>/feedback` devolve só o feedback daquela
  submissão.
- Teste de API com duas submissões, cada uma com seu feedback.
