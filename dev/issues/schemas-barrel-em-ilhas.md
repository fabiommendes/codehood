# Ilhas não importam o barrel `@/core/schemas`

Uma ilha Solid que importa `@/core/schemas` quebra na hidratação com
"process is not defined". Por isso `src/core/schemas/answer.ts` é importado
direto por `src/components/grading/GradeForm.tsx`, contra a regra do barrel.

Cadeia (esbuild, plataforma browser): `schemas/index.ts` → `schemas/base.ts`
→ `@/urls` → `urls/parsing.ts` → `core/error.ts` → `core/constants.ts`
(`process.env`). `core/error.ts` só usa `env.PRODUCTION` em
`responseFromException`; mover essa função tira o primeiro elo (importada por
`rpc/registry/index.ts`, `api/registry/route.ts`, `api/registry/dynamicHandler.ts`).

O próximo elo é `z.instanceof(Buffer)` avaliado na carga do módulo
(`schemas/base.ts`, `buffer`, e `schemas/blob.ts`): "Buffer is not defined" no
navegador. Falta ver o resto do grafo (`mdq/schemas-generated` etc.).

Pronto quando uma ilha importa do barrel e a exceção sai de `answer.ts`, do
`GradeForm.tsx` e da ADR `dev/adrs/0001-formularios-por-schema.md`.
