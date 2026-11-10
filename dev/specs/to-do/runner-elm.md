---
type: spec
status: to-do
tags: [runner, elm]
relatedTo: [ambiente-de-execucao-no-cliente, runner-de-correcao]
---

# Elm no runner do cliente

## Contexto

O runner do cliente (`src/runner/`, RFC `ambiente-de-execucao-no-cliente`)
roda JavaScript, TypeScript, Python, Lua e Prolog num Worker isolado, só com
stdin e stdout. A disciplina de Paradigmas usa Elm este semestre, e o aluno
precisa experimentar código como no `elm repl` e rodar os testes do
exercício. Esta spec adiciona Elm ao runner, só com REPL e testes: nada de
`Browser`, DOM ou aplicações gráficas.

O compilador é o [Guida](https://github.com/guida-lang/compiler)
(`guida@1.0.0-beta.2` no npm, BSD-3-Clause): um port do compilador Elm 0.19.1
escrito em Elm e compilado para JS. O `bin/guida.min.js` do pacote traz o
loop do `elm repl` inteiro (`Elm.Terminal.Main`), que imprime `valor : Tipo`
como o original. Todo acesso dele a arquivo, stdin e processos passa por
requisições XHR a um servidor falso (`mock-xmlhttprequest`), que o
`bin/index.js` implementa com Node; o driver implementa os mesmos endpoints
com um sistema de arquivos em memória.

A prova de conceito (Node, em memória, offline) compilou um programa em
~200 ms e rodou uma sessão de REPL com 12 entradas em ~1 s:

```
> double 21
42 : Int
> Dict.fromList [("a", Verde 2)]
Dict.fromList [("a",Verde 2)]
    : Dict.Dict String Cor
> f x = x ++ "!"
<function> : String -> String
> 1 + "a"
-- TYPE MISMATCH ---------------------------------------------------------- REPL
...
```

Descartado: o REPL do elm.run (compilador Haskell em WASM, 3.9 MB, sem
licença, parado desde 2024) e o do guide.elm-lang.org (compila no servidor).

## Requisitos

### Linguagem e modos

- **R1.** `elm` é um novo `LanguageId` em `src/runner/protocol.ts`. A tag
  `elm` (sem diferenciar maiúsculas) mapeia para ele em
  `src/runner/languages.ts`. A versão do protocolo não muda: um id novo no
  enum é aditivo, e o app só pede linguagens que o frame anunciou em `ready`.
- **R2.** O driver aceita os modos `repl` e `script`. `defaultRunMode("elm")`
  é `repl`, como em Prolog.
- **R3.** `defaultFilename("elm")` é `Main.elm`. O Elm exige que o nome do
  arquivo bata com o do módulo, e um arquivo sem cabeçalho `module` vale como
  `module Main exposing (..)`.
- **R4.** O editor destaca Elm com o modo legado
  `@codemirror/legacy-modes/mode/elm`.

### Execução

- **R5.** Todo run começa compilando os arquivos do aluno, que ficam em
  `src/` de um projeto `application` com o `elm.json` fixo de R13. O módulo
  de entrada é o do arquivo `entry`, e o nome sai do cabeçalho `module`
  (`Main` quando não há cabeçalho).
- **R6.** Erros de compilação vão para o stderr no formato do Elm, com o
  caminho relativo ao arquivo do aluno (`Main.elm`, nunca `/work/src/...`).
  Cada problema também gera um `ctx.diagnose` com a linha e a coluna do
  início da região (a coluna do Elm é base 1; `Diagnostic` usa base 0). O
  run termina com código 1 e não abre o REPL.
- **R7.** Testes: quando o módulo de entrada declara `tests : Test` (linha
  que começa com `tests :`), o driver compila um módulo gerado que importa
  `tests`, roda a suíte com `Test.Runner` (`elm-explorations/test`) e imprime
  um relatório no estilo do `elm-test`:
  - uma linha por teste que falhou, com o caminho de `describe`s e a mensagem
    de `Test.Runner.Failure`;
  - o total no fim (`Passed: 3, Failed: 1`).

  Fuzz tests usam uma semente aleatória, impressa no relatório, e 100
  execuções. Um `Test.skip` ou `Test.only` deixa o resultado incompleto, e o
  relatório avisa (`TEST RUN INCOMPLETE`), como o `elm-test`.
- **R8.** Modo `script`: compila e roda os testes, se houver `tests`. Sai com
  código 0 quando tudo passa (ou não há testes), 2 quando algum teste falha
  ou o resultado ficou incompleto. Sem `tests`, imprime
  `Compiled Main.elm, no tests to run.` e sai com 0.
- **R9.** Modo `repl`: faz o mesmo que `script` e depois abre o REPL do
  Guida. Antes do primeiro prompt, o driver injeta
  `import <Módulo> exposing (..)` sem eco, para as declarações do aluno
  ficarem acessíveis. `:exit` e fim de entrada (Ctrl+D) encerram o run com
  código 0.
- **R10.** O banner do Guida é trocado por uma linha:
  `Elm 0.19.1 (Guida 1.0.0-beta.2). :help for help, :exit to exit.`
- **R11.** O JS que o REPL gera para cada entrada (pensado para `node`)
  roda no próprio Worker, num `new Function` com um `process` falso:
  `stdout.write` e `stderr.write` vão para `ctx.stdout` e `ctx.stderr`, `on`
  não faz nada e `exit(n)` encerra a avaliação com código `n`. `console.log`
  vai para `ctx.stdout`. Uma exceção na avaliação (ex.: `Debug.todo`) vai
  para o stderr, e o REPL continua.
- **R12.** Nenhuma requisição sai do Worker. O servidor XHR falso responde
  `[]` a `all-packages/since/*` e 404 a qualquer outra URL fora dos endpoints
  do Guida, escrevendo no stderr `elm: network access is disabled (<url>)`.

### Pacotes e cache

- **R13.** Pacotes disponíveis, com versões fixas no `elm.json` do projeto:
  `elm/core`, `elm/json`, `elm/random`, `elm/parser`, `elm/regex`,
  `elm/time`, `elm/bytes` e `elm-explorations/test`. `elm/html` e
  `elm/virtual-dom` entram como dependências indiretas do pacote de testes.
  O aluno não pode instalar outros: `elm.json` é do driver, e um arquivo
  `elm.json` enviado pelo aluno é ignorado.
- **R14.** O cache de pacotes do Guida (`~/.guida/1.0.0/packages/`, com
  `registry.dat` e `artifacts.dat` de cada pacote) e o cache do projeto
  (`guida-stuff/1.0.0/`, com `d.dat`, `i.dat` e `o.dat`) são gerados no
  build, sem rede. Os dois vão num arquivo só (`elm-cache.bin`), servido em
  `/runner/rt/` como os outros runtimes e montado no FS em memória no `load`.
  Sem o cache do projeto, o Guida tenta resolver as dependências de novo e
  faz requisições.
- **R15.** Os fontes dos pacotes de R13 ficam no repositório, em
  `src/runner/elm/packages/<autor>/<nome>/<versão>/`, com o `elm.json`, o
  `LICENSE` e o `src/` de cada um. Um script
  (`scripts/fetch-elm-packages.ts`) baixa e atualiza esses fontes. Ele é
  manual, roda fora do build, e só ele usa rede.
- **R16.** O build gera `elm-cache.bin` rodando o Guida em Node com o mesmo
  FS em memória. O XHR falso responde ao registry a partir dos fontes de R15
  (`all-packages` só com eles, o `elm.json` e o `endpoint.json` de cada um,
  e um zip montado em memória no lugar do `zipball` do GitHub).
  Rodar o build duas vezes sem mudar nada gera o mesmo arquivo.

### Runtime e build

- **R17.** O Guida entra em `RUNTIMES` (`src/runner/sandbox/runtimes.ts`)
  com versão fixa. `bin/guida.min.js` é um script clássico que espera um
  `XMLHttpRequest` global e define `Elm` em `this`, então ganha o `wrap`
  necessário para virar um módulo ES. `mock-xmlhttprequest` entra no bundle
  do driver; a lista de pacotes que o bundle pode importar
  (`src/runner/server/integration.ts`) passa a aceitá-lo.
- **R18.** O driver instala o servidor XHR falso só dentro do seu Worker
  (cada run tem o seu). O `load` monta o FS e carrega o Guida sem compilar
  nada, para a reserva criada por `prepare` ficar pronta.

### Dados de dev

- **R19.** `src/db/bootstrap.ts` semeia em `cs101`:
  - um recurso `CODE` `elm-lists.elm` com funções sobre listas e
    `tests : Test`, com um teste que falha de propósito;
  - um recurso `CODE` `elm-repl.elm` sem testes, para experimentar no REPL;
  - um bloco ` ```elm ` numa nota que já tem blocos executáveis.

## Fora do escopo

- Aplicações gráficas (`Browser.*`, `Html` renderizado, DOM).
- Instalar pacotes além dos de R13, e `elm.json` do aluno.
- Correção automática no servidor (é do chalk, spec `runner-de-correcao`).
- `--optimize`, source maps e mensagens traduzidas.
- Trocar "Guida" por "Elm" nas mensagens de erro do compilador (algumas
  dizem "Guida does not implicitly convert...").

## Plano de ação

| T  | Descrição | Arquivos | Requisitos | Depende de | Modelo |
| :- | :-------- | :------- | :--------- | :--------- | :----- |
| T1 | Fontes dos pacotes e script de download | `scripts/fetch-elm-packages.ts`, `src/runner/elm/packages/` | R13, R15 | — | sonnet |
| T2 | FS em memória e servidor XHR falso do Guida, compartilhados por build e driver | `src/runner/sandbox/drivers/elm/host.ts`, `fs.ts` | R11, R12, R18 | — | sonnet |
| T3 | Geração de `elm-cache.bin` no build e entrada em `RUNTIMES` | `src/runner/server/integration.ts`, `src/runner/sandbox/runtimes.ts`, `package.json` | R14, R16, R17 | T1, T2 | sonnet |
| T4 | Driver: compilação, diagnósticos, testes, REPL | `src/runner/sandbox/drivers/elm/index.ts`, `drivers/index.ts`, `protocol.ts`, `languages.ts` | R1 a R3, R5 a R11 | T2, T3 | sonnet |
| T5 | Destaque no editor | `src/components/runner/editor.ts` | R4 | T4 (id) | haiku |
| T6 | Seed | `src/db/bootstrap.ts` | R19 | T4 | haiku |
| T7 | Testes de ponta a ponta | `test/runner-languages.spec.ts`, `test/runner-elm.spec.ts` | todos | T4 | sonnet |

Critério de pronto por tarefa:

- **T1.** `src/runner/elm/packages/` tem os pacotes de R13 nas versões do
  `elm.json`, e o script refaz a pasta idêntica.
- **T2.** Teste em Node: o Guida compila um `Main.elm` com `Debug.toString`,
  sem rede, a partir de um cache de fixture.
- **T3.** `pnpm run build` gera `elm-cache.bin` igual em dois builds
  seguidos. Um build sem rede funciona.
- **T4.** Os testes de T7 passam.
- **T5–T6.** `pnpm run lint` sai com 0, e o recurso semeado roda no dev
  server.
- **T7.** Os casos abaixo passam em `test/runner-elm.spec.ts`, rodando o
  frame de verdade pelo `runner-harness.ts`:
  1. `repl`: `double 21` responde `42 : Int`, usando a função do
     `Main.elm` (prova o import injetado).
  2. `repl`: uma declaração seguida do uso dela mostra `<function> : ...` e
     depois o valor.
  3. Erro de tipo: o stderr traz `TYPE MISMATCH`, e o diagnóstico aponta a
     linha e a coluna certas (base 0); o REPL não abre; a saída é 1.
  4. `script` com `tests` em que um teste falha: o relatório lista o teste e
     o total; a saída é 2.
  5. `script` com todos os testes passando: a saída é 0.
  6. Nenhuma requisição de rede durante o run (verificada pelo Playwright).
  7. `Debug.todo` no REPL vai para o stderr, e o prompt seguinte aparece.
  8. Ctrl+D encerra o REPL com código 0.

## Critérios de aceite

- Sessão de REPL no dev server, com o recurso semeado, mostrando valor e
  tipo e o import automático do módulo.
- Saída do relatório de testes com uma falha.
- `pnpm run lint` e `pnpm test` verdes.
- Tamanho servido (brotli) do Guida e do `elm-cache.bin`, e o tempo do
  primeiro Run até o prompt, medidos no Chromium.
