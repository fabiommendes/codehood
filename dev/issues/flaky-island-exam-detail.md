---
type: issue
status: deferred
tags: [tests, flaky]
---

# `islands-no-raw-ids` falha às vezes na página da prova

Na suíte completa, `test/islands-no-raw-ids.spec.ts` › "exam detail
(ExamQuestionsList)" falhou uma vez com a página não carregando
(`response.ok()` falso). Sozinho, com `--repeat-each=24`, passou todas as
vezes, cobrindo todos os tipos de questão da factory. A falha não guardou o
status nem o log do servidor.

Reapareceu numa segunda rodada completa: a resposta veio rápida e sem `ok`,
não por timeout. Isolado, com `--repeat-each=15`, passou 150 vezes. Nenhum
documento da factory faz a prévia lançar (testado com 40 mil). A mensagem do
`expect` agora traz o status e o começo do corpo; na próxima falha, ler ali.
