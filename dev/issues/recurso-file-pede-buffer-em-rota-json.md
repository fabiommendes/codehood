---
type: issue
status: backlog
tags: [api, rest, resources, blobs]
kind: bug
priority: medium
created: 2026-11-03
creator: claude
---

# Recurso `FILE` pede `buffer` numa rota JSON

Precisa de investigação antes de corrigir.

## Problema

`resourceCreate.data` aceita `resourceFileDataCreate`, que estende o dado do
arquivo com `buffer: buffer` (`src/core/schemas/resource.ts:69-76`). A rota
REST do recurso vem de `CRUD("/api/course/[discipline]/[course]/resource")`
(`src/api/index.ts:421-437`) e não declara `inMultipart`. Pelo REST, um corpo
JSON não tem como carregar um `Buffer`, então criar um recurso `FILE` por essa
rota parece impossível.

O caminho de bytes documentado no ADR 0011 é outro: `POST /api/blob/missing`
diz quais hashes faltam e os bytes sobem em multipart
(`src/api/index.ts:376-382`). Falta confirmar como o CLI cria recursos `FILE`
hoje (`cli/codehood/push/resource.py`) e se o `buffer` é usado só por
`manage import-resources`.

## Proposta

- Verificar quem cria recursos `FILE` e por qual caminho.
- Se o REST não usa `buffer`, a variante REST de `data` deveria referenciar o
  blob pelo hash (já enviado via `blob/missing` + upload), e `buffer` ficaria
  só no schema interno.

## Critérios

- [ ] Teste REST que cria um recurso `FILE` de ponta a ponta, ou um teste que
      prova que a variante com `buffer` não é aceita pela rota.
