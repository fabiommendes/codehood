---
type: issue
status: open
tags: [runner, browsers, stdin, security]
relatedTo: [ambiente-de-execucao-no-cliente]
created: 2026-11-06
creator: claude
---

# Runner não validado em Firefox e Safari

O spike de stdin (`dev/rfc/ambiente-de-execucao-no-cliente.spike-stdin.md`)
só rodou no Chromium. `Document-Isolation-Policy` é exclusivo do Chromium,
então Firefox e Safari devem cair no fallback de service worker, que não foi
testado neles.

Validar em Firefox e Safari (inclusive iPhone e janela privada):

- stdin pelo fallback de service worker, com leitura longa (aluno espera
  minutos diante de um `input()`);
- os testes de isolamento da E1;
- a mensagem "navegador não suportado" quando nenhum canal existir.

Bloqueia a E3a (modo `answer` em provas).

## Resultado

Execução em 2026-11-07, Playwright 1.62 (Firefox 1538, WebKit 2336), com
`TEST_BROWSERS=cross` e `--project=firefox|webkit` (ver `AGENTS.md`). Novo
spec `test/runner-no-channel.spec.ts`: simula "sem isolamento e sem service
worker" (janela privada) em qualquer navegador.

| Navegador | stdin (sw) | Isolamento (E1) | Parar | "Não suportado" |
| :-------- | :--------- | :-------------- | :---- | :-------------- |
| Chromium  | ok | ok | ok | ok (simulado) |
| Firefox   | ok (bug 1 corrigido) | ok | ok | ok (simulado) |
| WebKit    | não rodou | não rodou | não rodou | não rodou |

WebKit: o host não tem as dependências do sistema (`libicu74 libxml2
libflite1`; instalar exige `sudo playwright install-deps`). Os testes falham
em `browserType.launch`. Precisa rodar em outra máquina. Safari de iPhone e
janela privada reais seguem sem validação.

Esperado pela plataforma (testes ajustados): sem `Document-Isolation-Policy`
o transporte é `sw` (o teste `sab` só vale no Chromium); `newCDPSession`,
`clipboard-read` e `isMobile` não existem no Firefox do Playwright (testes
pulados fora do Chromium). Os specs puros (`terminal`, `ide-state`,
`languages`) ficam só no Chromium.

### Bugs reais (corrigidos)

1. Firefox: um iframe carregado depois da ativação do service worker fica sem
   `navigator.serviceWorker.controller`, embora haja registro ativo (só o
   `clients.claim()` da ativação alcançava o 1o frame). Causa: nada pedia o
   claim de novo. Correção: `detectStdinKind` envia `{type: "claim"}` ao worker
   ativo quando não há controller, e `sw.ts` responde com `clients.claim()`.
   Teste de regressão: "every frame replaced in the same page announces the sw
   channel" em `test/runner-host.spec.ts` (falhava com `sw,none,none,none`).
   Com isso passam no Firefox as specs host, isolation e no-channel.
2. Era do teste, não do produto: `window.open` após `confirm` funciona no
   Firefox (verificado isolado). Depois de um diálogo o Firefox perde o hover,
   e o xterm só ativa o link sob hover. O teste agora move o mouse antes do
   segundo clique. Uma execução na bateria completa mostrou o terminal vazio
   uma vez (flaky sob carga, não reproduzida em 3 rodadas).

Falhas da rodada que não são do runner: `src/generated/paraglide` sem `en.js`
e `prolog` em `languages` (trabalho concorrente de outros agentes).
