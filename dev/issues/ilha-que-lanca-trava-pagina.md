---
type: issue
status: backlog
tags: [ssr, islands, errors]
---

# Uma ilha que lança no SSR deixa a página sem resposta

Um componente Solid que lança durante a renderização no servidor (visto com o
`MultipleChoice` de `mdq/solid` recebendo `result={{pending: true}}`, que lança
`TypeError` na hora) fez `page.goto` esperar até o timeout de 30 s, em vez de
responder 500. A exceção some em algum ponto do SSR ou da hidratação.

Próximo passo: reproduzir com uma ilha que lança de propósito e ver se a
resposta em streaming fica aberta. Um `ErrorBoundary` em volta das views do
mdq (`src/components/question/mdq.ts`) daria pelo menos um erro visível.
