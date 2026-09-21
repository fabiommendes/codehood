# [Seguranca] Contas padrao admin/admin criadas em runtime por default de ambiente inseguro

Labels: `security`, `severity:alta`, `area:config`, `area:deploy`

## Problema

Nao ha segredo em texto claro no repositorio. O problema sao os defaults de
configuracao, espalhados por tres interruptores de producao diferentes, nenhum
validado no startup:

| Interruptor | Onde | Default | Resolvido em |
|---|---|---|---|
| `ENVIRONMENT` | `src/core/constants.ts:57` | `"dev"` | runtime |
| `NODE_ENV` | `src/db/bootstrap.ts:18` | ausente | runtime |
| `import.meta.env.PROD` | `src/actions/auth.ts:14` | - | build time |

Com `ENVIRONMENT` ausente, `devBootstrapMiddleware` entra na cadeia e roda
`ensureDevAdmin()` no primeiro request. Essa funcao consulta uma variavel
diferente (`NODE_ENV`) e, com o banco vazio, cria `admin/admin`,
`instructor/instructor` e `student/student`.

Como efeito colateral, `ENVIRONMENT != "prod"` deixa o cookie de sessao sem a
flag `Secure` (`SESSION_COOKIE_OPTIONS`), enquanto `src/actions/auth.ts` decide
o mesmo atributo por outro criterio, resolvido no build.

Nem o README nem o AGENTS.md mencionam essas variaveis.

### Por que e explorável

Verificado no build de producao: `dist/server/virtual_astro_middleware.mjs:16`
mantem `process.env.NODE_ENV === "production"` como teste de runtime, ou seja,
nao foi inlinado. Subir `node dist/server/entry.mjs` sem exportar nenhuma das
duas variaveis, sobre um banco ainda sem usuarios, basta para criar o
administrador de senha `admin`, acessivel pela tela de login publica.

## Evidencia

`src/core/constants.ts:57-73`

```ts
export const ENVIRONMENT = assertIn(readEnv("ENVIRONMENT", "dev"), ["dev", "prod"]);
export const PRODUCTION = ENVIRONMENT === "prod";
export const SESSION_COOKIE_OPTIONS = { httpOnly: true, secure: PRODUCTION, ... };
```

`src/middleware.ts:92-95`

```ts
export const onRequest = env.ENVIRONMENT === "dev"
  ? sequence(...DEVELOPMENT_MIDDLEWARES, ...COMMON_MIDDLEWARES)
  : sequence(...COMMON_MIDDLEWARES);
```

`src/db/bootstrap.ts:17-38`

```ts
export function ensureDevAdmin(): Promise<void> {
  if (process.env.NODE_ENV === "production") { ...; return Promise.resolve(); }
  devAdminPromise ??= createDevAdminIfMissing();
  return devAdminPromise;
}
...
await demoUser({ email: DEV_ADMIN_EMAIL, username: "admin", name: "Admin",
                 role: "ADMIN", password: DEV_ADMIN_USERNAME });   // senha = "admin"
```

## Impacto

Instancia publicada com as variaveis esquecidas fica com administrador de senha
trivial, descoberto em uma tentativa. Na mesma condicao, o cookie de sessao
trafega sem `Secure`.

Condicao de explorabilidade: deploy com `ENVIRONMENT` e `NODE_ENV` ausentes (ou
diferentes de `prod`/`production`) e banco ainda sem nenhum usuario.
`createDevAdminIfMissing` desiste assim que encontra qualquer usuario, entao uma
instancia ja povoada nao e afetada.

## Sugestao de correcao

1. Um unico interruptor (`ENVIRONMENT`), sem default: falhar o boot com mensagem
   clara se a variavel nao estiver definida ou estiver vazia. `readEnv` hoje so
   testa `undefined`, entao `ENVIRONMENT=""` tambem deveria ser recusado.
2. Tirar o seed de desenvolvimento do middleware de request; deixa-lo apenas em
   `pnpm run db:seed`.
3. Se as contas de demonstracao permanecerem, gerar senha aleatoria e imprimi-la
   uma unica vez no log, em vez de usar o username como senha.
4. Derivar `secure`/`httpOnly`/`sameSite` de um unico ponto compartilhado por
   `src/api/auth.ts` e `src/actions/auth.ts`.
5. Documentar as variaveis obrigatorias de producao no README.

Mitigacao imediata, enquanto isso nao e feito: publicar sempre com
`ENVIRONMENT=prod` e `NODE_ENV=production`, e conferir que nao existe usuario
`admin` no banco.

## Criterios de aceite

- [ ] Subir o servidor sem `ENVIRONMENT` (ou com valor vazio) falha com mensagem
      clara, em vez de assumir `dev`.
- [ ] Nenhum caminho de request cria usuario.
- [ ] Atributos do cookie de sessao vem de um unico ponto.
- [ ] README lista as variaveis obrigatorias de producao.
- [ ] `pnpm run lint` passa.
