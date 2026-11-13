---
type: issue
status: todo
tags: [exam, grading, code, elm, pretest, e2e, grading-bot]
relatedTo: [fila-de-correcao-externa, runner-elm]
kind: bug
priority: high
created: 2026-11-13
creator: claude
---

# Pré-testes em Elm não funcionam, e falta um ensaio e2e com eles

## Problema

Na `teste2-elm` (`paradigmas`, 2026-11-13), o professor observou que os
pré-testes das questões Elm não estão funcionando. A causa ainda não foi
investigada. O fluxo envolve duas partes:

- **No navegador** (R23 de `dev/specs/to-review/fila-de-correcao-externa.md`):
  `pretestSources` (`src/utils/pretest-sources.ts`) escolhe as fontes de teste
  com regiões todas públicas, o runner de Elm as executa e `summarizeReport`
  (`src/components/exam/code-pretest.ts`) mostra o resultado em
  `CodeAnswer.tsx`.
- **No envio:** o `chalk-worker` roda todas as fontes, e o servidor marca
  `PRETEST_FAILED` quando um caso de pré-teste não passa
  (`src/db/services/grading-job.service.ts`).

No envio, o worker devolveu `PRETEST_FAILED` para 4 dos 77 envios corrigidos.
Três deles foram na `elm-contador-com-desfazer`. Ainda não se sabe se foram
erros reais dos alunos ou um problema na questão.

O teste com o worker foi feito direto na prova real, sem ensaio, porque não
existe roteiro para simular alunos enviando respostas.

## Proposta

1. Diagnosticar os pré-testes em Elm no navegador: abrir uma questão Elm da
   `teste2-elm` como aluno, rodar os pré-testes e registrar o que falha
   (nenhuma fonte selecionada, erro do runner, build, relatório vazio).
   Corrigir.
2. Conferir os três `PRETEST_FAILED` da `elm-contador-com-desfazer`: o
   feedback, a resposta e as fontes públicas da questão.
3. Ensaio e2e reproduzível, numa prova de mentira e nunca numa prova real:
   - um curso de teste com as cinco questões da `teste2-elm` (ou cópias);
   - um script que cria alunos de teste e envia, pela API, respostas
     conhecidas: correta, que falha num pré-teste, que falha num teste
     privado, que não compila e que derruba o `elm-test` (`Debug.todo`
     no topo);
   - `chalk-worker --once` com uma chave `BOT` do curso de teste;
   - checagem automática dos status e notas esperados (`DONE` com nota 1,
     `PRETEST_FAILED` sem gastar envio, nota parcial, `build-error`, `error`
     em todos os casos).
4. Um spec Playwright que roda os pré-testes de uma questão Elm no navegador,
   para que a regressão do item 1 não volte.

## Critérios de aceitação

- [ ] Um aluno roda os pré-testes de uma questão Elm no navegador e vê os
  casos passando ou falhando.
- [ ] O script de ensaio sobe o cenário, roda o worker e confere todos os
  status esperados com um comando só.
- [ ] O ensaio está documentado (onde fica, como rodar, que chave usar) no
  `README.md` do worker ou num guia em `docs/`.
- [ ] Spec e2e dos pré-testes Elm no navegador passando no CI.
