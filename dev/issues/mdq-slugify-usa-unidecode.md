---
type: issue
status: backlog
tags: [performance, mdq]
kind: enhancement
priority: medium
created: 2026-11-17
creator: claude
---

# O slugify do mdq puxa o unidecode (79 KB gz) para as páginas que carregam o mdq

`mdq-js/src/models/slugify.ts` (repositório irmão `../mdq`) usa `unidecode`. A
tabela de transliteração entra no chunk do parser: 328 KB brutos, 79 KB gz, em
toda página cujo bundle carrega o mdq.

## O que fazer

- Trocar `unidecode` por `normalize("NFD")` mais a remoção dos diacríticos
  (`/\p{M}/gu`). Cobre o português e as línguas latinas.
- Ou carregar o `unidecode` com `import()` só no caminho que precisa dele.

## Cuidado

Os slugs já gravados no banco e nos repositórios dos cursos não podem mudar.
Antes de trocar, comparar a saída das duas versões sobre todos os títulos do
seed e de um corpus com caracteres fora do latim (`ß`, `ø`, `æ`, `ł`, cirílico,
CJK), que a normalização NFD não decompõe. Se a saída diferir, manter o
`unidecode` só como fallback desses caracteres.
