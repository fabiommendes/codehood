---
type: issue
status: backlog
tags: [exam, answer-edits, grading]
kind: feature
priority: low
created: 2026-11-11
creator: claude
---

# Replay do texto com linha do tempo na tela do instrutor

Segundo passo, depois do resumo por resposta (tempo ativo, inserções grandes,
lacunas, primeira e última edição) da primeira versão da tela do instrutor.

Mostrar a resposta sendo reconstruída a partir dos lotes do histórico, com uma
linha do tempo para avançar, voltar e saltar entre edições, pausas e lacunas.
Lacunas aparecem como trechos não reproduzíveis, sem edições fabricadas. O replay
lê lotes paginados (ver "Banco de dados" no RFC) e não carrega todos os edits na
consulta normal de correção.

Depende do endpoint e do resumo do histórico (spec
`dev/specs/to-review/historico-de-edicao-no-servidor.md`). O histórico não prova autoria nem colagem; a tela não deve sugerir
precisão que os dados não têm (ver "Privacidade e interpretação" no RFC).
