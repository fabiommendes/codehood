# Normalizar os `githubId` já gravados na próxima release

Desde a validação nova (`src/core/schemas/user.ts`, `githubId`), todo usuário
do GitHub que entra pelo schema é gravado em minúsculas e sem `@` inicial. As
linhas gravadas antes disso podem ter maiúsculas. Nesse caso, a busca por
`githubId` não as encontra, e `Ana` e `ana` podem coexistir.

Não há mudança de schema, então `pnpm run release` não gera migration para
isso. Ao cortar a próxima release, acrescente o ajuste à migration pendente
(ou crie uma só de dados, editada à mão na hora da release, como o
`scripts/migrations.ts` permite):

```sql
-- Falha se dois usuários diferem só na caixa: resolva esses à mão antes.
UPDATE "User"
SET "githubId" = lower(ltrim("githubId", '@'))
WHERE "githubId" NOT LIKE '!%';
```

Antes, confira se há colisões na base de produção:

```sql
SELECT lower(ltrim("githubId", '@')) AS g, count(*)
FROM "User" WHERE "githubId" NOT LIKE '!%'
GROUP BY g HAVING count(*) > 1;
```

Valores que não passam na regex nova (espaços, `_`, URL) continuam no banco e
só são recusados quando o usuário editar o perfil. Liste-os com o mesmo
`SELECT`, sem o `GROUP BY`, e corrija à mão se houver poucos.
