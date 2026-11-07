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
                                                    (bloqueia o escopo ao nascer)
RunnerHost.prepare ─ prepare ► cria reserva ─── load ──►
                                                    ◄─ progress (não repassado)
                                                    ◄─ loaded
RunnerHost.run ── run ────► consome a reserva, StdinWriter ─ start ─►
           ◄── status loading ───┤ (só se a reserva ainda carrega)
           ◄── progress ─────────┤                  ◄─ progress
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
  (`OUTPUT_MESSAGES_LIMIT`); passar de qualquer um dá `output-limit`. A
  contagem de mensagens inclui toda mensagem do Worker depois do `start`,
  de qualquer tipo, forjada ou não, inclusive `status` e mensagens que não
  passam no schema.
- Reserva (P1): o Worker chama `lockDownWorkerScope` ao ser avaliado, antes
  de receber `load`. Em `load` só carrega o runtime; na fase de carga só pode
  mandar `progress`, `loaded` ou `exit { load-failed }`, senão o frame o
  encerra. A reserva aceita um único `start`; `runId` e canal de stdin só se
  ligam a ela quando um run a consome. No máximo uma reserva por linguagem;
  a seguinte só é criada depois que o run atual termina e se a app mandou
  `prepare` de novo. Todas são encerradas quando o documento fica oculto
  (`visibilitychange`). A app nunca manda `prepare` com a execução
  desligada (`allowCodeRun` falso, `RUNNER_ORIGIN` null); com o run antes
  da reserva pronta, a UI mostra "preparando…" (`status: loading`).
- Canal `sw`: o frame gera um `token` aleatório por run, registra no SW em
  `stdin-open` e entrega ao Worker só no `start`. Pedido sem o token dá 403,
  mesmo antes da primeira leitura do dono, sabendo o `runId` ou não. O
  `clientId` do Worker não é visível ao frame, então ele é amarrado no
  primeiro pedido com token válido, como segunda trava.
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
  - `prepare` + `run`: o run vai direto a `running`, sem `loading`; `run`
    antes de `loaded` manda `loading` e depois `running`; `prepare` repetido
    não cria segunda reserva; reserva não é recriada antes de o run acabar;
    `visibilitychange` para oculto encerra as reservas; reserva que manda
    `output` antes do `start` é encerrada; `load-fail` na reserva não afeta o
    run seguinte, que tenta de novo.
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
  manda `ready` dá `RunnerUnavailable("timeout")`; `prepare` antes de Rodar
  faz o run começar sem `loading`; `prepare` com o runner indisponível não
  lança; a página de diagnóstico chama `prepare` no primeiro foco do
  editor.

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
  - Requisição ao caminho de stdin com `runId` de outro run, sem o token,
    dá 403, inclusive antes da primeira leitura do Worker dono; o dono lê
    normalmente depois.
  - A reserva já nasce bloqueada: as APIs valem `undefined` antes do `load`
    e durante `Driver.load`.
  - `status` forjado pelo Worker em laço conta no `OUTPUT_MESSAGES_LIMIT` e
    dá `output-limit`.
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

## Medições

E1.6, tempo do `run` (postado pela app) até `status: running` (runtime
carregado, antes do código do aluno), cache HTTP quente, 10 runs seguidos
depois de 2 de aquecimento. Recarga: troca do iframe até o `ready` do frame
novo. Valores em ms.

| Cenário | Desktop mediana | Desktop p90 | CPU 4x mediana | CPU 4x p90 |
| :------ | --------------: | ----------: | -------------: | ---------: |
| Pyodide | 1969 | 2209 | 7775 | 8562 |
| swipl-wasm | 146 | 167 | 1434 | 1856 |
| Recarga do frame | 50 | 55 | 437 | 461 |

- Pyodide passa de 3 s com CPU 4x, e o tempo é quase todo `loadPyodide`
  (importar `pyodide.mjs` leva 3 ms). Pelo critério da E1, a decisão de
  Worker por run reabre para Python. swipl-wasm e a recarga ficam abaixo.
- Compatibilidade: Pyodide e swipl-wasm carregam e leem `input()` e `read/1`
  (stdin por SAB + `Atomics.wait`) com as APIs bloqueadas, tanto redefinidas
  como `undefined` quanto como getter que lança. Nenhum procura
  `indexedDB`, `caches`, `navigator.storage`, `Worker`, `SharedWorker` ou
  `BroadcastChannel` ao carregar. Depois do bloqueio, nenhum descritor da
  cadeia de protótipos de `self` e `navigator` devolve a API original.
- Versões: Chromium 156.0.8078.79 headless (Linux, desktop), Pyodide 314.0.7
  (npm `pyodide`), npm `swipl-wasm` 8.3.0 (SWI-Prolog 10.1.20, build
  `swipl-web`, sem pthreads). Runtimes servidos da origem do runner com
  `immutable`; o log do servidor confirmou que só `/frame` ia à rede.
- Montagem: app em `localhost`, runner em `127.0.0.1`, frame com
  `Document-Isolation-Policy: isolate-and-credentialless`
  (`crossOriginIsolated` verdadeiro), Worker de módulo novo por run,
  bloqueio antes do `import()` do runtime, limpeza de IndexedDB, Cache
  Storage e OPFS disparada sem espera no início do run. `swipl-web.js` é
  script clássico; o bench o serviu com `export default SWIPL` no fim para
  importá-lo no Worker de módulo, e o bundle de produção precisa do mesmo.
- CPU 4x: `Emulation.setCPUThrottlingRate` não serve, porque o Chromium o
  recusa em alvos de Worker ("only supported for pages") e um laço no Worker
  roda na mesma velocidade com a página a 4x. A medição usou cgroup
  (`systemd-run --scope`, `CPUQuota=25%`, período de 10 ms), calibrado com
  um laço de CPU: 655 ms sem limite e 2602 ms com o limite, no Worker e na
  página. A cota vale para o navegador inteiro (todas as threads somadas),
  mais severo que um celular com vários núcleos lentos; isso pesa mais em
  swipl-wasm e na recarga, cujo tempo varia muito nesse modo. Com o período
  padrão de 100 ms: Pyodide 8789/9392, swipl-wasm 1702/2301, recarga 494/498.

## Contratos da E2

Escrito pelo `architect`. Stubs em `src/components/runner/` e
`src/runner/languages.ts`; as docstrings são a fonte de verdade.

### Módulos

```
src/runner/languages.ts           runnerLanguage(tag), defaultFilename(lang)
src/components/runner/
  CodeRunner.tsx                  o componente (três modos, slots toolbar/footer)
  ide-state.ts                    reducer puro: IdePhase, reduceIde, canRun, isBusy
  terminal.ts                     RunnerTerminal sobre xterm.js; openOutputLink
  mount-blocks.ts                 (E2.4) monta CodeRunner nos blocos de notas MD
```

`CodeRunner` não conhece resource, questão nem exam: recebe código,
linguagem e `runnerOrigin` por props. Quem sabe de onde vem o código é a
página. O que muda entre os modos fica em props (`mode`, `runDisabled`,
`onChange`, `starterCode`) e em dois slots: `toolbar` (navegação de
submissões no `review`) e `footer` (autosave e conflito de rascunho no
`answer`). A E3a e a E4 preenchem os slots sem mexer no núcleo.

### Estados

`ide-state.ts` traduz os eventos do `RunnerHost` para as fases que o
protótipo (`_Ide.astro`) desenha:

| Fase | Vem de | UI |
| :--- | :----- | :- |
| `idle` | início | Rodar |
| `preparing` | Rodar antes da reserva pronta (`status: loading`), `progress` | "preparando…", barra se `total` conhecido, Cancelar |
| `running`, `waiting-input` | `status` | Parar; entrada de linha em `waiting-input` |
| `done` | `exit exited` código 0 | Rodar, duração |
| `error` | `exit exited` código ≠ 0, `crashed` | Rodar, código de saída |
| `stopped` | `exit stopped` | Rodar |
| `truncated` | `exit output-limit` | aviso de saída cortada |
| `load-failed` | `exit load-failed`, `RunnerUnavailable("timeout")` | "tentar de novo" |
| `unsupported` | `RunnerUnavailable("unsupported" \| "protocol")` | "navegador não suportado" |
| `unconfigured` | `runnerOrigin` null | "execução desligada nesta instância" |
| `disabled` | `runDisabled` (E3a) | "O professor desativou a execução de código nesta prova." |

### Uso do `RunnerHost`

- Um `RunnerHost` por página: todo widget chama
  `RunnerHost.shared(runnerOrigin)`. "Tentar de novo" dispara um run novo só
  daquele widget e nunca chama `reload()` no host compartilhado (pararia os
  runs dos outros widgets). Se o frame da página não respondeu (`timeout`), o
  widget volta a `load-failed`; recuperar o frame da página fica para a
  recarga da página. As islands Solid de uma página
  compartilham o módulo `src/runner/host.ts`, então o mapa de hosts é um só.
  O `review` (E4) usa `RunnerHost.exclusive`.
- O iframe só é criado no primeiro foco ou edição de um widget
  (`prepare(language)`) ou no primeiro Rodar; carregar a página não cria
  iframe nem baixa runtime.
- Rodar: `host.run({ language, mode: runMode, files: { [filename]: code },
  entry: filename }, handlers)`. Os handlers alimentam `reduceIde` e o
  terminal. Parar e Ctrl+C: `handle.stop()`. Ctrl+D: `handle.sendEof()`.
- Rodar não grava nada no servidor; a saída do terminal não é guardada.

### Editor e terminal

- Editor: CodeMirror 6 com `@replit/codemirror-vscode-keymap`, tema do VS
  Code e o pacote de linguagem de cada `LanguageId` (na E2,
  `@codemirror/lang-javascript`). Carregado por `import()` dinâmico e
  montado no primeiro foco ou "Editar" (no `answer`, ao montar); nunca
  importado estaticamente. Antes disso, e na renderização no servidor, o
  widget mostra `highlightedHtml`: Shiki com os temas `light-plus` e
  `dark-plus`, para o código não mudar de cor ao virar editor. Assim uma
  lista de snippets não monta dezenas de editores.
- Ctrl/Cmd+Enter roda, registrado com `Prec.highest` para o keymap do VS
  Code não o capturar.
- Terminal: xterm.js por `import()` no primeiro Rodar, com
  `@xterm/addon-web-links`. Edição de linha própria e mínima, sem addon
  (`terminal.ts`): caracteres, Backspace, setas, Home/End, histórico do
  widget, Enter, Ctrl+C, Ctrl+D. Sem addon de clipboard (S4). Links, URLs
  simples e OSC 8, passam por `openOutputLink`: só `http(s)`; o `confirm`
  mostra a URL real (`new URL(url).href`), não o texto do link; nova aba com
  `noopener,noreferrer`. `screenReaderMode` ligado.
- Saída do programa só entra na página por `RunnerTerminal.write`. Texto que
  o widget põe no DOM por conta própria (eco do campo de celular, avisos) vai
  por `textContent`, nunca `innerHTML`.
- Celular (U1): com `pointer: coarse`, layout empilhado; em
  `waiting-input`, um campo de texto fixo acima do teclado envia a linha
  (`handle.sendLine`) e o terminal só mostra o eco. No desktop a linha é
  digitada no próprio terminal.
- Textos da UI pelo Paraglide (`messages/`), como o resto da app.

### Ligação com resources `CODE` (J2)

`src/pages/[discipline]/[course]/resources/[slug].astro`: quando
`runnerLanguage(resource.language)` não é null, a página monta
`<CodeRunner client:load mode="snippet" ... highlightedHtml={bodyHtml}
runnerOrigin={RUNNER_ORIGIN} label={title} />` no lugar do bloco Shiki. Com
linguagem sem driver, ou `RUNNER_ORIGIN` null, a página fica como hoje (o
snippet não mostra um widget que não roda). A linguagem continua texto livre
no schema; nada muda no banco nem no CLI.

### Blocos executáveis em notas `MD` (E2.4)

- Marcação: bloco cercado com `run` na info string, depois da linguagem:
  ` ```js run `. Sem `run`, o bloco é só código, como hoje.
- `src/utils/markdown.ts`: a regra `fence` de markdown-it emite, para blocos
  com `run` e `runnerLanguage(lang)` não null,
  `<div class="code-runner-block" data-language="javascript"><pre><code>…</code></pre></div>`.
  O texto continua escapado; nenhum HTML do autor passa. `data-language`
  vem sempre de `runnerLanguage()`, nunca da info string crua.
- Bloco com `run` e linguagem sem driver: `<pre>` estático dentro de
  `.code-runner-unavailable`, seguido de um aviso discreto "execução não
  disponível para esta linguagem", renderizado no servidor. Blocos sem `run`
  continuam como hoje.
- `mount-blocks.ts`: `mountCodeRunners(root: HTMLElement, runnerOrigin:
  string): void` monta um `CodeRunner` (modo `snippet`, `compact`) em cada
  `.code-runner-block`, lendo o código do `textContent` do `<pre>`. A página
  de resource chama em um `<script>` quando o resource é `MD` e
  `RUNNER_ORIGIN` não é null. Outros lugares que renderizam Markdown
  (preâmbulo de exam, enunciado) não chamam: lá o bloco fica estático.

### Seed

`src/db/bootstrap.ts`, curso cs101 (as stories do aluno usam esse curso):

| Slug | Tipo | Estado que alcança |
| :--- | :--- | :----------------- |
| `js-hello` | CODE, `javascript` | `done`, entrada com `prompt()` (`waiting-input`) |
| `js-forever` | CODE, `javascript` | `while (true) {}`: Parar, `stopped` |
| `js-flood` | CODE, `javascript` | saída acima do limite: `truncated` |
| `js-throws` | CODE, `javascript` | exceção: `error` com stack em stderr |
| `js-links` | CODE, `javascript` | imprime uma URL: confirmação ao clicar |
| `js-notes` | MD com dois blocos ` ```js run `, um ` ```js ` e um ` ```haskell run ` | executáveis, estático e o aviso de linguagem sem driver na mesma nota |

Os `CODE` em Python que já existem continuam estáticos até a E3b: é o caso
"linguagem sem driver". `unconfigured` só aparece em produção sem
`RUNNER_ORIGIN`; `unsupported` só num navegador sem SAB nem SW.

## Tarefas da E2

Novas dependências (aprovadas na rodada 9): `@codemirror/state`,
`@codemirror/view`, `@codemirror/commands`, `@codemirror/language`,
`@codemirror/lang-javascript`, `@replit/codemirror-vscode-keymap`,
`@xterm/xterm`, `@xterm/addon-web-links`, `@xterm/addon-fit`. Sem
`xterm-readline`. Versões exatas no `package.json` (sem `^`), e
`minimumReleaseAge: 10080` (7 dias, em minutos) em `pnpm-workspace.yaml`.
Cada tarefa termina com `pnpm run lint` e `pnpm test` verdes.

| Tarefa | Depende de | Paralela com |
| :----- | :--------- | :----------- |
| E2.1 Lógica pura e terminal | — | testes de todas |
| E2.2 Componente `CodeRunner` | E2.1 | — |
| E2.3 Resource `CODE`, seed e story | E2.2 | E2.4 |
| E2.4 Blocos executáveis em notas `MD` | E2.2 | E2.3 |
| E2.5 Revisão de UI, celular e leitor de tela | E2.3 | E2.4 |

**E2.1 Lógica pura e terminal.**

- Implementação: `src/runner/languages.ts`, `src/components/runner/ide-state.ts`,
  `src/components/runner/terminal.ts` (inclui o editor de linha próprio);
  instala as dependências com versão exata e põe `minimumReleaseAge` em
  `pnpm-workspace.yaml`.
- Testes: `test/runner-ide-state.spec.ts`, `test/runner-languages.spec.ts`
  (Node, sem navegador).
- Testes esperados: a tabela de fases acima, evento a evento; eventos fora
  de hora não mudam o estado; `canRun`/`isBusy` em cada fase;
  `runnerLanguage` com aliases, maiúsculas, null, `fake` e linguagem sem
  driver; `openOutputLink` com `confirm` e `open` injetados: recusa
  `javascript:` e `data:`, não abre sem confirmação, abre com
  `noopener,noreferrer`, e a mensagem do `confirm` contém a URL normalizada
  (ex.: `https://exemplo.com.evil.test/` aparece inteira). Editor de linha
  (navegador, terminal montado numa página de teste): Backspace, setas,
  histórico, Ctrl+C, Ctrl+D.

**E2.2 Componente `CodeRunner`.**

- Implementação: `src/components/runner/CodeRunner.tsx`, mensagens em
  `messages/`. Base visual: `src/pages/design/playground/client-runner/`.
- Testes: `test/runner-widget.spec.ts`, numa página de teste que não fica
  no playground: `src/pages/design/runner.astro` ganha uma seção com dois
  `CodeRunner` em modo `snippet` (a página já existe e não é removida no
  release).
- Testes esperados: carregar a página não cria iframe; foco no editor cria
  um só iframe para os dois widgets; Rodar mostra a saída; Ctrl+Enter roda;
  `prompt()` com linha digitada no terminal; Parar num laço termina em menos
  de 2 s; saída grande dá aviso de cortada; exceção mostra stack e código;
  antes do primeiro foco, nenhum chunk de CodeMirror ou xterm foi baixado
  (`page.on("request")`); Ctrl+Enter roda mesmo com o cursor no editor;
  "tentar de novo" num widget não recria o iframe nem para o run de outro
  widget; saída com `<img src=x onerror=...>` e linha de entrada com HTML
  aparecem como texto;
  Editar, mudar e Rodar usa o código novo; Reset volta ao original; clique
  em link pede confirmação e não abre sem ela; sequência OSC 52 na saída não
  altera o clipboard; em viewport de celular com `hasTouch`, a entrada vai
  pelo campo fixo.

**E2.3 Resource `CODE`, seed e story.**

- Implementação: `src/pages/[discipline]/[course]/resources/[slug].astro`,
  opção de tema em `src/utils/highlight-code.ts` (`light-plus`/`dark-plus`
  para o widget; o resto do app segue com os temas atuais),
  `src/db/bootstrap.ts` (seed da tabela acima), story nova em
  `docs/user-stories/student.md`, seção "Finding course material": "Run a
  code example" (`status: implemented`, `url` da página de resource).
- Testes: `test/stories/student-finding-course-material.test.ts`, teste
  `student: run a code example`, pela UI.
- Testes esperados: aluno abre um `CODE` em JavaScript, roda, digita uma
  linha e vê a saída; um `CODE` em Python continua estático, sem Rodar; a
  página de resource sem foco no widget não cria iframe.

**E2.4 Blocos executáveis em notas `MD`.**

- Implementação: regra `fence` em `src/utils/markdown.ts`,
  `src/components/runner/mount-blocks.ts`, `<script>` na página de resource.
- Testes: `test/runner-markdown-blocks.spec.ts`.
- Testes esperados: HTML da regra (Node): ` ```js run ` vira
  `.code-runner-block` com `data-language`; ` ```js ` fica `<pre>`;
  ` ```haskell run ` fica `<pre>` em `.code-runner-unavailable` com o aviso;
  `<script>` no bloco sai escapado; info string ` ```js" onload="x run ` não
  vaza para atributo. Pela página: na nota `js-notes`, os dois blocos `run`
  rodam e compartilham um iframe; o bloco sem `run` não tem botão; o bloco
  Haskell mostra o aviso e não tem botão.

**E2.5 Revisão de UI, celular e leitor de tela** (`ui-reviewer`, sem
código salvo para correções que ele apontar).

- Contra o protótipo e U1/S4: estados, densidade de lista, tema claro e
  escuro, teclado na tela (iOS/Android emulados), foco e anúncios
  (`aria-live` do status), editor com leitor de tela.

## Contratos da E3a

Escrito pelo `architect`. Modo `answer` (J1) em questões `essay` com
`content: "code"`. Stubs: `src/services/code-run.ts`,
`src/components/exam/code-draft.ts`, `src/components/exam/CodeEssayAnswer.tsx`.
Bloqueada para sair (não para implementar) pela issue
`dev/issues/runner-firefox-safari.md`.

### Flag no exam

- `prisma/schema.prisma`, `model Exam`: `allowCodeRun Boolean?` (texto na
  seção "Exam (E3a)" acima).
- `src/core/schemas/exam.ts`: `examSchema` ganha
  `allowCodeRun: z.boolean().nullable()`; `examCreate` e, por herança,
  `examUpdate` ganham `allowCodeRun: z.boolean().nullish()`. `null` grava
  null (volta ao padrão do tipo); ausente não mexe no valor.
- `src/db/services/exam.service.ts`: `fromDb` e as escritas de create,
  update e upsert levam o campo. O `returns: examSchema` já o deixa sair.
- `src/services/code-run.ts`: `effectiveCodeRun({ type, allowCodeRun })`
  devolve `{ allowed, source }` e `canRunCode` é o seu `allowed`. É a única
  leitura da flag; nenhuma página compara `type`.
- A página do exam mostra o valor efetivo e de onde vem, para professor e
  aluno: "Execução de código: ligada (padrão de PRACTICE)" ou "desligada
  (definida no exam)", conforme `source`.
- REST: `examApi` em `src/api/index.ts` deriva do schema; o snapshot do
  OpenAPI muda.

### CLI

O CLI ainda não envia exams: `cli/dev/specs/to-do/push-exams.md` está em
`to-do` e nada em `cli/codehood/` lê `exams/`. Portanto a E3a no CLI é só:

- atualizar `resources/openapi/codehood.json` (`scripts/copy-openapi.py`) e
  regerar `codehood/api/generated.py`, que ganha `allowCodeRun` em
  `ExamCreate`/`Exam`;
- acrescentar ao spec `push-exams.md` o mapeamento do campo. O schema de exam
  do mdq tem `additionalProperties: false`, mas aceita `meta` livre; a
  mapeamento aprovado (rodada 10) é `meta: { codeRun: true | false }` no
  frontmatter, que vira `allowCodeRun`. Sem `meta.codeRun`, o CLI envia
  `allowCodeRun: null` (ADR 0012: o repositório é dono do campo; apagar a
  chave do frontmatter volta ao padrão do tipo).

Até o push de exams existir, a flag só é definida pela API e pelo seed; o
padrão por tipo (`null`) cobre o caso comum.

### Onde o widget entra

- O campo de resposta do aluno é o `Essay` do mdq-js
  (`AnyQuestionView` em `AnswerField`, `src/components/exam/ExamAttempt.tsx`),
  que só tem `<textarea>` e nenhum ponto de troca. `AnswerField` passa a
  desviar: questão `essay` com `content: "code"` e
  `runnerLanguage(highlight)` não null em modo `answer` renderiza
  `CodeEssayAnswer`; o resto segue no `Essay` do mdq. Questões de código em
  linguagem sem driver (Prolog até a E3b) continuam no `<textarea>`.
- `CodeEssayAnswer` reproduz o que o `Essay` mostra em volta do campo
  (`.mdq-stem` e `.mdq-epilogue`, pelo mesmo `Markdown` exportado pelo
  mdq-js, sem nenhum outro caminho que gere HTML), com as mesmas classes, e
  põe `CodeRunner` (`mode="answer"`, `compact`) no lugar do `<textarea>`. Modos `readonly` e `review` do aluno não mudam.
- Página `src/pages/[discipline]/[course]/exams/[slug].astro`: a island
  `ExamAttempt` ganha as props `codeRun: boolean` (`canRunCode(exam)`),
  `runnerOrigin: string | null` (`RUNNER_ORIGIN`), `username` (chave do
  rascunho) e `answeredAt: Record<slug, string>` (ISO, hora em que o servidor
  gravou cada resposta, para o painel de conflito). A diferença entre o
  relógio do servidor (`now`, que a island já recebe) e o do navegador vira
  `clockOffsetMs`; toda hora de rascunho é gravada e comparada no relógio do
  servidor.
- Conflito e envio: `CodeEssayAnswer.onConflict` informa ao `ExamAttempt` as
  questões com conflito não resolvido. O diálogo de envio as lista, como já
  lista as não respondidas. No envio automático por tempo esgotado,
  `ExamAttempt` fica com a versão mais recente (`newer`): se for o rascunho,
  grava-o antes do `flush`.
- `ExamAttempt` passa a guardar, por questão, `savedAt` (hora da última
  gravação confirmada) e `failingSince` (primeira falha da sequência atual),
  além do que já guarda; monta `CodeAnswerSaveState` a partir disso. O
  debounce, a fila e o `flush` no envio continuam os mesmos: o widget só
  chama `onChange`.
- Barra fixa da prova: com alguma questão de código e `codeRun`, um selo
  "o código roda no seu navegador" ao lado do relógio (protótipo
  `exam.astro`).

### Rascunho local

- `code-draft.ts`: chave
  `codehood:code-draft:<username>:<curso>:<exam>:<questão>`, valor
  `{ code, savedAt }` (`savedAt` no relógio do servidor). Escrito a cada
  edição. Removido quando o servidor confirma uma gravação igual ao
  rascunho.
- Limpeza: todos os rascunhos do exam do usuário (`clearExam`) quando ele
  envia ou o exam encerra; em toda página autenticada, `clearOthers(username)`
  apaga rascunhos de outros usuários e os vencidos (`DRAFT_TTL_MS`, 14 dias),
  por um `<script>` em `AppLayout`; leitura de rascunho vencido devolve
  null.
- Ao abrir a questão: `compareDraft(rascunho, resposta do servidor)`.
  `conflict` mostra as duas versões lado a lado, texto puro, com a hora de
  cada uma ("Este navegador / editado às…", "Servidor / salvo às…"); Rodar e
  edição ficam desligados até o aluno escolher. Escolher o rascunho chama
  `onChange` com ele (vai para o autosave); escolher o servidor apaga o
  rascunho.
- Logout: os formulários de "Sair" (`src/components/nav/UserMenu.astro`) e
  "Sair de todos os lugares" (`src/pages/profile.astro`) chamam
  `draftStore(localStorage).clearAll()` no `submit`, antes do POST. Apaga os
  rascunhos de todos os usuários do navegador. Sessão que expira sem logout
  deixa os rascunhos; a chave por usuário impede que outro usuário os veja
  pela UI.

### Código inicial (J4, futuro)

`CodeEssayAnswer.starterCode` e `CodeRunner.starterCode` já existem e nada os
preenche na E3a; o botão "voltar ao código inicial" só aparece com
`starterCode`. Quando J4 trouxer o campo, `isAnswered`
(`src/components/exam/answer-payload.ts`) precisa tratar resposta igual ao
código inicial como não respondida.

### Mensagens

As do protótipo (`src/pages/design/playground/client-runner/_Ide.astro`,
`exam.astro`), em `messages/`: "Salvo às {hora}", "Salvando…", "O servidor
não recebe suas alterações desde {hora}. O rascunho fica neste navegador.",
"Duas versões desta resposta", explicação do conflito, "Manter o rascunho
deste navegador", "Usar a versão do servidor", "Escolha uma versão primeiro",
"O professor desativou a execução de código nesta prova. Você ainda pode
escrever e enviar sua resposta.", e o selo da barra.

### Seed

`src/db/bootstrap.ts`, cs101, questões `essay` `content: "code"`,
`highlight: "javascript"`:

| Exam | Tipo | `allowCodeRun` | Estado que alcança |
| :--- | :--- | :------------- | :----------------- |
| `practice-js` | PRACTICE | null | roda (padrão do tipo) |
| `quiz-js` | QUIZ | null | "O professor desativou…" |
| `test-js` | EXAM | true | roda numa prova valendo nota |

Todos `ONGOING`, para o aluno de demonstração abrir na hora. O conflito de
rascunho depende do `localStorage` e não tem seed: os testes o montam.

## Tarefas da E3a

| Tarefa | Depende de | Paralela com |
| :----- | :--------- | :----------- |
| E3a.1 Flag no servidor | — | E3a.3 |
| E3a.2 Snapshot e spec no CLI | E3a.1 | E3a.3, E3a.4 |
| E3a.3 Rascunho local e logout | — | E3a.1 |
| E3a.4 `CodeEssayAnswer` na prova | E3a.1, E3a.3 | E3a.2 |
| E3a.5 Seed e story | E3a.4 | — |

**E3a.1 Flag no servidor.**

- Implementação: `prisma/schema.prisma`, `src/core/schemas/exam.ts`,
  `src/db/services/exam.service.ts`, `src/services/code-run.ts`, snapshot do
  OpenAPI.
- Testes: `test/code-run.spec.ts` (Node), e casos novos em
  `test/api-exam.spec.ts`.
- Testes esperados: `effectiveCodeRun` e `canRunCode` nas 9 combinações de
  tipo × flag, com `source`; criar
  sem o campo dá `null`; criar e atualizar com `true`/`false`; atualizar com
  `null` volta a `null`; atualizar sem o campo não muda o valor; o campo
  aparece no GET e no OpenAPI.

**E3a.2 Snapshot e spec no CLI** (dentro de `cli/`, regras de
`cli/CLAUDE.md`).

- Implementação: `resources/openapi/codehood.json`,
  `codehood/api/generated.py` regerado, `dev/specs/to-do/push-exams.md`
  (mapeamento `meta.codeRun` → `allowCodeRun`; sem a chave, envia
  `allowCodeRun: null`).
- Testes: os existentes de `tests/test_api_generated.py` passam; um caso
  novo afirma `allow_code_run` em `ExamCreate`. `ruff`, `mypy`, `pytest`
  limpos.

**E3a.3 Rascunho local e logout.**

- Implementação: `src/components/exam/code-draft.ts`; `<script>` nos
  formulários de logout de `UserMenu.astro` e `profile.astro`.
- Testes: `test/code-draft.spec.ts` (Node, `Storage` falso) e um caso de
  navegador em `test/code-draft-logout.spec.ts`.
- Testes esperados: `draftKey` codifica as partes (usuário com `:`);
  `compareDraft` nos três casos, inclusive servidor vazio e rascunho vazio,
  e `newer` pelos dois relógios; rascunho vencido some na leitura e em
  `clearOthers`; `clearOthers` mantém os do usuário atual; `clearExam` só
  apaga o exam pedido;
  `draftStore` engole `QuotaExceededError` e storage que lança no acesso;
  `clearAll` apaga só as chaves do prefixo (o tema continua); logout pelo
  menu e "sair de todos os lugares" apagam os rascunhos; abrir uma página
  logado como outro usuário apaga os rascunhos do primeiro.

**E3a.4 `CodeEssayAnswer` na prova.**

- Implementação: `src/components/exam/CodeEssayAnswer.tsx`, desvio em
  `AnswerField` e estado `savedAt`/`failingSince` em `ExamAttempt.tsx`,
  props novas na página do exam, selo na barra, mensagens.
- Testes: `test/exam-code-answer.spec.ts`.
- Testes esperados: questão JS em PRACTICE mostra o editor e roda; em QUIZ
  com `null` o Rodar some e a mensagem do professor aparece, e a resposta
  ainda salva; editar dispara o autosave de sempre e o rodapé mostra "Salvo
  às"; com a action de resposta falhando (`page.route`) aparece o aviso com
  a hora e o rascunho fica no `localStorage`; rascunho diferente posto antes
  de abrir mostra o conflito, Rodar desligado, e cada escolha leva ao
  resultado certo no servidor; Rodar não chama a action de resposta; a
  resposta enviada é o código do editor; questão de código Prolog continua
  `<textarea>`; o DOM de enunciado e epílogo de `CodeEssayAnswer` é igual ao
  do `Essay` do mdq-js para a mesma questão (Markdown com link, código e
  HTML escapado); o diálogo de envio lista a questão em conflito; envio
  automático no fim do tempo com rascunho mais novo grava o rascunho; enviar
  apaga os rascunhos do exam; a página mostra "ligada (padrão de PRACTICE)"
  e "desligada (definida no exam)".

**E3a.5 Seed e story.**

- Implementação: seed da tabela acima; story nova em
  `docs/user-stories/student.md`, seção "Exams and practice": "Run my code
  answer before submitting" (`status: implemented`).
- Testes: `test/stories/student-exams.test.ts`, teste
  `student: run my code answer before submitting`, pela UI.

## Contratos da E3b

Escrito pelo `architect`. Drivers Prolog (primeiro) e Python. Sem stubs no
código: `src/runner/**` está em implementação; os nomes abaixo são o
contrato.

### Runtimes self-host

- Dependências com versão exata: `swipl-wasm` 8.3.0 e `pyodide` 314.0.7 (as
  da E1.6), sujeitas ao `minimumReleaseAge`.
- `src/runner/sandbox/runtimes.ts`, importável pelo sandbox e pelo build:

  ```ts
  /** A runtime package copied into the runner bundle. */
  export interface RuntimePackage {
  	/// npm package name and exact version, as in package.json.
  	pkg: string;
  	version: string;
  	/// Files copied from the package, relative to its root, and the path
  	/// each gets under `/runner/rt/<pkg>@<version>/`.
  	files: Record<string, string>;
  }
  export const RUNTIMES: { swipl: RuntimePackage; pyodide: RuntimePackage };
  /** Path of a runtime file under `/runner/rt/`, e.g. `pyodide@314.0.7/pyodide.mjs`. */
  export function runtimePath(runtime: RuntimePackage, file: string): string;
  ```

- `runnerBundle()` copia esses arquivos para `<bundle>/rt/`. Pyodide: só o
  núcleo (`pyodide.mjs`, `pyodide.asm.js`, `pyodide.asm.wasm`,
  `python_stdlib.zip`, `pyodide-lock.json`), nenhum pacote extra.
  swipl-wasm: o build `swipl-web` sem pthreads; `swipl-web.js` é script
  clássico e o build acrescenta `export default SWIPL` para o Worker de
  módulo importá-lo (como na E1.6).
- `readRunnerAsset` passa a servir `/runner/rt/<pkg>@<versão>/<arquivo>`
  (tipo `runtime`, `immutable`) só para arquivos listados em `RUNTIMES`;
  tipos `.mjs`, `.zip`, `.json`, `.data` entram nos content types.
- `languageId` ganha `prolog` e `python`; `runnerLanguage` ganha os aliases
  (`pl`, `prolog`, `swipl`; `py`, `python`, `python3`). Novo em
  `src/runner/languages.ts`:

  ```ts
  /** How Run starts `language`: `repl` for Prolog (consult + toplevel), `script` otherwise. */
  export function defaultRunMode(language: LanguageId): RunMode;
  ```

  `CodeRunner` usa `defaultRunMode` quando `runMode` não vem por prop.

### Driver Prolog (`src/runner/sandbox/drivers/prolog.ts`)

- `modes: ["repl"]`. `load`: importa `swipl-web.js` de
  `runtimeUrl(...)` e cria a instância com `stdin` ligado a `readLine` (um
  caractere por vez a partir da linha, `null` = EOF), `print`/`printErr`
  ligados a `stdout`/`stderr`.
- `run`: grava `files` em `/work/` no FS em memória do Emscripten, faz
  `consult` da entrada e abre o toplevel no terminal. Erros e avisos do
  `consult` saem com o caminho reescrito de `/work/main.pl:3:` para
  `main.pl:3:`. `halt.` ou EOF encerram com código 0 (ou o de `halt(N)`).
- `CodeRunner` com `language: "prolog"` mostra ao lado do Rodar "Rodar
  reinicia o Prolog" (U3).

### Driver Python (`src/runner/sandbox/drivers/python.ts`)

- `modes: ["script", "repl"]`. `load`: `loadPyodide({ indexURL })` com a URL
  de `RUNTIMES.pyodide`, sem `loadPackage`; `stdin` por `setStdin` com
  callback síncrono sobre `readLine`; `stdout`/`stderr` por `setStdout` e
  `setStderr` em modo `write`.
- `run` em `script`: grava `files` em `/work/`, roda a entrada como
  `__main__` com nome de arquivo `main.py` no traceback; exceção não tratada
  imprime o traceback e dá código 1; `SystemExit(n)` dá `n`. `import` de
  pacote fora da biblioteca padrão falha com `ModuleNotFoundError`, sem
  tentar baixar.
- `run` em `repl`: roda a entrada e abre `code.interact()` (como
  `python -i`), lendo por `input()`.
- Reserva pré-aquecida (P1): nada novo; `Driver.load` é o que a reserva
  executa. Com a reserva pronta, Python vai direto a `running`.

### Plano B (snapshot do Pyodide)

Se, com reserva, o tempo de Rodar até `running` no Python passar de 3 s
com CPU 4x em algum caso que a reserva não cobre (primeiro Rodar logo depois
de abrir a página, recarga em `review`), medir `makeMemorySnapshot` +
`loadPyodide({ _loadSnapshot })` gerado no build. É API experimental do
Pyodide; a decisão de adotar volta ao comitê com os números.

## Tarefas da E3b

| Tarefa | Depende de | Paralela com |
| :----- | :--------- | :----------- |
| E3b.1 Runtimes self-host | — (depois da issue de bundle) | — |
| E3b.2 Driver Prolog | E3b.1 | E3b.4 |
| E3b.3 Driver Python | E3b.2 (mesmos arquivos de registro) | E3b.4 |
| E3b.4 Seed e stories | E3b.2 para Prolog, E3b.3 para Python | — |
| E3b.5 Medição com reserva e plano B | E3b.3 | — |

**E3b.1 Runtimes self-host.** `package.json`, `runtimes.ts`, cópia em
`integration.ts`, rota `rt/` em `assets.ts`. Testes em
`test/runner-endpoint.spec.ts`: arquivo listado responde `immutable` com
content type certo; arquivo não listado, outra versão e `..` dão 404;
versões de `RUNTIMES` iguais às do `package.json` instalado;
`swipl-web.js` servido termina com `export default SWIPL`.

Testes de runtime real: na suíte padrão, dois por runtime
(`test/runner-smoke.spec.ts`): carregar e ler uma linha de entrada; erro com
número de linha. Os demais casos de E3b.2 e E3b.3 ficam em
`test/runtimes/*.spec.ts`, fora da suíte padrão, rodados por
`pnpm exec tsx test/run.ts test/runtimes` antes de cada commit dessas
tarefas.

**E3b.2 Driver Prolog.** `protocol.ts` (`prolog`), `drivers/index.ts`,
`drivers/prolog.ts`, `languages.ts` (aliases, `defaultRunMode`), aviso no
`CodeRunner`. Testes em `test/runtimes/prolog.spec.ts`, pelo harness da E1.3:
consult + consulta `factorial(5, F).` dá `F = 120`; erro de sintaxe na linha
3 aparece como `main.pl:3`; `read/1` lê do terminal; `halt.` e EOF encerram;
Parar no meio de recursão infinita; `FS.mount(IDBFS, ...)` a partir do
programa falha; o essay `prolog-factorial-with-is` do seed passa a abrir no
editor.

**E3b.3 Driver Python.** `protocol.ts` (`python`), `drivers/index.ts`,
`drivers/python.ts`, `languages.ts`. Testes em `test/runtimes/python.spec.ts`:
`print`/`input()`; traceback com `main.py` e código 1; `sys.exit(3)`;
`import numpy` falha sem requisição de rede fora de `/runner/rt/`; modo
`repl` com EOF; com `prepare`, o run vai direto a `running`; montar IDBFS
pelo `pyodide.FS` a partir do programa falha.

**E3b.4 Seed e stories.** Os `CODE` Python do seed passam a rodar; um
`CODE` Prolog novo em cs101; a story "Run a code example" ganha um passo em
Python. Sem mudança nas tabelas de seed da E2 e da E3a.

**E3b.5 Medição com reserva e plano B.** Como a E1.6, agora com o bundle
real: tempo de Rodar até `running` com reserva pronta, com reserva ainda
carregando e sem reserva, desktop e CPU 4x. Se algum caso de Python passar
de 3 s, medir o snapshot (plano B) e levar os números ao comitê.

## Contratos da E4

Escrito pelo `architect`. Modo `review` (J3): o professor roda a resposta de
código do aluno na tela de correção. Stub: `src/components/runner/review-host.ts`.

### Onde entra

- A correção é por questão: `src/pages/[discipline]/[course]/exams/[slug]/grading/[question].astro`
  lista todas as respostas da questão, um card por resposta, anônimo
  ("Resposta N") salvo com "Mostrar nomes" (spec `web-grading`, R4 e R5).
  O protótipo (`modes.astro`) mostra uma submissão por vez com ‹ ›; a E4
  mantém a lista e põe a navegação no próprio widget (ver votação).
- Hoje a resposta de essay vira `<p class="whitespace-pre-wrap">` no
  servidor (`Answer.astro` + `displayAnswer`), sem olhar `content` nem
  `highlight`. A E4 muda `Answer.astro`: essay com `content: "code"` mostra
  o código com Shiki (`light-plus`/`dark-plus`) e, se
  `runnerLanguage(highlight)` não for null e `RUNNER_ORIGIN` existir, um
  `CodeRunner` em `mode="review"`. Vale para a página da questão e para a
  tentativa inteira de um aluno (`attempts/[username].astro`), que usam o
  mesmo `Answer.astro`.
- Montagem com `client:visible` (a página pode listar 150 respostas). Antes
  de rodar ou editar, o widget é o `highlightedHtml` do servidor; CodeMirror e
  xterm só carregam no uso (contrato da E2).

### Sandbox por submissão

- `runForSubmission(runnerOrigin, submission, request, handlers)`: um
  `RunnerHost.exclusive` por página, criado no primeiro uso; um run por vez na
  página inteira (o run novo para o anterior, de qualquer card); `reload()`
  do frame sempre que a submissão muda. `submission` é o id público da
  resposta (o mesmo do `id="answer-..."` do card).
- `CodeRunner` ganha a prop `submission?: string`. Com `mode="review"`, ele
  roda por `runForSubmission` em vez de `RunnerHost.shared`. `prepare` em
  `review` é chamado depois de cada `reload()`, não no foco.
- Nada é compartilhado com widgets `shared` da mesma página (não há, mas o
  host exclusivo é outro iframe).

### Cópia do professor (U2)

- O código da submissão é só leitura. "Editar cópia" torna o editor
  editável; a cópia vive só na memória do widget: sem `onChange`, sem
  rascunho, sem `localStorage`, sem requisição nenhuma.
- Com a cópia diferente do original: selo "modificado", dica "Uma cópia na
  memória; a submissão não muda." e botão "Voltar à submissão", que descarta a
  cópia. O botão Rodar continua "Rodar submissão".
- Saída de um run da cópia: o terminal escreve antes uma linha de aviso
  "saída da cópia modificada" (pelo `notice` do `RunnerTerminal`), e o
  status mostra o selo. Saída do original não tem marca.
- Trocar de card ou recarregar a página perde a cópia, por desenho.

### Navegação

- Barra do widget (`toolbar`): ‹ › levam ao card anterior/seguinte com
  resposta de código na página (âncora `#answer-<id>`, foco no botão Rodar
  do destino), "N de M" e o rótulo do card ("Resposta N", ou o nome com
  "Mostrar nomes"). Dica fixa: "Sandbox novo a cada submissão. Rodar nunca
  mexe na nota."
- Ir para outro card não roda nada; o primeiro Rodar lá recarrega o frame.

### O que nunca acontece

O widget não importa nem chama `actions.grading.*`, `actions.regrade.*`
nem `actions.gradeColumn.*`, e não toca no `GradeForm`. Nota e comentário só
mudam pelos formulários de sempre, com ação explícita do professor. A saída
do terminal não é copiada para o comentário.

## Tarefas da E4

| Tarefa | Depende de | Paralela com |
| :----- | :--------- | :----------- |
| E4.1 `runForSubmission` e modo `review` no `CodeRunner` | — | E4.2 |
| E4.2 Código na tela de correção | — | E4.1 |
| E4.3 Navegação, seed e story | E4.1, E4.2 | — |

**E4.1 `runForSubmission` e modo `review`.**

- Implementação: `src/components/runner/review-host.ts`; em
  `CodeRunner.tsx`, prop `submission`, "Editar cópia", selo, "Voltar à
  submissão", aviso na saída da cópia; mensagens.
- Testes: `test/runner-review.spec.ts`, numa seção nova da página
  `src/pages/design/runner.astro` com três widgets `review` de submissões
  diferentes.
- Testes esperados: primeiro Rodar cria um iframe `exclusive`; rodar outra
  submissão troca o iframe (elemento novo) e para o run anterior; rodar a
  mesma de novo não troca o iframe; dois runs nunca simultâneos; global
  definido pelo código de uma submissão (`globalThis.x = 1`) não existe no
  run da seguinte; editar a cópia mostra o selo e "Voltar à submissão"
  devolve o original; a saída da cópia tem o aviso; editar e rodar a cópia
  não gera requisição à origem da app (`page.on("request")`) nem escreve no
  `localStorage`.

**E4.2 Código na tela de correção.**

- Implementação: `src/components/grading/Answer.astro` e
  `src/components/grading/answer-text.ts` (tipo novo `code` com língua),
  `client:visible`.
- Testes: `test/grading-code-answer.spec.ts`.
- Testes esperados: essay de código aparece realçado na página da questão e
  na tentativa do aluno; com língua sem driver, realçado sem Rodar; essay de
  texto continua como hoje; a página da questão com muitas respostas não
  cria iframe nem baixa CodeMirror antes de um clique; rodar e editar não
  mudam nota nem comentário (contagem de passes igual antes e depois).

**E4.3 Navegação, seed e story.**

- Implementação: barra ‹ › e "N de M" no `toolbar` do widget; seed com o
  exam de código JavaScript da E3a respondido por quatro alunos (uma
  resposta certa, uma com exceção, uma com laço infinito, uma que lê
  entrada); story nova em `docs/user-stories/instructor.md`: "Run a
  student's code while grading" (`status: implemented`).
- Testes: navegação (‹ › movem foco e âncora, anônimo sem "Mostrar nomes",
  com nome quando ligado); story
  `instructor: run a student's code while grading` em
  `test/stories/instructor-grading.test.ts`, pela UI, inclusive Parar no
  laço infinito.

## Contratos da E5

Escrito pelo `architect`. Drivers Lua e TypeScript. Sem stubs no código
(`src/runner/**` tem implementers ativos); os nomes abaixo são o contrato.

### Lua: wasmoon

Escolha: `wasmoon` 1.16.0, não `fengari`.

| | wasmoon 1.16.0 | fengari 0.1.5 |
| :- | :- | :- |
| Lua | 5.4, a implementação de referência compilada para WASM | 5.3 reescrito em JS |
| Tamanho | ~460 KB no pacote (glue + wasm) | ~1,6 MB no pacote |
| Velocidade | nativa do WASM | interpretador em JS, várias vezes mais lento |
| Manutenção | 1.16.0 de 12/2023; 2.0 em pré-lançamento | sem release desde 2019 (0.1.4) |
| Dependências | só tipos | várias |

A 1.16.0 é madura para o `minimumReleaseAge` e não usa a 2.0-next.
`fengari` daria Lua 5.3, que diverge do que o aluno instala hoje.

- `RUNTIMES.wasmoon` (em `src/runner/sandbox/runtimes.ts`): o glue e o
  `.wasm` do pacote, servidos em `/runner/rt/wasmoon@1.16.0/`.
- `drivers/lua.ts`, `modes: ["script", "repl"]`. `load`: `LuaFactory` com a
  URL do `.wasm` de `runtimeUrl`, cria o motor uma vez. `run`: grava `files`
  no FS em memória (`/work/`), troca `print`, `io.write` e `io.stderr:write`
  por funções que chamam `stdout`/`stderr`, e `io.read` (formatos `"l"`,
  `"L"`, `"n"`, `"a"`) por leitura síncrona sobre `readLine`. Script: roda a
  entrada com `doFileSync`, nome `main.lua` nas mensagens de erro, código 1
  em erro não tratado, `os.exit(n)` dá `n`. REPL: lê linha, tenta
  `return <linha>` e depois a linha, imprime o resultado.
- Bibliotecas: a padrão do Lua. Sem `require` de módulos fora de `files`.
- `languageId` ganha `lua`; aliases `lua`.

### TypeScript: transpilar e entregar ao driver JS

- `drivers/typescript.ts`, `modes: ["script"]` (como na tabela do
  "Decidido"). `run`: transpila a entrada e entrega o resultado ao
  `javascriptDriver.run` com os mesmos `files`, `entry` e contexto, para o
  aluno ter exatamente o JavaScript da E1 (console, `prompt`, stack
  limpo). Tipos não são verificados: só removidos.
- Transpilador: o "Decidido" diz `esbuild-wasm`. Duas coisas pesam e vão
  para votação:
  - `esbuild-wasm` 0.28.2 (mesma versão do `esbuild` que a app já usa) tem
    ~14,5 MB no pacote, com o `.wasm` de ~11 MB baixado no primeiro Rodar.
    Ele reimprime o código, então as linhas do stack não batem com o `.ts`
    sem source map; o `cleanStack` da E1 teria de aplicar o mapa.
  - `sucrase` 3.35.1 tem ~1 MB no pacote, é JS puro (sem `.wasm`) e
    preserva as linhas do arquivo por desenho: o stack aponta a linha certa
    do `.ts` sem source map.
- Se `esbuild-wasm`: `load` chama `esbuild.initialize({ wasmURL, worker:
  false })`. `worker: false` é obrigatório: o padrão cria um Worker
  aninhado, que `lockDownWorkerScope` remove.
- `languageId` ganha `typescript`; aliases `ts`, `typescript`, `mts`.
- CodeMirror: `@codemirror/lang-javascript` com `typescript: true`;
  `@codemirror/legacy-modes` (modo `lua`) para Lua, versão exata.

## Tarefas da E5

| Tarefa | Depende de | Paralela com |
| :----- | :--------- | :----------- |
| E5.1 Driver Lua | — | E5.2 |
| E5.2 Driver TypeScript | voto do transpilador | E5.1 |
| E5.3 Seed, smoke e editor | E5.1, E5.2 | — |

Os dois mexem em `protocol.ts`, `drivers/index.ts`, `runtimes.ts` e
`languages.ts`; quem chegar depois rebaseia. Testes de runtime real seguem a
regra da E3b: dois por runtime na suíte padrão, o resto em `test/runtimes/`.

**E5.1 Driver Lua.** `package.json` (`wasmoon` 1.16.0 exato),
`runtimes.ts`, `drivers/lua.ts`, `drivers/index.ts`, `protocol.ts`,
`languages.ts`. Testes em `test/runtimes/lua.spec.ts`: `print` e
`io.write`; `io.read("l")` e `io.read("n")` do terminal; erro com
`main.lua:3:`; `os.exit(2)`; REPL com expressão e EOF; Parar em
`while true do end`; `FS.mount` de IDBFS falha; com `prepare`, vai direto a
`running`.

**E5.2 Driver TypeScript.** Dependência escolhida, com versão exata;
`drivers/typescript.ts`, `drivers/index.ts`, `protocol.ts`,
`languages.ts`; uma exportação em `drivers/javascript.ts` se o driver TS
precisar. Testes em `test/runtimes/typescript.spec.ts`: anotações, `enum` e
`interface` rodam; erro de tipo não impede a execução; exceção na linha 7
do `.ts` aparece como `main.ts:7`; `prompt()`; `import` de outro arquivo
falha com mensagem clara; com `prepare`, vai direto a `running`.

**E5.3 Seed, smoke e editor.** `CODE` Lua e TypeScript em cs101; uma
questão `essay` de código em TypeScript no `practice-js`;
`test/runner-smoke.spec.ts` ganha os dois casos por runtime; modos do
CodeMirror. Testes: os de smoke; o resource Lua abre no editor com realce.

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
