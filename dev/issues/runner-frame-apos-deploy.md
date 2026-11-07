---
type: issue
status: open
tags: [runner, deploy]
relatedTo: [ambiente-de-execucao-no-cliente]
created: 2026-11-07
creator: claude
---

# Frame do runner aberto antes de um deploy para de rodar

`src/runner/server/assets.ts` só serve a versão atual do bundle. Um frame
carregado antes do deploy cria `new Worker(<versão antiga>/worker.js)`,
recebe 404 e todo run acaba em `load-failed` até a página recarregar. Numa
prova, isso aparece como "falha ao carregar" no meio da sessão.

Correção proposta: o frame reporta `load-failed` com motivo "bundle
desatualizado" quando o Worker da versão antiga dá 404; o `RunnerHost`
recarrega o frame e repete o run uma vez. Depende da E1.4.

Achado pelo breaker na revisão da E1.3.
