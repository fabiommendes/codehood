---
type: rfc
status: draft
tags: [runner, editor, terminal, wasm, sandbox]
relatedTo: [runner-de-correcao]
created: 2026-11-06
creator: claude
---

# Ambiente de execução no cliente

Mini-IDE no navegador: editor de código, terminal interativo e botão de rodar.
Todo o código do aluno executa no navegador, em JS ou WebAssembly. Referência:
o repl.it antigo.

## Decidido

- **Sem runner no servidor do Codehood.** Se um dia existir execução remota,
  ela roda num worker separado, fora do processo do servidor.
- **Compilação remota** (servidor compila para WASM, navegador executa) fica
  para uma leva futura. É o caminho previsto para Rust.
- **Editor:** CodeMirror 6 com `@replit/codemirror-vscode-keymap` e tema do
  VS Code. Monaco foi descartado: pesado por instância (listas com vários
  editores por página), sem suporte oficial a celular, workers a configurar no
  Vite. Perde-se o IntelliSense de TS pronto.
- **Terminal:** xterm.js, com um addon de edição de linha (`xterm-readline` ou
  `local-echo`) para histórico, setas e Ctrl+C no REPL.
- **Primeira leva de linguagens**, todas no cliente:

  | Linguagem  | Runtime                            | Modo               |
  | :--------- | :--------------------------------- | :----------------- |
  | JavaScript | nativo, em Worker                  | REPL e script      |
  | TypeScript | `esbuild-wasm` transpila, roda JS  | script             |
  | Lua        | `wasmoon` ou `fengari`             | REPL e script      |
  | Python     | Pyodide                            | REPL e script      |
  | Prolog     | SWI-Prolog (`swipl-wasm`)          | consult + toplevel |

## Desenho aprovado pelo comitê

Decisões votadas em `dev/rfc/ambiente-de-execucao-no-cliente.comite.md`
(rodadas 1 a 4). Stubs e schema: seção "Contratos", escrita pelo `architect`.

### Escopo e entregas

Primeira leva: J1 (resposta de `essay` de código), J2 (snippets em resources
`CODE` e notas `MD`) e J3 (professor roda a submissão na correção). Código
inicial e testes públicos do grader (J4, J5) ficam para depois, mas o modo
`answer` reserva o ponto de encaixe para código inicial.

| Entrega | Conteúdo |
| :------ | :------- |
| E0 | Spike de stdin (feito, descartável): `...spike-stdin.md` |
| E1 | Origem do runner, protocolo, canal de stdin, driver JS, driver falso de testes, testes de isolamento, página no playground |
| E2 | IDE (CodeMirror 6 + xterm.js) em modo `snippet`, ligado a resources `CODE` (J2) |
| E3a | Modo `answer` (J1) com flag no exam e driver JS |
| E3b | Drivers Prolog e depois Python |
| E4 | Modo `review` (J3) |
| E5 | Drivers Lua e TS |

Entrega = commit com `pnpm run lint` e testes verdes, seed em
`src/db/bootstrap.ts` que alcança os estados novos, usável no dev server.

### Contrato de driver

- Cada linguagem é um driver carregado sob demanda; o contrato aceita mapa de
  arquivos desde já (multiarquivo vem depois).
- O driver vê stdin só como `readLine(): string | null` síncrono; o
  transporte é escolhido fora dele.
- Cada execução é um Worker novo. O que se compartilha entre instâncias da
  página é só o cache HTTP dos arquivos do runtime. Parar = `terminate()`
  daquele Worker. Limite de saída em todos os modos.
- Meta: reinício do runtime < 3 s com cache quente, medido na E1 (inclusive
  celular). Acima disso, a decisão reabre.

### Canal de stdin

- Se o iframe do runner estiver `crossOriginIsolated` (via
  `Document-Isolation-Policy` só na origem do runner): `SharedArrayBuffer` +
  `Atomics.wait`.
- Senão: service worker do runner intercepta XHR síncrono do Worker, por
  polling curto (~1 s) com XHR repetido.
- Canal identificado por `runId` de `crypto.randomUUID()`, amarrado ao
  `FetchEvent.clientId` do Worker dono; leitura pendente é cancelada em Parar
  ou em novo Worker.
- O SW tem escopo e script fixos e versionados, intercepta só a rota de
  stdin e não usa Cache Storage.
- A app não manda COOP/COEP. JSPI não é usado.
- Sem nenhum dos dois caminhos (ex.: janela privada sem SW), o botão Rodar
  avisa "navegador não suportado".

### Isolamento e origem do runner

- Origem configurável (`RUNNER_ORIGIN`), servida pelo mesmo processo Astro
  por um endpoint (`src/pages/runner/[...path].ts`), nunca por `public/`. O
  middleware separa pelo `Host`: no host do runner só o runner responde; no
  host da app o runner dá 404.
- Produção: domínio registrável separado é o padrão documentado; subdomínio
  só com o cookie `__Host-session`.
- Cookie: `__Host-session` em produção, `session` em dev e testes. Em dev e
  testes a app roda em `localhost` e o runner em `127.0.0.1` (sites
  diferentes); os testes afirmam isso e que o cookie não chega ao runner.
- Código do aluno só roda em Worker ou em iframe `sandbox` sem
  `allow-same-origin`, `allow-top-navigation` e `allow-popups` (preview).
  Nunca na página do runner.
- `postMessage` só de dados (stdout, status), origem conferida dos dois
  lados; a app nunca interpreta HTML vindo do runner nem envia credenciais.
- CSP: `frame-ancestors` restrito à app no runner, `frame-ancestors 'self'`
  na app, `connect-src 'self'` no runner.
- Runtimes self-host a partir de pacotes npm, em URLs versionadas com
  `Cache-Control: immutable`. O runner nunca lê runtime de Cache Storage ou
  IndexedDB. Ao carregar, a página do runner apaga bancos IndexedDB e caches
  da origem, em paralelo, com prazo, sem bloquear. Nenhum driver monta FS
  persistente (IDBFS/OPFS). Pacotes extras do Pyodide ficam fora da leva 1.
- Em `review`, o iframe do runner é recarregado a cada submissão.
- Testes de isolamento da E1: cookie não chega ao runner; `fetch` para a API
  falha; Worker não registra nem atualiza SW; IndexedDB/Cache Storage
  gravados por uma execução não são lidos na seguinte; nenhum FS
  persistente.

### Exam e rascunho

- `Exam.allowCodeRun Boolean?`; `null` = padrão do tipo (ligado só em
  PRACTICE). Desligado, o aluno vê "O professor desativou a execução de
  código nesta prova." A flag só vale no modo `answer`; `review` roda sempre.
- Rodar nunca grava submissão; a saída do terminal não faz parte dela.
- Rascunho local (na origem da app) a cada edição e antes de cada Rodar,
  com chave por usuário, apagado no logout. No servidor, o autosave de
  `src/components/exam/ExamAttempt.tsx`. Indicador "salvo às HH:MM", aviso se
  o servidor não recebe o autosave e, se local e servidor divergirem ao
  reabrir, o aluno escolhe a versão.
- Correção automática não roda aqui: nota vem do servidor ou do chalk.

### UX transversal

Progresso no primeiro download e "tentar de novo" na falha; Parar responde
em segundos; teclado no celular e leitor de tela no editor.

## Contratos

Escrito pelo `architect`. Os stubs estão em `src/runner/` (assinaturas,
tipos e docstrings; os corpos lançam `Error("not implemented")`). As
docstrings são a fonte de verdade do contrato; esta seção dá o mapa e o que
ainda não tem stub no código.

### Mapa dos módulos

```
src/runner/
  protocol.ts            app <-> frame (Zod), limites, LanguageId. Compartilhado.
  host.ts                RunnerHost: iframe da página e runs (lado da app)
  sandbox/               bundle do runner; importa só protocol.ts e zod
    frame.ts             startFrame, clearOriginStorage
    worker.ts            startWorker (um Worker por run)
    sw.ts                startServiceWorker (só a rota de stdin)
    worker-protocol.ts   frame <-> Worker (Zod)
    driver.ts            Driver, LoadContext, RunContext
    drivers/index.ts     registro com import sob demanda
    drivers/javascript.ts, drivers/fake.ts
    stdin/types.ts       StdinReader, StdinWriter, StdinTransport, layout do SAB
    stdin/sab.ts         transporte SharedArrayBuffer + Atomics.wait
    stdin/sw.ts          transporte SW + XHR síncrono, mensagens frame -> SW
    stdin/index.ts       detectStdinKind, createStdinWriter, openStdinReader
  server/
    config.ts            resolveRunnerOrigin
    routing.ts           requestSide, runnerHeaders, APP_CSP
    assets.ts            runnerVersion, readRunnerAsset, renderFramePage
    integration.ts       runnerBundle(): build Vite do sandbox
src/pages/runner/[...path].ts   endpoint (sem stub: só chama assets.ts)
```

### Fluxo de uma execução

```
app (A)                     frame (B)                    Worker (B)        SW (B)
RunnerHost.run ── run ────► cria Worker, StdinWriter ─ start ─►
                                                    ◄─ status loading
           ◄── status/progress ──┤                  ◄─ progress
           ◄── status running ───┤                  ◄─ status running
           ◄── output ───────────┤ conta bytes      ◄─ output
                                                    ◄─ status waiting-input
sendLine ── stdin ─────────────► writeLine ──(sab: buffer | sw: postMessage)──►
                                                    ◄─ exit (encerra o Worker)
           ◄── exit ─────────────┘
stop ────── stop ──────────────► terminate() + cancel() ── exit stopped ──►
```

Regras que os stubs fixam:

- Toda mensagem é validada com Zod nos dois lados. A app confere
  `event.origin === runnerOrigin` e `event.source === iframe.contentWindow`;
  o frame confere `appOrigin` e `window.parent`. Mensagem de popup, opener
  ou outro frame é descartada.
- O Worker roda código do aluno e pode forjar mensagens. O frame encerra o
  Worker no primeiro `exit` recebido e ignora o que vier depois. `stopped` e
  `output-limit` só o frame decide.
- Cada run aceito termina com exatamente um `exit`. `run` com `runId` já
  usado no mesmo carregamento do frame é ignorado, sem resposta. `run` com
  linguagem não anunciada termina na hora com `crashed`.
- O frame repassa a saída em lotes: no máximo uma mensagem `output` por
  stream a cada `OUTPUT_FLUSH_MS` (50 ms), esvaziada antes de qualquer
  `status` ou `exit`. `status` igual ao anterior é descartado. O limite de
  saída conta bytes (`maxOutputBytes`) e mensagens do Worker
  (`OUTPUT_MESSAGES_LIMIT`); passar de qualquer um dá `output-limit`.
- Antes de carregar o driver, o Worker chama `lockDownWorkerScope`
  (`sandbox/worker.ts`): apaga `indexedDB`, `caches`, `Worker`,
  `SharedWorker`, `BroadcastChannel`, `navigator.storage` e
  `navigator.serviceWorker` em toda a cadeia de protótipos de `self` e
  `navigator`, e põe no lugar propriedades somente leitura e não
  configuráveis com valor `undefined`.
- O frame limpa IndexedDB, Cache Storage e OPFS da origem ao carregar e no
  início de cada run, sem esperar (`clearOriginStorage`, prazo de 2 s; banco
  com conexão aberta fica para a próxima limpeza). É segunda linha: com o
  bloqueio acima, um run não deveria conseguir gravar nada.
- Um frame carregado com `?exclusive=1` aceita um run por vez; um segundo
  `run` concorrente termina com `crashed`. O modo `review` usa
  `RunnerHost.exclusive` e recarrega o frame a cada submissão.
- No transporte `sab`, o frame só escreve uma linha no buffer depois que o
  Worker avisa `waiting-input` (`StdinWriter.readerWaiting`). Linhas digitadas
  antes ficam na fila do frame. Assim o buffer tem um slot só, sem corrida.
- Fora de produção, `/runner/frame?isolation=off` vem sem
  `Document-Isolation-Policy`, para que os testes exercitem o transporte `sw`
  pelo caminho real de detecção. O mesmo vale para o driver `fake`: só é
  anunciado fora de produção.

### Configuração e middleware (sem stub; mudança em código existente)

`src/core/constants.ts`:

```ts
/// `__Host-` exige `Secure`, que só existe em produção (HTTP em dev e testes).
export const SESSION_COOKIE = PRODUCTION ? "__Host-session" : "session";

/// Origem do runner, ou null quando a execução de código está desligada.
export const RUNNER_ORIGIN: string | null = resolveRunnerOrigin(
	process.env.RUNNER_ORIGIN,
	PUBLIC_URL,
	ENVIRONMENT,
);
```

Produção sem `RUNNER_ORIGIN`: `RUNNER_ORIGIN` é null, o servidor sobe
normalmente, `/runner/` dá 404 e o botão Rodar avisa que a execução de
código está desligada nesta instância.

`src/middleware.ts`, primeiro da cadeia:

```ts
/**
 * Answers 404 for `/runner/` paths on the app origin and for anything but
 * `/runner/` on the runner origin, and adds `APP_CSP` to app responses.
 */
export const runnerOriginMiddleware = defineMiddleware(async (context, next) => {
	// requestSide(context.url, RUNNER_ORIGIN): "not-found" -> 404;
	// "runner" -> next() sem tocar no resto; "app" -> next() + APP_CSP.
});
const COMMON_MIDDLEWARES = [runnerOriginMiddleware, sessionMiddleware, /* ... */];
```

- `astro.config.mjs`: `runnerBundle()` em `integrations`; o host de
  `RUNNER_ORIGIN` entra em `security.allowedDomains`, lido no build como
  `PUBLIC_URL`. Dev server escuta em `localhost` e `127.0.0.1`.
- Testes: `test/env.ts` ganha `TEST_RUNNER_ORIGIN = http://127.0.0.1:<porta>`;
  o servidor de testes passa a responder nos dois hosts.
- O middleware bloqueia no host do runner tudo que ele alcança (rotas SSR
  fora de `/runner/`). Arquivos de `public/` e `/_astro/` não passam por ele:
  o Vite (dev) e o handler estático do adapter node (produção) respondem
  antes, em qualquer host. Em produção é obrigatório o proxy restringir o
  host do runner a `/runner/`; o exemplo de configuração vai na seção
  "Deploying" do `README.md`, e diz que o proxy repassa `Host` ou
  `X-Forwarded-Host` com o host do runner (sem isso o middleware não
  distingue os hosts). O frame só carrega scripts de `/runner/<versão>/`.
- `Chromium do Playwright`: a versão em uso (`@playwright/test` 1.62.1,
  Chromium 151.0.7922.34) suporta `Document-Isolation-Policy`: verificado,
  iframe em `127.0.0.1` dentro de página em `localhost` fica
  `crossOriginIsolated` e com `SharedArrayBuffer`; sem o cabeçalho, não.

### Restrições para as entregas seguintes

- E2 (S4): xterm.js sem addon de clipboard (OSC 52); links na saída abrem
  só com confirmação, em nova aba com `noopener`.
- E2 (U1): no celular, layout empilhado, com o campo de entrada fixo acima
  do teclado.
- E3a (U4): conflito de rascunho mostra as duas versões lado a lado, em
  texto puro, com a hora de cada uma.
- E3b (U3): no Prolog, Rodar = `consult` do editor + toplevel no terminal;
  erro de sintaxe no `consult` com número de linha; a UI avisa "Rodar
  reinicia o Prolog".
- E4 (U2): o professor edita uma cópia do código do aluno que fica só em
  memória, fora do rascunho e do autosave; a saída da cópia é marcada
  "modificado", com "voltar à submissão"; nada vira nota ou feedback sem
  ação explícita.

### Exam (E3a)

Definido pelo repositório e enviado pelo CLI, como `type`, `scheduledAt` e
`duration` (ADR 0011): entra em `examCreate`/`examUpdate`
(`src/core/schemas/exam.ts`), no formato do exam e no CLI.

`prisma/schema.prisma`, em `model Exam`:

```prisma
  /// Whether students may run code in answer mode. Null follows the exam
  /// type: on for PRACTICE, off for QUIZ and EXAM. Review mode ignores it.
  allowCodeRun Boolean?
```

`src/services/code-run.ts` (E3a):

```ts
/** Whether a student may run code while answering `exam`. */
export function canRunCode(exam: Pick<Exam, "type" | "allowCodeRun">): boolean;
```

## Tarefas da E1

Testers e implementers trabalham em paralelo contra os stubs. Testes são
Playwright (`test/*.spec.ts`); funções puras são testadas direto em Node,
como em `test/environment-switch.spec.ts`. Cada tarefa termina com
`pnpm run lint` e `pnpm test` verdes.

| Tarefa | Depende de | Paralela com |
| :----- | :--------- | :----------- |
| E1.1 Origem e servidor | — | E1.6, testes de todas |
| E1.2 Bundle e endpoint | E1.1 | E1.6 |
| E1.3 Frame, Worker, stdin, drivers | E1.2 | E1.4 (código), E1.6 |
| E1.4 RunnerHost e página de diagnóstico | E1.3 (para testar) | E1.5 |
| E1.5 Testes de isolamento | E1.3 | E1.4 |
| E1.6 Medição de reinício | — | todas |

**E1.1 Origem do runner, cookie, CSP da app.**

- Implementação: `src/runner/server/config.ts`, `src/runner/server/routing.ts`
  (`requestSide`, `APP_CSP`), `src/core/constants.ts`, `src/middleware.ts`,
  `astro.config.mjs` (`allowedDomains`, host do dev server),
  `playwright.config.ts` e `test/env.ts` (servidor nos dois hosts,
  `TEST_RUNNER_ORIGIN`).
- Testes: `test/runner-origin.spec.ts`; ajustar
  `test/environment-switch.spec.ts`.
- Aceite e testes esperados:
  - `resolveRunnerOrigin`: os dois exemplos da docstring; valor explícito;
    igual a `PUBLIC_URL` lança; `http` em produção lança; inválido lança;
    produção sem valor dá null.
  - `requestSide`: a tabela da docstring, inclusive `runnerOrigin` null.
  - `SESSION_COOKIE` é `__Host-session` com `ENVIRONMENT=prod` e `session`
    com `dev` (via `loadConstants`, como no teste existente).
  - HTTP: `/login` e `/api/...` em `TEST_RUNNER_ORIGIN` dão 404;
    `/runner/frame` em `TEST_BASE_URL` dá 404; resposta da app traz
    `Content-Security-Policy: frame-ancestors 'self'`.
  - Teste que registra o comportamento real: um arquivo de `public/` e um de
    `/_astro/` respondem 200 em `TEST_RUNNER_ORIGIN`, com comentário de que o
    bloqueio é do proxy em produção. Se um dia passarem a dar 404, o teste
    muda junto com o README.
  - O teste afirma que `TEST_BASE_URL` usa `localhost` e
    `TEST_RUNNER_ORIGIN` usa `127.0.0.1`.
  - `README.md`, "Deploying": `RUNNER_ORIGIN`, domínio separado como padrão,
    o proxy restringindo o host do runner a `/runner/` (obrigatório) e
    repassando `Host`/`X-Forwarded-Host`.

**E1.2 Bundle do sandbox e endpoint.**

- Implementação: `src/runner/server/integration.ts`,
  `src/runner/server/assets.ts`, `runnerHeaders` em `routing.ts`,
  `src/pages/runner/[...path].ts`, módulos de entrada do bundle (um por
  `frame.js`, `worker.js`, `sw.js`, cada um chamando o `start*`
  correspondente).
- Testes: `test/runner-endpoint.spec.ts`.
- Aceite e testes esperados:
  - `runnerHeaders`: diretivas da docstring por tipo; `frame` sem
    `'unsafe-eval'`.
  - `/runner/frame` em `TEST_RUNNER_ORIGIN`: 200, `text/html`, `no-cache`,
    DIP, CSP com `frame-ancestors <TEST_BASE_URL>`, sem `<script>` inline, com
    as `<meta>` da `FrameConfig`, que só referencia scripts em
    `/runner/<versão>/`. Com `?isolation=off`, sem DIP; com `?exclusive=1`,
    `exclusive` verdadeiro na `<meta>`.
  - `/runner/<versão>/worker.js`: `immutable`, tipo JS; outra versão dá 404;
    `..` e `%2e%2e` dão 404.
  - `/runner/sw.js`: `no-cache`.
  - Funciona em `astro dev` (rebuild ao editar `src/runner/sandbox/`), no build
    dos testes (`TEST_DIST_DIR`) e no tarball de `pnpm run package`.
  - Import de fora de `src/runner/sandbox/`, `src/runner/protocol.ts` e `zod`
    quebra o build do bundle.

**E1.3 Frame, Worker, canal de stdin, drivers JS e fake.**

- Implementação: `src/runner/sandbox/**` (exceto stubs já fechados por E1.2).
- Testes: `test/runner-protocol.spec.ts` e o helper `test/runner-harness.ts`
  (abre uma página da app em `TEST_BASE_URL`, injeta o iframe de
  `TEST_RUNNER_ORIGIN/runner/frame`, troca mensagens cruas do protocolo).
  Todos os testes de stdin rodam nos dois transportes (`sab` e
  `?isolation=off` -> `sw`).
- Testes esperados:
  - `ready` com `protocol: 1`, `stdin` certo para cada modo, `languages`
    com `javascript` e `fake`.
  - fake: `out`/`err` em ordem; `exit 3` dá `exited` código 3; `crash` dá
    `crashed`; `load-fail` dá `load-failed`; `progress` chega antes de
    `running`.
  - stdin: `read` com linha; linha digitada antes do `read` (fila); EOF; duas
    leituras seguidas; linha acima de `STDIN_LINE_MAX_BYTES` recusada.
  - `loop` + `stop` dá `stopped` em menos de 2 s, e um run novo funciona
    em seguida; `stop` durante `read` também.
  - `flood` acima de `maxOutputBytes` dá `output-limit`.
  - `runId` repetido é ignorado (nenhuma mensagem para ele, o run original
    segue); linguagem desconhecida dá `crashed`; mensagem que não passa no
    schema é ignorada sem derrubar o frame.
  - Saída em lotes: 10 000 `out` seguidos chegam em bem menos de 10 000
    mensagens, em ordem e completos; nunca dois `status` iguais seguidos;
    `output` pendente chega antes do `exit`.
  - Muitas escritas pequenas abaixo do limite de bytes, mas acima de
    `OUTPUT_MESSAGES_LIMIT`, dão `output-limit`.
  - Worker que forja `exit` com `postMessage`: o frame encerra o Worker e não
    repassa nada depois.
  - Frame com `?exclusive=1`: segundo `run` concorrente dá `crashed`; sem
    `exclusive`, dois runs concorrentes funcionam.
  - Mensagem com origem certa mas `source` diferente de `window.parent`
    (popup aberto pela app, janela que abriu a app) é ignorada.
  - JS: `console.log`/`console.error`, `prompt`, exceção não tratada (stack
    em stderr, código 1), `await` no topo, REPL com EOF.

**E1.4 RunnerHost e página de diagnóstico.**

- Implementação: `src/runner/host.ts`; página
  `src/pages/design/runner.astro` (permanente, fora do playground: textarea,
  seletor de linguagem, Rodar, Parar, entrada de linha, saída em `<pre>`),
  que recebe `RUNNER_ORIGIN` do servidor. Com `RUNNER_ORIGIN` null, a página
  diz que a execução está desligada.
- Testes: `test/runner-host.spec.ts`, pela página.
- Testes esperados: run JS imprime a saída; `stop` resolve `done` com
  `stopped`; duas instâncias na página usam um iframe só; `reload()` troca o
  iframe e o run em andamento termina com `stopped`; `RunnerHost.exclusive`
  cria iframe próprio e um `run()` novo para o anterior; mensagem forjada de outra
  janela (`window.postMessage` da própria página) é ignorada; frame que não
  manda `ready` dá `RunnerUnavailable("timeout")`.

**E1.5 Testes de isolamento** (tester dedicado; não muda código de produção,
salvo falha encontrada).

- Testes: `test/runner-isolation.spec.ts`, com o driver JS pelo harness da
  E1.3.
- Testes esperados:
  - Com login em `TEST_BASE_URL`, nenhuma requisição a `TEST_RUNNER_ORIGIN`
    leva cookie (`page.on("request")`).
  - `fetch` do Worker para a API da app (`TEST_BASE_URL/api/...`) falha.
  - `fetch` do Worker para outro caminho da origem do runner fora de
    `/runner/` dá 404.
  - No Worker, `indexedDB`, `caches`, `navigator.storage`,
    `navigator.serviceWorker`, `Worker`, `SharedWorker` e `BroadcastChannel`
    valem `undefined`, e atribuir ou `delete` não muda isso; o SW registrado
    continua o mesmo (`scriptURL` igual) depois do run.
  - Recuperar qualquer um deles por `Object.getOwnPropertyDescriptor` em
    cada objeto da cadeia de protótipos de `self` e `navigator` (e por
    `Object.getPrototypeOf` repetido) não devolve a API original.
  - Worker aninhado: nenhuma forma de criar Worker a partir do run (inclusive
    via `Blob` URL) funciona.
  - Um run que tenta persistir algo por qualquer caminho acima não vê nada
    no run seguinte, no mesmo frame e depois de recarregá-lo.
  - Requisição ao caminho de stdin com `runId` de outro run dá 403 ou 410.
  - `/runner/frame` não carrega dentro de página de outra origem
    (`frame-ancestors`).
  - Popup aberto pela app e janela que abre a app, ambos de outra origem,
    não conseguem disparar run no frame.

**E1.6 Medição de reinício** (descartável, fora da suíte e do repositório,
como o spike).

- Montagem igual à de produção: frame com DIP, um Worker novo por run, com o
  bloqueio de `lockDownWorkerScope` aplicado antes de carregar o runtime e a
  limpeza de storage disparada no início de cada run.
- Confirmar que Pyodide e swipl-wasm (builds sem pthreads) carregam e rodam
  `input()`/`read/1` sem as APIs bloqueadas. Se algum precisar delas, parar
  e levar ao comitê.
- Medir, com cache HTTP quente, o tempo de `run` até `status: running` para
  os dois, 10 runs seguidos, em Chromium desktop e com CPU 4x mais lenta
  (emulação de celular).
- Medir também a recarga do frame (como no modo `review`): da troca do
  iframe até o `ready`, e até o primeiro `status: running` depois dela.
- Entrega: tabela com mediana e p90 no RFC, seção "Medições". Acima de 3 s,
  o presidente reabre a decisão de Worker por run.

## Em aberto

- Firefox e Safari (inclusive janela privada) não testados: issue
  `dev/issues/runner-firefox-safari.md`, bloqueia a E3a.
- **Elm.** Viável no cliente via backend WASM do GHC (guida, ~1,3 MB gzip no
  REPL; `@live-codes/elm-wasm`, ~10,6 MB). Depende da saída "preview". Leva a
  definir.
- **Rust.** Sem opção prática no cliente: `wasm-rustc` tem ~80 MB, parado
  desde 2024 e sem linker; BrowserPod (Leaning Technologies) tem licença não
  verificada; mrustc e gccrs não servem para ensino.

## Referências

- LiveCodes: playground com dezenas de linguagens no cliente.
- Runno (`@runno/wasi`): runner WASI para ensino.
- futurecoder: curso de Python com Pyodide e `input()` bloqueante.
- JupyterLite, Basthon, WebVM/CheerpX, v86, wasm-clang, ruby.wasm.
