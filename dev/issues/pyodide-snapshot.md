---
type: issue
status: open
tags: [runner, python, performance]
relatedTo: [ambiente-de-execucao-no-cliente]
created: 2026-11-07
creator: claude
---

# Pyodide frio leva ~8 s em celular lento

Medição E3b.5 (RFC, seção "Medições"): com a reserva pronta, Rodar em
Python leva milissegundos; sem reserva (primeiro Rodar logo após abrir a
página, Rodar duas vezes seguidas, troca de submissão na correção) leva
~1,6 s no desktop e ~8 s com CPU 4x.

Plano B medido em bancada: snapshot de memória do Pyodide leva o
`loadPyodide` de 1464 para 193 ms (desktop) e de 7144 para 1484 ms (CPU
4x). Custos: 30 MiB (3,9 MiB com brotli) e API privada
(`makeMemorySnapshot`/`_loadSnapshot`), que pode mudar entre versões.

Decidir se vale adotar, como gerar o snapshot no build e como versioná-lo.
