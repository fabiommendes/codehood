---
type: issue
status: backlog
tags: [cli, seed, scripts]
relatedTo: [0018-paginacao-das-listas-por-cursor]
kind: bug
created: 2026-11-19
creator: claude
---

# `pnpm run db:seed:cli` quebra ao ler as edições

`scripts/seed-cli.ts` falha logo no início:

```
scripts/seed-cli.ts:132
	const live = editions.find(
TypeError: editions.find is not a function
```

`GET /api/edition` responde `{ items, next, prev }` desde a paginação por
cursor (ADR 0018), e o script ainda trata a resposta como lista. Basta ler
`items`. O resto do script não foi conferido depois dessa linha.

Enquanto isso, o curso `cli/seed/pyxel101` sobe à mão: copie a pasta e rode
`CODEHOOD_TOKEN=dev-ada-cli uv run --project cli ch push` dentro da cópia.
