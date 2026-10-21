---
type: issue
status: todo
tags: [schemas, api, dates]
relatedTo: [exam-exception, exam]
---

# Datas ISO recusadas pelos schemas de entrada

Os schemas de entrada usam `z.date()`, que recusa a string ISO que chega num
corpo JSON. A API de exceções de prova contorna isso com `z.coerce.date()` só
na camada REST (`src/api/index.ts`); `examCreate.scheduledAt` tem o mesmo
problema e não foi tratado. Decidir se a coerção fica nos schemas de
`src/core/schemas/` (entrada coage, saída não, como diz o README dos services)
e remover o contorno da API.
