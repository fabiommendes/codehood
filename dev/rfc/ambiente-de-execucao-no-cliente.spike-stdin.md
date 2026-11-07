# Spike: stdin bloqueante no Worker do iframe de sandbox

Protótipo descartável para a pergunta "stdin bloqueante" da seção "Em aberto"
de `ambiente-de-execucao-no-cliente.md`. Código fora do repositório (servidor
Node estático com cabeçalhos por parâmetro, páginas de teste e script
Playwright via CDP); só este relatório fica.

## Montagem

- Chromium 156.0.8078.79 headless, dirigido por `playwright-core` via CDP.
- A (Codehood): `http://localhost:8801`, página que embute o iframe de B, uma
  imagem e um iframe de um terceiro (`localhost:8803`, sem CORP nem COEP),
  que simulam embeds de conteúdo de curso.
- B (sandbox): `http://localhost:8802` (mesmo site que A, como um subdomínio
  de `codehood.*`) e `http://127.0.0.1:8802` (outro site, como um domínio de
  sandbox separado). O iframe de B cria um Worker dedicado.
- Cada cenário roda num contexto novo. Os testes de service worker e IndexedDB
  foram repetidos com cookies de terceiros bloqueados (perfil com
  `cookie_controls_mode=1` e `--test-third-party-cookie-phaseout`; confirmado
  por `document.hasStorageAccess() === false` no iframe de outro site).

## Resultados

| Abordagem | Funciona | Cabeçalhos em A | Cabeçalhos em B | Custo / limitações | Evidência |
| :-- | :-- | :-- | :-- | :-- | :-- |
| SAB + `Atomics.wait`, isolamento clássico | Sim | COOP `same-origin` + COEP `require-corp` ou `credentialless` | COEP + `CORP: cross-origin`; iframe com `allow="cross-origin-isolated"` | A passa a bloquear todo iframe de terceiro sem COEP (nos dois modos de COEP). Com `require-corp` também bloqueia imagens e scripts sem CORP; `credentialless` deixa passar. COOP quebra popups/opener (OAuth em popup) | Worker leu `hello-sab` após 300 ms de espera; `crossOriginIsolated` true em A, iframe e Worker |
| SAB sem nada em A | Não | nenhum | COOP+COEP+CORP | Iframe fica com `crossOriginIsolated=false`, com ou sem `allow` | `SharedArrayBuffer` indefinido no iframe |
| SAB com `Document-Isolation-Policy` em B | Sim (Chromium) | nenhum | `Document-Isolation-Policy: isolate-and-require-corp` (ou `isolate-and-credentialless`) em todas as respostas de B | Nada muda em A: imagem e iframe de terceiro carregam. Suporte fora do Chromium não verificado neste spike | `crossOriginIsolated` true no iframe e no Worker, A sem cabeçalhos, B no mesmo site e em outro site, com cookies de terceiros bloqueados também |
| Service worker em B + XHR síncrono (futurecoder / `sync-message`) | Sim | nenhum | nenhum | Precisa de SW registrado e controlando o iframe antes de criar o Worker (`skipWaiting` + `clients.claim()`). O SW guarda o estado da leitura pendente em memória; uma leitura longa depende do SW não ser encerrado. Custo de ~4 ms por linha | Worker bloqueou 503 ms em `XMLHttpRequest` síncrono e recebeu `hello-sw`; funcionou com B no mesmo site, em outro site e com cookies de terceiros bloqueados (SW particionado) |
| Pyodide + JSPI (`run_sync`) | Sim | nenhum | nenhum | Código do aluno tem de entrar por `runPythonAsync` (ou `callPromising`); `runPython` síncrono falha com `Cannot stack switch because the Python entrypoint was a synchronous function`. `input()` é substituído em Python por `run_sync(js.getLine())`. Só serve para Pyodide (outros runtimes WASM precisariam de JSPI próprio). Suporte a JSPI fora do Chromium não verificado | Pyodide 314.0.7 (CDN jsdelivr, carga 6,8 s) num Worker de módulo, B de outro site, sem SAB: dois `input()` seguidos dentro de uma função devolveram `ola Ana 14`, `can_run_sync()` True |
| Pyodide `setStdin` com `stdin()` que devolve Promise | Não | | | | `OSError` dentro de `input()`, mesmo via `runPythonAsync` |

Perguntas laterais:

- `worker.terminate()` mata `while (true) {}`: sim. Nenhuma mensagem do Worker
  depois do `terminate()` em 1,5 s, a thread do iframe sem atraso, e um Worker
  novo responde em seguida.
- IndexedDB no iframe B: funciona no documento e no Worker, nos três cenários
  (mesmo site, outro site, cookies de terceiros bloqueados). Em outro site o
  armazenamento é particionado pelo site de A; como B só é embutido pelo
  Codehood, isso não atrapalha.
- Pyodide 314 só roda em Worker de módulo (`new Worker(url, {type: 'module'})`;
  em Worker clássico: `Classic web workers are not supported`).
- `importScripts()` de um script do jsdelivr falhou com `NetworkError` no
  Worker clássico, enquanto `fetch()` da mesma URL funcionava. Não investiguei;
  com Worker de módulo o problema não aparece.

## Não verificado

- Firefox e Safari: nenhum teste. `Document-Isolation-Policy` e JSPI podem não
  existir neles; o SW + XHR síncrono é o caminho que o futurecoder usa em
  produção nos três navegadores, mas isso não foi observado aqui.
- Atributo `credentialless` em iframes de terceiros de A, que contornaria o
  bloqueio do COEP clássico.
- Domínio real com HTTPS. Os testes usaram loopback, que conta como contexto
  seguro.

## Recomendação

Usar SharedArrayBuffer + `Atomics.wait` como o mecanismo do driver, com
`Document-Isolation-Policy: isolate-and-credentialless` em todas as respostas
de B e nenhum cabeçalho novo em A. É o único caminho que serve a qualquer
runtime WASM, não exige SW e não impõe nada às páginas do Codehood.

Como fallback para navegadores sem `crossOriginIsolated` no iframe, o driver
usa o service worker + XHR síncrono em B. O contrato do driver fica o mesmo:
o Worker pede uma linha e bloqueia; só o transporte muda. Detectar por
`crossOriginIsolated` no iframe.

JSPI no Pyodide fica como otimização opcional só para Python, não como base:
amarra a forma de chamar o código do aluno (`runPythonAsync`) e não cobre os
outros runtimes.

Descartado: COOP/COEP em A. O custo (bloquear iframes de terceiros em todo o
Codehood, quebrar popups) não se justifica quando `Document-Isolation-Policy`
ou o SW resolvem sem tocar em A.

Antes da spec: repetir os cenários de SW e `Document-Isolation-Policy` em
Firefox e Safari, porque o fallback só é necessário se algum deles falhar.
