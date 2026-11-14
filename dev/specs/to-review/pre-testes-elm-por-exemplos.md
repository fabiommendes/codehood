---
type: spec
status: to-review
tags: [elm, code, pretest, grading, chalk-worker, runner]
relatedTo: [fila-de-correcao-externa, pre-testes-elm-e2e]
created: 2026-11-14
---

# Pré-testes em Elm por exemplos

## Contexto

Uma questão `code` em Elm aceita, em `## [tests]`, dois tipos de fonte: um
módulo `elm-test` completo e um bloco de exemplos (`expr ==> valor`, uma linha
por caso). Hoje o bloco de exemplos só existe no `chalk-worker`
(`workers/chalk-worker/chalk_worker/examples.py`). No navegador, o runner Elm
procura `tests :`, e o módulo gerado pelo worker expõe `suite`. Por isso um
bloco de exemplos nunca roda como pré-teste.

Na `teste2-elm`, os pré-testes por módulo também falharam. O diagnóstico não
achou defeito de código: o fluxo roda de ponta a ponta com as questões reais.
A causa provável é configuração. O deploy tem `runner_origin: null`
(`deploy/group_vars/all.yml`), e com isso `runTests` devolve "The code runner
is not available.", enquanto o botão continua habilitado.

Esta spec deixa claro na tela quando o runner está desligado. Também redefine
o bloco de exemplos como um formato documentado, com anotações `mdq:` para a
rubrica e a mesma semântica no navegador e no worker.

## Requisitos

### Runner desligado

- R1. Quando a instância não tem runner (`runnerOrigin` nulo), o botão de
  pré-testes de `CodeAnswer` fica desabilitado e a tela diz que a execução de
  código está desligada nesta instância. O botão não pode ficar habilitado e
  falhar só no clique.
- R2. Um spec e2e roda no navegador o pré-teste de uma questão Elm no estilo
  da `teste2-elm`: módulo linkado `XPublic exposing (tests)` com
  `import Main as S`. Outro spec roda um bloco de exemplos e falha se R8 ou
  R12 regredirem. R1 tem teste próprio: `CodeAnswer` com `runnerOrigin` nulo
  mostra o botão desabilitado e o aviso.

### Formato do bloco de exemplos

- R3. Numa questão Elm, uma fonte de teste é **bloco de exemplos** quando é um
  bloco cercado de formato `elm` sem cabeçalho `module`. Toda fonte linkada é
  módulo. Um arquivo linkado sem cabeçalho `module` é erro do autor (R10),
  nunca bloco de exemplos. Cercas de outros formatos não são bloco de
  exemplos: sem cabeçalho `module`, o worker as recusa como erro de questão
  (hoje ele as trata como exemplos).
- R4. Cada linha do bloco é classificada nesta ordem. As linhas são as do MDQ:
  quebra só em `\n`, `\r` e `\r\n`, nunca em `\x0b`, `\x0c`, `\x85`,
  `\u2028` ou `\u2029`.
  1. Anotação: uma linha que o MDQ lê como anotação (`ANNOTATION_START`, mesma
     regra do lexer do MDQ). Ela é item da rubrica, com regiões, feedback e
     `{public}`/`{example}` como em qualquer fonte de teste do MDQ
     (`mdq/docs/question-types/code.md#annotations`).
  2. Linha em branco: ignorada.
  3. Comentário sozinho na linha (`--` depois de espaços, que não seja
     anotação pelo passo 1): ignorado.
  4. `import` seguido de espaço: só antes do primeiro caso, e é copiado para o
     módulo gerado. Um `import` depois do primeiro caso é erro.
  5. Caso: primeiro sai o comentário inline (o primeiro `--` fora de literais
     de string e de caractere); depois o resto precisa ter exatamente um
     operador fora de literais, com texto dos dois lados:
     - `expr ==> valor` gera `Expect.equal (valor) (expr)`;
     - `expr ~= valor` gera
       `Expect.within (Expect.AbsoluteOrRelative 1.0e-9 1.0e-6) (valor) (expr)`.
       Vale só para `Float` escalar. Para outro tipo, o erro de tipo aparece
       na correção, como em R10.
  6. Qualquer outra linha é erro. Comentário de bloco `{- -}` não é suportado.
     `f 1 --> 2` vira `f 1` mais um comentário, fica sem operador e é erro.
- R5. O nome de um caso, que o aluno vê no resultado, é `expr ==> valor`
  normalizado: espaços nas pontas removidos e um espaço de cada lado do
  operador. Com comentário inline, fica `expr ==> valor (texto)`. Com `~=`, o
  operador muda e o resto é igual.
- R6. Erros do autor no bloco:
  - dois casos com o mesmo nome;
  - nenhum caso;
  - região anotada sem caso.
- R7. O módulo gerado:
  - se chama `Examples<i>`, onde `i` é o índice da fonte em `tests`;
  - expõe `tests : Test.Test`;
  - importa `Expect`, `Test` (sem `exposing`) e o módulo da resposta com
    `exposing (..)`, além dos `import` do bloco;
  - tem `tests = Test.concat [ Test.test "<nome>" (\_ -> ...), ... ]`, sem
    `describe`, para que o nome que aparece seja o de R5 no navegador e no
    worker;
  - usa nomes qualificados em tudo o que gera (`Test.test`, `Expect.equal`).

  O módulo da resposta vem do `file` da questão sem `.elm`, com `/` trocado
  por `.` (`Main.elm` vira `Main`, `Foo/Bar.elm` vira `Foo.Bar`).
- R8. Geração para o navegador: só entram os casos de regiões `{public}` ou
  `{example}`, mais os `import`. Casos antes da primeira anotação e de regiões
  privadas ficam de fora. O navegador nunca recebe o texto bruto do bloco nem
  os nomes dos casos privados, porque o nome contém o valor esperado. Sem
  caso público, o bloco não vira pré-teste. O worker gera com todos os casos.
- R9. Linha de cada caso, contada a partir de 1 na fonte: o worker usa essa
  linha para achar a região do caso e dar a nota. No navegador não há mapa de
  linhas.
- R10. Erros do autor e onde aparecem:
  - O servidor recusa a escrita de uma questão Elm com bloco de exemplos
    inválido (R4 a R6), com fonte linkada resolvida sem cabeçalho `module`, ou
    com `Examples<i>` colidindo com o módulo da resposta ou com o de outra
    fonte. O erro é `InvalidData` e cita o índice da fonte e a linha.
  - Uma fonte linkada não resolvida é pulada, como no lint do MDQ.
  - A regra vale também para questões inline de prova.
  - As mesmas checagens entram nos problemas da questão (`questionProblems`,
    `src/mdq/index.ts`), para marcar documentos antigos.
  - A checagem é só de sintaxe. Um erro de tipo num exemplo continua sendo erro
    de questão na correção do worker, nunca erro do aluno. Para documentos
    antigos, o worker mantém o erro de questão.
- R11. Uma resposta Elm sem cabeçalho `module` recebe
  `module <Resposta> exposing (..)`, com `<Resposta>` pela regra de R7, no
  navegador e no worker. O worker hoje usa `Path.stem` (`grading.py`,
  `_with_header` e `_write_template`), que dá `Bar` para `Foo/Bar.elm`, e
  passa a seguir R7.

### Implementações

- R12. O formato tem duas implementações: TypeScript em
  `src/services/elm-examples.ts` (pura, usada pelo servidor e pelo navegador)
  e Python no worker. As duas rodam a mesma tabela de casos em
  `workers/chalk-worker/tests/resources/elm-examples-cases.json`. Cada linha
  da tabela tem a entrada, o módulo completo, o módulo só com os públicos, os
  nomes e as linhas dos casos, ou o erro esperado. `pretestSources` passa a
  entregar o módulo gerado (filtrado, R8) de cada bloco de exemplos que tenha
  caso público. A regra das fontes em módulo fica como está.

### Dados de dev e documentação

- R13. `src/db/bootstrap.ts` semeia, numa prova aberta:
  - uma questão Elm com bloco de exemplos que tenha uma região `{example}`
    `[0]`, uma `{public}` pontuada e uma privada;
  - uma questão Elm com módulo linkado público, com solução de referência
    correta.
- R14. O formato fica documentado no `README.md` do worker, para operadores, e
  num guia de autor em `docs/authoring/elm-tests.md`, em inglês, com o exemplo
  abaixo.

```elm
import Dict

-- mdq: [0] {example} Exemplos do enunciado
collatzLength 5 ==> 6
collatzLength -42 ==> 0 -- negativos têm comprimento zero

-- mdq: [+2] {public} Média
media [ 7, 8 ] ~= 7.5

-- mdq: [+3] Sequências longas
collatzLength 27 ==> 112
```

## Fora do escopo

- Linhas de continuação para exemplos longos.
- O formato de exemplos em outras linguagens ou na spec do MDQ.
- O ensaio e2e com o worker e alunos de mentira (item 3 da issue), que
  continua na issue.
- Mapear linhas de caso no navegador.
- A configuração `runner_origin` da instância, que fica no repositório
  `deploy/` do humano. A causa da falha na `teste2-elm` é provável, não
  confirmada: esta spec não fecha `dev/issues/pre-testes-elm-e2e.md` antes de
  o humano conferir o deploy.

## Plano de ação

- T1. Runner desligado e e2e de módulo (R1, R2 módulo, R11). Arquivos:
  `CodeAnswer.tsx`, a montagem da resposta em `src/components/runner/`,
  mensagens e um spec e2e novo. Modelo `sonnet`. Pronto quando o spec e2e
  passar.
- T2. Formato em TypeScript (R3 a R9, R12 tabela): `src/services/elm-examples.ts`,
  a tabela JSON e `test/elm-examples.spec.ts` (unit). Fluxo: projetista de
  testes `opus`, escritor, implementador `sonnet`. Pronto quando o unit
  estiver verde.
- T3. Worker (R3 a R7, R9, R11, troca de `suite` por `tests`, R12): `examples.py`,
  `grading.py`, `locate.py`, `report.py` e testes lendo a tabela. Depende do
  T2. Modelo `sonnet`. Pronto quando `uv run ruff check && uv run pytest`
  passar em `workers/chalk-worker`.
- T4. Servidor e navegador (R8, R10, R12, R2 exemplos): validação na escrita
  e em `questionProblems`, `pretestSources` e e2e do bloco de exemplos.
  Depende do T1 e do T2. Modelo `sonnet`. Pronto quando o unit e os e2e
  tocados estiverem verdes.
- T5. Seed, docs e changelog (R13, R14). Depende do T4. Modelo `sonnet`.
  Pronto quando `pnpm run db:reset` rodar sem erro e as duas questões rodarem
  os pré-testes no dev.

T1 e T2 rodam em paralelo.

## Critérios de aceite

- Na prova semeada, o aluno roda os pré-testes das duas questões Elm. Vê
  passar e falhar só os casos públicos, com o comentário inline no nome.
- Sem runner configurado, o botão fica desabilitado e o motivo aparece na
  tela.
- `pnpm run lint` sai 0, `pnpm test` fica verde e o pytest do worker fica
  verde.
