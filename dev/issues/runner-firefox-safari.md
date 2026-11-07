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
