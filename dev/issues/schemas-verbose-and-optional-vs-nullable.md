---
type: issue
status: backlog
tags: [schemas, validation, user]
relatedTo: [relative-expiry-breaks-idempotency]
kind: task
created: 2026-09-13
creator: Fábio Macêdo Mendes
---

# `src/core/schemas/` repete schemas e usa sentinela no lugar de coluna nula

A troca de `.optional()` por `.nullish()` nos campos de colunas anuláveis já
foi feita, e a regra está em `src/db/services/README.md:78`. Restam dois
problemas.

## 1. `passphraseCreate` e `passphraseUpdate` são reescritos em vez de derivados

Os outros schemas de criação e atualização derivam do schema da entidade com
`pick`/`omit`/`extend`/`partial`. Estes dois ainda são `z.object` soltos
(`src/core/schemas/passphrase.ts:14-22`) e podem divergir de
`passphraseSchema` sem aviso.

- Esperado: derivados de `passphraseSchema`, como os demais.
- Obtido: objetos escritos à mão.

Fazer junto com `relative-expiry-breaks-idempotency`, que acrescenta
`expiresAt` a `passphraseCreate`.

## 2. `githubId` e `schoolId` usam um sentinela no lugar de `NULL`

`User.githubId` e `User.schoolId` são `String @unique` NOT NULL
(`prisma/schema.prisma:47-48`) e guardam `!<username>` quando ausentes.
`user.service.ts` grava o sentinela com `nullSentinel`/`mask` e o remove na
leitura com `unmask` (`src/db/services/user.service.ts:87-88`,
`src/db/services/user.service.ts:394-426`). O sentinela existe porque alguns
bancos recusam nulos repetidos em `@unique`; o SQLite aceita.

- Esperado: `String? @unique`, sem `nullSentinel`/`mask`/`unmask`.
- Obtido: sentinela em todo caminho de leitura e escrita de usuário.

Exige migração.
