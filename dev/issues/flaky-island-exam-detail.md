---
type: issue
status: active
tags: [tests, flaky]
---

# `islands-no-raw-ids` falha às vezes na página da prova

Na suíte completa, `test/islands-no-raw-ids.spec.ts` › "exam detail
(ExamQuestionsList)" falhou uma vez com a página não carregando
(`response.ok()` falso). Sozinho, com `--repeat-each=24`, passou todas as
vezes, cobrindo todos os tipos de questão da factory. A falha não guardou o
status nem o log do servidor.

Próximo passo: quando reaparecer, guardar o status HTTP e o corpo da resposta
na mensagem do `expect` para saber se é 500, timeout ou outra coisa.
