---
type: issue
status: backlog
tags: [services, invite, passphrase, api]
relatedTo: [schemas-verbose-and-optional-vs-nullable]
kind: enhancement
created: 2026-09-13
creator: Fábio Macêdo Mendes
---

# Validade relativa na criação impede a idempotência

`inviteCreate` recebe `expiresInMs` (`src/core/schemas/invite.ts:40`) e o
service calcula `Date.now() + expiresInMs`
(`src/db/services/invite.service.ts:126-128`). `PassphraseService.create`
calcula o próprio prazo com `Date.now() + EXPIRY_MS`
(`src/db/services/passphrase.service.ts:119`), e `passphraseCreate` nem tem
campo de validade (`src/core/schemas/passphrase.ts:14-18`).

## Passos para reproduzir

1. Enviar duas vezes o mesmo `POST /api/invite` com o mesmo `expiresInMs`.

## Esperado

O mesmo pedido descreve a mesma linha: `expiresAt` depende só do que o cliente
mandou.

## Obtido

Cada envio grava um `expiresAt` diferente, que depende da hora em que o
servidor recebeu a chamada. Por isso `invite` e `passphrase` não têm `upsert`
(`src/db/services/invite.service.ts:67`,
`src/db/services/passphrase.service.ts:86`). As duas metades da entidade
também discordam: `inviteUpdate` já recebe um `expiresAt` absoluto
(`src/core/schemas/invite.ts:80`) e `inviteCreate` não.

## Correção

- Trocar `inviteCreate.expiresInMs` por `expiresAt` absoluto.
- Dar a `passphraseCreate` um `expiresAt` explícito, derivando o schema de
  `passphraseSchema` (ver `schemas-verbose-and-optional-vs-nullable`, item 1).
- Exportar `expiresIn(ms: number): Date` em `src/utils/` para quem pensa em
  duração.

Depois disso `passphrase` pode ganhar `upsert` pela chave `value`. `invite`
provavelmente continua sem, porque a única chave natural é o hash do token.

## Custo

Muda o contrato da API: `cli/resources/openapi/codehood.json`,
`test/bruno/openapi.json`, `test/bruno/invite/Create.yml`, controllers REST,
actions e `test/invite-service.spec.ts`.
