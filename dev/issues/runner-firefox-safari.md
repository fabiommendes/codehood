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
| Firefox   | ok no 1o frame da página; **falha a partir do 2o** (bug 1) | ok, salvo wipe de storage e probe após recarga (bug 1) | ok | ok (simulado) |
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

### Bugs reais

1. Firefox: ao substituir o iframe do runner na mesma página (`host.reload()`,
   `exclusive()`, recarga do frame), `detectStdinKind` devolve `none` nas
   cargas seguintes (`container.controller` não aparece nos 5 s de
   `SW_READY_TIMEOUT_MS`) e o host rejeita com `unsupported`. Medido:
   `sw,none,none,none,none,none` em 3 de 3 tentativas. Falham os testes de
   reload e de bundle antigo em `runner-host.spec.ts` e as de isolamento
   567 e 596 (probe termina `crashed`, storage não é limpo). Arquivo
   provável: `src/runner/sandbox/stdin/index.ts` (`detectStdinKind`), com
   `src/runner/sandbox/sw.ts` (falta `clients.claim()`?). Não confirmado se
   é a partição de storage de iframe de terceiros do Firefox.
2. Não classificado: Firefox, `runner-widget.spec.ts` "a click asks first":
   o clique no link do terminal não abre a janela após confirmar. Pode ser
   limitação do Playwright; investigar em `src/components/runner`.

Falhas da rodada que não são do runner: `src/generated/paraglide` sem `en.js`
e `prolog` em `languages` (trabalho concorrente de outros agentes).
