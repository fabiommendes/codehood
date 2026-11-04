---
type: issue
status: backlog
tags: [api, blobs, security]
relatedTo: [push]
kind: enhancement
priority: medium
created: 2026-11-03
creator: claude
---

# Uploads não têm limite de taxa

A cota (`BLOB_QUOTA_BY_ROLE`) protege o disco: os bytes só são gravados
depois de `assertWithinQuota`, na mesma transação do anexo. Não protege a
memória nem a rede. `readLimited` (`src/api/registry/multipart.ts`) guarda
até `MAX_UPLOAD_BYTES` (16 MB) na memória por requisição antes de qualquer
checagem de cota, e nada limita quantas requisições um usuário faz ao mesmo
tempo.

Um usuário autenticado, aluno ou instrutor, pode mandar muitas requisições
multipart de 16 MB em paralelo, para `.../resource` ou
`.../repository/<slug>/files`, e ocupar a memória do servidor mesmo que
todas sejam recusadas por cota ou permissão.

## Feito

- Até 2 uploads multipart simultâneos por usuário e 6 no servidor
  (`acquireUploadSlot` em `src/api/registry/route.ts`); acima disso, 429.

## Falta

- Checar a permissão de escrita antes de ler o corpo, quando a rota permite.
  Hoje um usuário sem permissão ainda ocupa um dos seus 2 slots, por até
  16 MB, até a rota recusar.
