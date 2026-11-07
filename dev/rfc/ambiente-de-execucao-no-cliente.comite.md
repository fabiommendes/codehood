# Comitê de desenho: ambiente de execução no cliente

Ata do comitê que desenha a feature do RFC
`dev/rfc/ambiente-de-execucao-no-cliente.md`.

## Regras

- Membros (5, votam): presidente (Claude, sessão principal), `architect`,
  `breaker`, `security-reviewer`, `user`.
- Não votam: `ui-designer` (protótipos `.astro` de alta fidelidade),
  `ui-reviewer` (revisa UI), `implementer`s e subagentes efêmeros.
- O presidente escreve o RFC e abre issues; não escreve código nem testes.
- Só o `architect` escreve stubs, schema e trechos de código no RFC.
- Código e testes: `implementer`s delegados pelo comitê.
- Issues e decisões passam por votação. Unanimidade fecha. Sem unanimidade:
  rodada de discussão, exposição começando pelas opções menos votadas, nova
  votação. Depois de 2 rodadas sem unanimidade vale a maioria; o voto vencido
  fica registrado aqui.
- Trabalho no worktree `.claude/worktrees/client-runner`, branch
  `feat/client-runner`. Commit a cada funcionalidade. Sem push, sem merge.
- `dev.db` é descartável; mudança de schema é permitida (é uma branch).

## Contexto já decidido com o humano

Ver seção "Decidido" do RFC. Resumo: tudo roda no cliente; sem runner no
servidor; compilação remota é leva futura; CodeMirror 6 + xterm.js; primeira
leva JS, TS, Lua, Python, Prolog (SWI-Prolog).

Vetores de integração levantados (J1..J7):

- J1. Resposta de `essay` com `content: "code"` (já tem `highlight` com a
  linguagem): o IDE substitui o campo de resposta; aluno testa antes de enviar.
- J2. Snippets executáveis: resources `CODE` e blocos de código em notas `MD`.
- J3. Professor executa a submissão do aluno na tela de correção.
- J4. `template/` e testes públicos do grader do chalk viram código inicial e
  feedback no cliente (exige mudança no formato mdq e no CLI).
- J5. Practice sessions com feedback instantâneo via testes públicos.
- J6. Repository inteiro aberto no IDE (multiarquivo). Depois.
- J7. Scratchpad livre por curso.

Requisitos de interface derivados: várias instâncias por página; runtime
carregado no primeiro "Rodar" e compartilhado; modos `answer`, `snippet`,
`review`; contrato de driver aceita mapa de arquivos desde já.

## Pauta

1. Escopo da primeira leva: (a) J1+J2+J3; (b) (a)+J4+J5.
2. Execução em prova valendo nota: (a) flag por exam, desligada por padrão;
   (b) sempre permitido.
3. Ordem das entregas e o que conta como "entrega" (commit funcional).

## Votações

(registradas pelo presidente; a persona `user` atua com o nome `usuario`)

### Rodada 1: pauta 1 a 3

- presidente: 1(a), 2(a). 3: E1 núcleo (contrato de driver, sandbox em
  origem separada, driver JS, componente em modo `snippet`); E2 resposta de
  questão (J1); E3 correção (J3); E4+ uma linguagem por entrega.
- architect: 1(a), 2(a). 3: sandbox+protocolo+driver JS no playground;
  IDE em `snippet` (J2); drivers TS, Lua, Python, Prolog; J1; J3.
- breaker: 1(a), 2(a). 3: spike isolamento+stdin; J2; J1; J3.
- security-reviewer: 1(a), 2(a). 3: sandbox+contrato+JS+testes de
  isolamento sem UI; J1; J2; Python, Lua, Prolog, TS; J3 por último.
- usuario: 1(a) com ponto de encaixe para código inicial; 2(a) com default
  por tipo de exam; 3: JS em `snippet`; J1 com Python e Prolog; J3; Lua, TS.

Resultado: **1(a) e 2(a) unânimes.** Item 3 sem unanimidade; vai para a
rodada 2 numa forma consolidada, junto com os pontos novos levantados.

Pontos novos: estado compartilhado entre instâncias (breaker B1), perda de
rascunho (breaker B2, usuario), origem do runner é o mesmo site para
`SameSite` e permite cookie tossing (security T1), envenenamento persistente
da origem do runner em J3 (T2), canal `postMessage` (T3), hospedagem dos
runtimes e testes sem download (architect).

### Rodada 2: pauta 4 a 9

Proposta do presidente para cada item; votar `sim`, `não` ou alternativa.

4. **Ordem consolidada** (substitui o item 3). Exposição pelas posições
   menos votadas: (i) security quer J3 por último e Python antes de J2;
   (ii) breaker quer o spike como entrega 0; (iii) architect quer todos os
   drivers antes de J1; (iv) usuario quer Python+Prolog junto com J1.
   Proposta: E0 spike stdin+isolamento (descartável, não é entrega);
   E1 origem do runner + protocolo + driver JS + driver falso de testes +
   testes de isolamento, numa página do playground; E2 IDE (CodeMirror +
   xterm) em modo `snippet` ligado a resources `CODE` (J2); E3 modo `answer`
   (J1) com flag no exam, mais drivers Python e Prolog; E4 modo `review`
   (J3); E5 drivers Lua e TS. Entrega = commit com lint e testes verdes,
   seed no `bootstrap.ts`, usável no dev server.
5. **Default da flag de execução por tipo de exam**: ligada em PRACTICE e
   QUIZ, desligada em EXAM; o professor pode mudar. Aluno vê o motivo quando
   o botão Rodar está indisponível.
6. **Origem do runner**: configurável por variável (`RUNNER_ORIGIN`). Em
   produção, recomendação documentada de domínio registrável separado (R1);
   subdomínio só com cookie `__Host-session`. Renomear o cookie para
   `__Host-session` em qualquer caso (derruba as sessões abertas uma vez).
   Em dev e testes, outra porta em `127.0.0.1` (site diferente de
   `localhost`). Preview em iframe `sandbox` sem `allow-same-origin` (R2).
   `postMessage` só de dados, origem conferida dos dois lados (R4). CSP com
   `frame-ancestors` nos dois lados (R5).
7. **Instâncias e estado**: download e instância do runtime compartilhados
   por página; namespace novo a cada execução; em `review`, Worker novo por
   submissão (R3). Limite de saída e botão Parar em todos os modos.
8. **Rascunho**: salvo localmente (na origem da app) a cada edição e antes
   de cada Rodar; no servidor, reaproveitar o autosave que já existe no
   fluxo de exam, sem mecanismo novo. Rodar nunca grava submissão.
9. **Runtimes e testes**: self-host dos runtimes a partir de pacotes npm,
   servidos pela origem do runner, com hash conferido (SRI); sem CDN. Suíte
   padrão usa o driver falso; teste de fumaça por linguagem fora da suíte
   padrão.

Pendente do spike: mecanismo de stdin e cabeçalhos COOP/COEP da app.

Votos da rodada 2:

| Item | presidente | architect | breaker | security | usuario |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 4 | sim | sim | sim (dividir E3) | sim (provas de isolamento na E1) | sim (Prolog antes de Python) |
| 5 | sim | sim (`Boolean?`, null = default do tipo) | **não**: QUIZ vale nota | sim | sim |
| 6 | sim | sim; cookie por ambiente | sim; `Secure` em dev | sim; `Secure` sempre; app em `localhost` | sim |
| 7 | sim | sim | **não**: Worker único trava e Parar mata tudo | sim; nada compartilhado em `review` | sim; Parar em segundos |
| 8 | sim | sim | sim; chave por usuário, conflito | sim; chave por usuário, logout limpa | sim; aluno escolhe no conflito |
| 9 | sim | **alternativa**: sem SRI, lockfile | sim; hash por manifesto; pacotes Pyodide | sim; hash em toda carga | sim |

Aprovados: 4 (com emendas a confirmar), 8 (com as adições). Para a rodada 3:
5, detalhe do cookie em 6, 7 e 9.

### Rodada 3

Exposição pelas posições menos votadas.

- **5.** breaker (1 voto): QUIZ vale nota; o item 2(a) manda desligar em
  prova valendo nota; ligada só em PRACTICE. O presidente muda o voto para
  essa posição. Proposta 5': `Exam.allowCodeRun Boolean?`, `null` = padrão
  do tipo; padrão ligado só em PRACTICE. Mensagem ao aluno: "O professor
  desativou a execução de código nesta prova."
- **6, cookie.** architect: nome por ambiente (`__Host-session` em produção,
  `session` em dev/teste), porque o WebKit do Playwright não trata
  `http://localhost` como seguro. security: `Secure` sempre. Argumento do
  presidente: em dev e teste a app roda em `localhost` e o runner em
  `127.0.0.1`, que são sites diferentes; não há cookie tossing possível
  entre eles, então o prefixo só importa em produção. Proposta 6': nome por
  ambiente (architect) + asserção nos testes de que a app roda em
  `localhost` e o cookie não chega ao runner (security).
- **7.** breaker (1 voto): Worker por execução, só o download compartilhado.
  O presidente muda o voto para essa posição. Proposta 7': cada execução é um
  Worker novo; o compartilhado entre instâncias é só o cache HTTP dos
  arquivos do runtime; Parar = `terminate()` daquele Worker. Custo:
  reinicializar o runtime a cada Rodar (aceitável; medir no E1).
- **9.** architect (1 alternativa): sem SRI. Ponto do presidente: T2 é
  justamente código do aluno na mesma origem envenenando o cache, então
  "mesma origem" não protege; mas Workers não registram service worker e o
  cache HTTP não aceita conteúdo forjado para uma URL. Proposta 9': runtimes
  self-host em URLs versionadas com `Cache-Control: immutable`; o código do
  runner nunca guarda runtime em Cache Storage nem IndexedDB (só cache HTTP);
  a origem do runner manda `Clear-Site-Data: "storage"` ao carregar a página
  do runner em `review`; manifesto de hash fica como reforço opcional, não
  obrigatório. Pacotes extras do Pyodide (numpy etc.) ficam fora da leva 1.
- **Emendas ao 4:** E3 dividida em E3a (J1 + flag + driver JS) e E3b
  (drivers Prolog e depois Python).

Votos da rodada 3: **5', 6', 7', 9' e emendas ao 4 aprovados por
unanimidade.** Condições registradas:

- 7': meta de reinício medida na E1 (< 3 s com cache quente, inclusive
  celular); acima disso o item reabre.
- 9' (security): código do aluno só em Worker ou iframe opaco, nunca na
  página do runner; teste na E1 de que IndexedDB/Cache Storage gravados por
  uma execução não são lidos na seguinte.
- 9' (breaker, emendas para a rodada 4): em `review`, recarregar o iframe do
  runner a cada submissão; teste de que nenhum driver monta FS persistente
  (IDBFS/OPFS); CSP do runner com `connect-src 'self'`.

### Rodada 4: stdin e emendas de segurança

Relatório do spike: `dev/rfc/ambiente-de-execucao-no-cliente.spike-stdin.md`
(só Chromium 156 testado).

10. **Canal de stdin com duas implementações, escolhida em tempo de
    execução.** Se o iframe do runner estiver `crossOriginIsolated`
    (obtido com `Document-Isolation-Policy` só na origem do runner, sem nada
    na app), `SharedArrayBuffer` + `Atomics.wait`. Senão, service worker do
    runner interceptando XHR síncrono do Worker (modelo do futurecoder).
    A app não manda COOP/COEP. Todos os drivers (inclusive JS e Pyodide)
    usam o mesmo canal síncrono; JSPI não é usado.
11. **Emendas do breaker ao 9'**: em `review`, recarregar o iframe do
    runner a cada submissão; teste na E1 de que nenhum driver monta FS
    persistente; CSP do runner com `connect-src 'self'` (compatível com o
    XHR do fallback, que é same-origin).
12. **Troca do `Clear-Site-Data`**: o cabeçalho `"storage"` também remove o
    service worker do fallback. Proposta: em vez dele, a página do runner,
    ao carregar, apaga via JS todos os bancos IndexedDB e caches da origem;
    o service worker (código do runner, não do aluno) fica.
13. **Navegadores**: E1 testada em Chromium; abrir issue para validar
    Firefox e Safari (o fallback de service worker é o caminho esperado
    neles) antes de a E3a sair.

Votos da rodada 4: **10 a 13 aprovados por unanimidade**, com condições:

- 10 (architect): o driver vê só `readLine(): string | null`; transporte
  escolhido fora do driver; canal com `runId`, leitura pendente cancelada em
  Parar ou em novo Worker; SW intercepta só a rota de stdin.
- 10 (breaker, security): fallback por polling curto (~1 s) com XHR
  repetido, nunca um XHR preso; ids de canal com `crypto.randomUUID()`
  amarrados ao `FetchEvent.clientId` do Worker dono; SW não usa Cache
  Storage; teste de que Worker não registra nem atualiza SW.
- 12: SW com escopo e script fixos e versionados; limpeza de storage em
  paralelo, com prazo, sem bloquear a carga.
- 13: issue cobre stdin e testes de isolamento em Firefox e Safari,
  inclusive janela privada; bloqueia a E3a. Sem caminho disponível, o botão
  Rodar avisa "navegador não suportado". Conferir se o Chromium do
  Playwright suporta `Document-Isolation-Policy`; se não, a E1 testa pelo
  fallback.

### Rodada 5: pontos do architect ao escrever os contratos

Stubs em `src/runner/`; seções "Contratos" e "Tarefas da E1" no RFC.
Chromium do Playwright 1.62.1 (151) suporta `Document-Isolation-Policy`.

- D1. Limpar IndexedDB, Cache Storage e OPFS também antes de cada execução
  (não só ao carregar o runner). Presidente: sim.
- D2. Produção sem `RUNNER_ORIGIN` desliga a execução (botão Rodar avisa)
  em vez de falhar no boot. Presidente: sim.
- D3. Quem define `Exam.allowCodeRun` na E3a: repositório via CLI (ADRs
  0011/0012) ou UI web. Presidente: seguir a mesma via dos demais campos de
  configuração do exam hoje, sem criar caminho novo.

Observação do presidente: os 57 erros de `tsc` vistos no worktree eram
ambientais (faltava `scripts/brand-generated-types.ts` depois do
`prisma generate`); corrigido, `tsc` zera.

Votos da rodada 5: **D2 unânime (sim). D3 unânime**: o campo
`allowCodeRun` só existe no repositório (CLI, `examCreate`/`examUpdate`),
não é editável na web; a tela do exam mostra o valor efetivo, inclusive o
herdado do tipo. **D1: 4 sim, breaker alternativa** (vai para a rodada 6).
security levantou B1..B4 (rodada 6). E1.6 deve medir incluindo a limpeza.

### Rodada 6

Exposição pelas posições menos votadas.

- **D1'.** breaker (1 voto, alternativa): esperar `deleteDatabase` antes de
  cada run trava quando outra execução mantém conexão aberta, e custa até
  2 s por Rodar. Proposta consolidada do presidente: no Worker, antes de
  carregar o driver, remover `indexedDB`, `caches`, `navigator.storage`,
  `Worker` e `SharedWorker` do escopo global (sem eles o aluno não persiste
  nada nem cria Worker aninhado com globais novos); limpeza de storage ao
  carregar o frame e antes de cada run, sem esperar por ela. Teste de
  isolamento passa a cobrir Worker aninhado.
- **S1** (security B1). Em `review`, um run de cada vez por frame; o frame
  é recarregado a cada submissão (já aprovado no 11).
- **S2** (B2). O frame do runner ignora mensagens cujo `source` não seja
  `window.parent` ou cuja origem não seja a da app; teste com popup/opener
  de outra origem.
- **S3** (B3). Restringir o host do runner a `/runner/` é obrigatório em
  produção (proxy documentado) e também no middleware (`public/` e
  `/_astro/` dão 404 nesse host).
- **S4** (B4). xterm sem addon de clipboard OSC 52; links na saída abrem
  com confirmação e `noopener`.
- **U1** (ui-designer). Mobile: layout empilhado (A) com campo de entrada
  fixo acima do teclado, em vez de abas (B).
- **U2.** Em `review`, o professor pode editar uma cópia do código do
  aluno, nunca salva, com marcador "modificado" e "voltar à submissão".
  Presidente: sim. Alternativa: só rodar.
- **U3.** Prolog: Rodar = `consult` do editor + toplevel no terminal.
- **U4.** Conflito de rascunho: as duas versões lado a lado bastam na
  E3a; diff fica para depois.

Votos da rodada 6: **D1', S1, S2, S4, U1..U4 unânimes**, com condições:

- D1': apagar as propriedades em toda a cadeia de protótipos de `self` e
  `navigator` (`WorkerGlobalScope.prototype`, `WorkerNavigator.prototype`),
  incluindo `indexedDB`, `caches`, `storage`, `Worker`, `SharedWorker` e
  `BroadcastChannel`; teste tenta recuperar via
  `Object.getOwnPropertyDescriptor`; E1.6 confirma que Pyodide e swipl-wasm
  carregam sem essas APIs (builds sem pthreads). Erro ao usar `indexedDB`
  deve ser compreensível para o aluno.
- S2: teste cobre popup e opener.
- U2: cópia do professor só em memória, fora do rascunho e de autosave;
  saída da cópia marcada "modificado"; nada vira nota ou feedback sem ação
  explícita.
- U3: erro de sintaxe no `consult` com número de linha; UI avisa "Rodar
  reinicia o Prolog".
- U4: versões como texto puro, com hora de cada uma.

**S3: 4 sim, architect alternativa**: o middleware não alcança `public/` e
`/_astro/` (o handler estático do adapter node e o Vite respondem antes).
Vai para a rodada 7 como S3'.

### Rodada 7

- **S3'.** Exposição: architect (alternativa) primeiro. Proposta: proxy que
  restringe o host do runner a `/runner/` é obrigatório e documentado em
  produção; o middleware bloqueia no host do runner tudo que ele alcança
  (rotas SSR fora de `/runner/`); o frame só depende de assets em
  `/runner/<versão>/`, nunca de `/_astro/`; teste afirma o comportamento
  real (o que o middleware bloqueia e o que fica a cargo do proxy).
- **C1.** Aprovação das seções "Contratos" e "Tarefas da E1" do RFC, já
  atualizadas pelo architect com as rodadas 5 e 6.

Votos da rodada 7: **S3' e C1 aprovados por unanimidade**, com condições:
documentar que o proxy repassa `Host`/`X-Forwarded-Host` (breaker); E1.6
mede também o recarregamento do frame (usuario); emendas do breaker aos
stubs: saída em lotes por intervalo, `status` repetido descartado e limite
contando mensagens além de bytes; APIs removidas viram `undefined`
somente leitura (não getter que lança); `run` com `runId` repetido é
ignorado. O architect incorpora antes de os implementers começarem.

### Rodada 8: reabertura do 7' (medições da E1.6)

Medições (RFC, seção "Medições"): Pyodide 1969/2209 ms (mediana/p90) no
desktop e 7775/8562 ms com CPU 4x; swipl-wasm 146/167 e 1434/1856; recarga
do frame 50/55 e 437/461. Pyodide e swipl-wasm rodam sem as APIs
bloqueadas. Pyodide com CPU lenta passa da meta de 3 s; pela condição do
7', a decisão reabre.

- **P1.** Proposta do presidente: manter um Worker novo por run, mas
  **pré-aquecido**: a página mantém um Worker reserva por linguagem já
  inicializado (runtime carregado, escopo bloqueado, sem código do aluno).
  Rodar consome a reserva e dispara a criação da próxima em segundo plano.
  A reserva é criada no primeiro foco/edição de um editor daquela
  linguagem, não no carregamento da página. Em `review`, o frame recarregado
  já cria a reserva. Isolamento igual ao 7' (nenhum Worker roda código de
  dois runs); custo: memória de um runtime ocioso por linguagem na página.
- Alternativa (usuario, rodada 3): reaproveitar o Worker entre runs com
  memória limpa. O presidente vota contra: reabre B1 (estado vaza entre
  runs) e o Parar volta a matar o runtime.

Votos da rodada 8: **P1 aprovado por unanimidade**, com condições:

- Worker em duas fases: `load` (bloqueio do escopo na inicialização, antes
  do runtime; `Driver.load`; sem código do aluno) e `start` (arquivos e
  stdin). Protocolo ganha `prepare { language }`; `RunnerHost.prepare`.
- A reserva aceita um único `start`; `runId` e canal de stdin só se ligam
  ao consumi-la; o frame encerra a reserva que mandar mensagem fora do
  protocolo de carga. Teste de que a reserva já nasce bloqueada.
- Reserva seguinte só depois que o run atual termina; reserva descartada
  quando a aba fica oculta (`visibilitychange`); nenhuma reserva quando a
  execução está desligada (`allowCodeRun` falso, sem `RUNNER_ORIGIN`).
- UI mostra "preparando…" se Rodar chegar antes da reserva.
- Plano B na E3b: medir snapshot de memória do Pyodide.

### Revisões de entrega E1.1 a E1.3

- E1.1 (272d596): security aprovou; bug de logout do `__Host-session`
  corrigido em 5c5517f.
- E1.2 (53a9ac1) e E1.3 (f967851): security aprovou. breaker achou B1 (SW
  perde canais de stdin após ~30 s ocioso; REPL fica pendurado), B2 (Worker
  posta saída sem limite), B3 (`status` forjado fora do lote), B4 (frame
  aberto antes de deploy quebra) e `navigator.locks` como canal entre runs.
  B1..B3 e `locks` são correções dentro do desenho aprovado (implementer
  delegado; `locks` estende a lista do D1'). B4 virou a issue
  `dev/issues/runner-frame-apos-deploy.md`, para votação.
- Issue `dev/issues/stories-falhando-em-main.md` (3 stories já falham na
  base 2bfdd24), para votação.

Votos das issues: **as duas aprovadas por unanimidade.** Condições para
`runner-frame-apos-deploy`: motivo legível por código
(`exitReason: "stale-bundle"`), 404 confirmado com `fetch` da URL do
Worker, reserva com a mesma falha também dispara a recarga, uma única
repetição com `runId` novo, código e rascunho preservados, e os outros runs
da página encerrados por causa da recarga avisam o aluno. Alternativa do
breaker (servir versões anteriores do bundle) registrada como plano B.

### Rodada 9: contratos da E2

Seções "Contratos da E2" e "Tarefas da E2" no RFC; stubs em
`src/runner/languages.ts` e `src/components/runner/`.

- **E2-D1.** 10 dependências novas: CodeMirror 6 (5 pacotes),
  `@replit/codemirror-vscode-keymap`, `@xterm/xterm` + 2 addons,
  `xterm-readline`.
- **E2-D2.** Tema do editor: (a) tema do VS Code, como combinado com o
  humano; (b) temas do Codehood (cerrado/forest, os mesmos do Shiki), sem
  troca de cor entre visualização e edição, claro/escuro de graça
  (recomendação do architect). Presidente: (a). O tema do VS Code foi
  decisão tomada com o humano; o comitê não a reverte. Se (b) vencer, vira
  proposta ao humano no relatório final, e a E2 sai com (a).
- **E2-D3.** Bloco executável em notas `MD`: ` ```js run `.
- **E2-J1.** Resource com linguagem sem driver, ou instância sem
  `RUNNER_ORIGIN`, continua estático, sem widget.

Votos da rodada 9: **E2-D1, E2-D3, E2-J1 unânimes. E2-D2: (a) com 4 votos;
usuario votou (b) mas aceitou (a) por ser decisão do humano**, sem pedir
nova rodada. A E2 sai com o tema do VS Code; (b) vai como proposta ao humano
no relatório final. Condições:

- Visualização Shiki antes de o editor montar usa `light-plus`/`dark-plus`
  (architect).
- Supply chain (security): trocar `xterm-readline` por editor de linha
  próprio e mínimo; versões exatas; `minimumReleaseAge` de 7 dias em
  `pnpm-workspace.yaml`.
- CodeMirror e xterm por `import()` no primeiro foco, nunca estático
  (breaker).
- Atalho Ctrl+Enter com `Prec.highest` (breaker B7).
- "Tentar de novo" vale só para o widget, nunca `reload()` do host
  compartilhado (breaker B8).
- `confirm` de link mostra a URL real (security B1); saída só por
  `RunnerTerminal.write`, eco do campo de celular por `textContent`
  (security B2); `data-language` só de `runnerLanguage()`.
- Bloco marcado `run` com linguagem sem driver mostra aviso discreto
  "execução não disponível para esta linguagem" (usuario); demais blocos
  continuam estáticos.

Revisão do f1c3872 (breaker): resync não atinge outro canal. Furos minor
B5 (resync disparado antes da checagem de token; amplificação para todas as
janelas) e B6 (prazo de 1 s do resync curto no celular; Worker deve tentar
de novo após o resync) vão para correção após a issue de bundle.

### Rodada 10: contratos da E3a e E3b

Seções "Contratos/Tarefas da E3a" e "Contratos/Tarefas da E3b" no RFC;
stubs `src/services/code-run.ts`, `src/components/exam/code-draft.ts`,
`src/components/exam/CodeEssayAnswer.tsx`. O CLI ainda não envia exams
(`push-exams.md` em `to-do`): até lá a flag vem da API e do seed.

- **E3-D1.** Declaração da flag no repositório: (a) `meta: { codeRun }` no
  frontmatter do exam, sem mudar o mdq; (b) campo novo no schema do mdq
  (outro repositório). Presidente: (a).
- **E3-D2.** Troca do campo de resposta: (a) `CodeEssayAnswer` desvia no
  `AnswerField` e repete enunciado/epílogo do mdq-js; (b) slot no `Essay`
  do mdq-js (outro repositório). Presidente: (a).
- **E3-D3.** Testes de Prolog e Python na suíte padrão (runtimes servidos
  localmente; ~2 s por teste de Python), revertendo o item 9 da rodada 2.
  Presidente: sim, limitado a poucos testes de fumaça por runtime; o resto
  fica fora da suíte padrão.

Votos da rodada 10: **E3-D1 (a), E3-D2 (a), E3-D3 sim: unânimes.**
Condições:

- E3-D1: sem `meta.codeRun`, o CLI envia `allowCodeRun: null` (ADR 0012;
  apagar do frontmatter volta ao padrão) (breaker).
- E3-D2: enunciado/epílogo pelo mesmo `Markdown` do mdq-js, sem caminho
  novo de HTML (security); teste que compara o DOM de `CodeEssayAnswer`
  com o de `Essay` (breaker).
- E3-D3: dois testes de fumaça por runtime na suíte padrão (carregar e ler
  entrada; erro com número de linha); E3b.2/E3b.3 testam que
  `FS.mount(IDBFS)` falha.
- Tela do exam mostra o valor efetivo: "ligada (padrão de PRACTICE)" ou
  "desligada (definido pelo professor)" (usuario).
- Rascunho (security B1, breaker B10): a cada página autenticada, apagar
  rascunhos de outros usuários; apagar rascunhos do exam ao enviar ou
  encerrar; prazo de validade.
- Conflito no envio (breaker B9): o envio aponta questões em conflito;
  envio automático por tempo esgotado usa a versão mais recente.
- Horas do conflito comparadas pelo relógio do servidor (breaker B11).

### Rodada 11: versão do swipl-wasm

`swipl-wasm@8.3.0` (medido na E1.6) foi publicado em 2026-11-06 e só passa
no `minimumReleaseAge` de 7 dias em 2026-11-13. `pyodide@314.0.7` passa.
O Pyodide 314.0.7 traz `pyodide.asm.mjs` (não `.js`); `RUNTIMES` lista o
`.mjs`.

- **V1.** (a) esperar até 13/11; (b) usar `swipl-wasm@8.2.6` (maduro, não
  medido; os testes de fumaça e o de APIs bloqueadas da E3b.2 cobrem a
  compatibilidade, e a E3b.5 mede); (c) exceção em
  `minimumReleaseAgeExclude` para 8.3.0. Presidente: (b). (c) desfaz a
  salvaguarda pedida pelo security na rodada 9.

Votos da rodada 11: **V1 (b) unânime.** `swipl-wasm@8.2.6` agora; trocar
por 8.3.0 depois de 2026-11-13 num commit separado. A E3b.1 verifica que o
8.2.6 é build sem pthreads e aceita o patch `export default SWIPL`.

### Rodada 12: E3a com WebKit pendente

Validação cross-browser (ef8a1eb, issue `runner-firefox-safari`): Chromium
ok; Firefox ok exceto dois bugs (stdin `none` a partir do 2º frame; link do
terminal não abre), em correção. WebKit não roda neste host: faltam
bibliotecas de sistema (`sudo playwright install-deps`), ação só do humano.

- **W1.** Implementar a E3a agora, com Chromium e Firefox validados, e
  manter a issue aberta: a E3a não é considerada pronta para uso em prova
  até o WebKit (Safari/iPhone) ser validado pelo humano. Presidente: sim.

Votos da rodada 12: **W1 unânime.** Trava concreta (breaker): a branch não
entra em `main` enquanto a issue `runner-firefox-safari` estiver aberta;
recomendação ao humano no relatório final. A validação do WebKit pelo
humano roda também os testes de isolamento da E1.5 (security).
