"""
Texto completo das issues do GitHub, uma por achado acionavel.

Achados triviais do mesmo tema sao agrupados (F6+F9 viram uma issue so, F7+F8
tambem), para nao gerar spam de issues.
"""

ISSUES = [
    {
        "n": 1,
        "title": "[Seguranca] XSS armazenado no roster via JSON.stringify dentro de <script set:html>",
        "labels": "security, severity:alta, area:frontend",
        "body": """## Problema

`src/pages/[discipline]/[course]/roster.astro` embute os dados do CSV do roster
em um `<script type="application/json">` usando `set:html={JSON.stringify(csvRows)}`.

`set:html` escreve o valor cru no HTML, e `JSON.stringify` nao escapa a sequencia
`</script`. O parser HTML encerra o elemento nesse ponto mesmo quando o `type` nao
e JavaScript, entao qualquer marcacao apos ela e interpretada como HTML.

As celulas de `csvRows` vem de `name`, `email`, `githubId` e `schoolId` dos alunos
matriculados - todos campos que o proprio aluno grava por
`actions.profile.update` ou `PATCH /api/user/me`. `userUpdate` valida `name`
apenas com `z.string().min(1)`.

### Por que e explorável

1. Aluno matriculado no curso define o proprio nome como
   `</script><img src=x onerror=...>`.
2. O instrutor (ou um admin) abre a aba Students do curso.
3. O payload executa na origem da aplicacao, na sessao da vitima.

O cookie de sessao e `httpOnly`, entao nao ha roubo direto de cookie. Mas o
script age como a vitima na mesma origem: emitir convites, apagar conteudo do
curso e, encadeando com a issue da troca de senha sem senha atual, assumir a
conta por completo.

## Evidencia

`src/pages/[discipline]/[course]/roster.astro:448-452`

```astro
<script
  type="application/json"
  id="roster-csv-data"
  set:html={JSON.stringify(csvRows)}
/>
```

`src/pages/[discipline]/[course]/roster.astro:93-103`

```ts
const csvRows = [
  ["Name", "Username", "Email", "GitHub", "School ID", "Enrolled"],
  ...students.map((s) => [
    s.name, s.username, s.email, s.githubId, s.schoolId,
    s.enrolledAt.toISOString().slice(0, 10),
  ]),
];
```

`src/core/schemas/user.ts:40-51` - o aluno controla `name` sem restricao de
conteudo:

```ts
export const userUpdate = userSchema
  .pick({ name: true, email: true, githubId: true, schoolId: true })
  .extend({ password: z.string().min(1).optional() })
  .partial()
  .strict();
```

Verificado em Node 22:
`JSON.stringify(["</script><img src=x onerror=alert(1)>"])` devolve a sequencia
intacta, sem escape.

## Impacto

Execucao de codigo arbitrario na sessao do instrutor ou do admin que visitar o
roster. Aluno -> instrutor e escalada de privilegio; aluno -> admin e
comprometimento da instancia.

## Sugestao de correcao

Nao usar `set:html` para transportar dados. Qualquer uma das opcoes:

- Escapar na serializacao:
  `JSON.stringify(csvRows).replace(/</g, "\\u003c")`.
- Passar as linhas por `define:vars`, que o Astro ja escapa.
- Montar o CSV em um endpoint autenticado e baixar por `fetch`.

Vale varrer os demais `set:html` do projeto no mesmo passe; os outros usos
(`Tabs.astro`, as paginas de recurso e de prova) recebem HTML gerado por
`markdown-it` com `html: false`, nao entrada crua, mas convem confirmar.

## Criterios de aceite

- [ ] Um aluno chamado `</script><img src=x onerror=alert(1)>` aparece
      literalmente na pagina do roster, sem executar nada.
- [ ] Nenhum `set:html` do projeto recebe dado originado de entrada de usuario.
- [ ] Teste de regressao em `test/` cria esse aluno e afirma que o HTML do
      roster nao contem `<img`.
- [ ] `pnpm run lint` passa.
""",
    },
    {
        "n": 2,
        "title": "[Seguranca] PATCH /api/user/me troca a senha sem exigir a senha atual",
        "labels": "security, severity:alta, area:api, area:auth",
        "body": """## Problema

A regra "para trocar a senha, prove que sabe a atual" existe apenas no handler
da Astro Action usada pela tela `/profile`. A rota REST equivalente nao a tem.

`userUpdate` inclui `password`, e `PATCH /api/user/me` aceita esse schema
inteiro. O servico so valida a forca da nova senha e reescreve o hash.

### Por que e explorável

Qualquer posse temporaria de uma credencial valida vira posse permanente da
conta:

- XSS (ver a issue do roster) executa o PATCH na sessao da vitima.
- Estacao deixada aberta.
- API key Bearer vazada em log de CI ou no disco de um robo de correcao -
  `apiKeyMiddleware` a converte em um ator completo, com o papel do dono.

Nenhum desses exige conhecer a senha atual, e apos a troca o dono legitimo fica
sem acesso.

## Evidencia

`src/api/index.ts:142-153`

```ts
updateMe: PATCH("/api/user/me", {
  in: schema.userUpdate,                       // userUpdate inclui `password`
  out: schema.userSchema.omit({ passwordHash: true }),
  handler: async (args) => {
    return db.user.update({ username: args.actor.username }, args.body, {
      actor: args.actor,
    });
  },
}),
```

`src/db/services/user.service.ts:174-188` - nenhuma reprova de credencial:

```ts
if (password) {
  const issues = await passwordStrengthIssues(password);
  InvalidData.ensureNoError({ password: issues });
}
return toUser(await tx.user.update({
  where: { username: target.username },
  data: { ...rest, ...(password !== undefined
    ? { passwordHash: await hashPassword(password) } : {}) },
}));
```

`src/actions/profile.ts:68-91` - o caminho da UI, que faz a checagem certa:

```ts
if (!user || !(await verifyPassword(user.passwordHash, input.currentPassword)))
  throw new ActionError({ code: "UNAUTHORIZED", ... });
```

Reproducao, autenticado com cookie de sessao ou Bearer:

```
PATCH /api/user/me
Content-Type: application/json

{"password": "nova-senha-qualquer"}
```

## Impacto

Tomada de conta a partir de qualquer captura momentanea de sessao. Quando a
vitima e admin, comprometimento total da instancia. Tambem remove a ultima
barreira que limitaria o impacto de um XSS.

## Sugestao de correcao

1. Remover `password` de `userUpdate`.
2. Criar rota dedicada, por exemplo `POST /api/user/me/password`, com
   `{ currentPassword, newPassword }`, reutilizando a logica de
   `profile.changePassword`.
3. Invalidar as demais sessoes e API keys do usuario apos a troca
   (`db.session.delete({ username })`), para que a troca sirva tambem como
   resposta a incidente.

Decidir explicitamente o caso do admin trocando a senha de outra pessoa: se for
para continuar existindo, que seja por rota separada e auditada, nao pelo mesmo
`userUpdate`.

## Criterios de aceite

- [ ] `PATCH /api/user/me` com `password` no corpo nao altera o hash.
- [ ] Existe rota dedicada que exige `currentPassword` e o valida com
      `verifyPassword`.
- [ ] Senha trocada revoga as demais sessoes do usuario.
- [ ] Teste de integracao cobre: troca com senha atual correta, com senha atual
      errada, e a tentativa pelo `PATCH`.
- [ ] `pnpm run lint` passa.
""",
    },
    {
        "n": 3,
        "title": "[Seguranca] Criacao de convite nao valida a posse do curso",
        "labels": "security, severity:alta, area:auth, area:api",
        "body": """## Problema

`invite.create` so consulta `invitedRole`. O `courseId` do convite nunca e
confrontado com o ator, nem no servico, nem nas Astro Actions, nem na rota REST.

Todas as demais escritas ligadas a curso carregam o curso e checam
`course.update-contents` ou `enrollment.manage` antes de gravar
(`enrollment.create`, `exam`, `question`, `resource`, `time-slot`,
`calendar-event`, `passphrase`). Convite e a unica que nao faz.

### Por que e explorável

1. Instrutor A chama `actions.auth.createClassroomInvite` (ou
   `POST /api/invite`) com o `courseId` de um curso do instrutor B.
2. A permissao passa: A e INSTRUCTOR e o papel convidado e STUDENT.
3. Quem resgatar o link vira matricula ACTIVE no curso de B - o resgate em
   `src/actions/auth.ts` roda como `FULL_ACCESS`, entao tambem nao repara nada.
4. A matricula concede `course.read-contents`: provas publicadas, recursos,
   calendario e a lista completa de matriculados do curso de B.

## Evidencia

`src/auth/permissions/index.ts:193-198` - o alvo nao carrega o curso:

```ts
"invite.create": {
  admin: (_, target) => target.invitedRole !== "ADMIN",
  instructor: (_, target) => target.invitedRole === "STUDENT",
  student: false,
  audit: (target) => ({ invitedRole: target.invitedRole }),
} satisfies PermDef<InviteCreateTarget>,
```

`src/db/services/invite.service.ts:72-97`

```ts
ensurePerm(opts.actor, "invite.create", { invitedRole: input.invitedRole });
const invite = await tx.invite.create({
  data: { ..., courseId: input.courseId },   // nunca confrontado com o ator
});
```

`src/actions/auth.ts:163-183` - a Action repassa o `courseId` como veio:

```ts
createClassroomInvite: defineAction({
  input: z.object({ courseId: z.number().int(), maxUses: ... }),
  handler: withActionErrors(async (input, context) => {
    const actor = requireUser(context);
    const { token } = await db.invite.create(
      { ..., courseId: input.courseId as schema.CourseId, ... },
      { actor },
    );
```

`src/actions/auth.ts:109-114` - o resgate matricula sem nova checagem:

```ts
if (invite.courseId) {
  await db.enrollment.create(
    { courseId: invite.courseId, username: createdUser.username },
    { ...FULL_ACCESS, tx },
  );
}
```

## Impacto

Instrutor injeta contas que controla no curso de outro instrutor, ganhando
leitura de todo o conteudo do curso alheio e corrompendo o roster (e qualquer
nota futura calculada sobre ele). Exige conta INSTRUCTOR ou ADMIN; aluno e
barrado por `student: false`.

## Sugestao de correcao

Ampliar o alvo da permissao para `{ invitedRole, course }` e exigir
`enrollment.manage` sobre o curso quando `courseId` estiver presente. Carregar o
curso em `createTx` antes do `ensurePerm`, no mesmo formato que
`timeSlotService.create` e `calendarEventService.create` ja usam:

```ts
const course = input.courseId
  ? await tx.course.findUnique({
      where: { id: input.courseId },
      select: { id: true, instructor: { select: { username: true } } },
    })
  : null;
```

Decidir e documentar o comportamento do admin que nao leciona o curso - a spec
ja trata `enrollment.manage` como direito de operacao do curso, sem ramo de
admin.

## Criterios de aceite

- [ ] Instrutor A recebe 403 ao criar convite com `courseId` de curso de B, pela
      Action e pela rota REST.
- [ ] Convite sem `courseId` continua funcionando para o papel permitido.
- [ ] O comportamento do admin nao-dono esta decidido, implementado e registrado
      na spec.
- [ ] Teste de regressao cobre o caso cruzado.
- [ ] `pnpm run lint` passa.
""",
    },
    {
        "n": 4,
        "title": "[Seguranca] Contas padrao admin/admin criadas em runtime por default de ambiente inseguro",
        "labels": "security, severity:alta, area:config, area:deploy",
        "body": """## Problema

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
""",
    },
    {
        "n": 5,
        "title": "[Seguranca] Lista completa de matriculados devolvida a qualquer aluno do curso",
        "labels": "security, severity:media, area:api, area:privacy",
        "body": """## Problema

`courseSchema` declara `enrollments: userInfo.array()`, entao a lista de
matriculados (nome e username de todos) acompanha toda leitura de curso.

`enrollments` e carregado em `courseInclude` por dois motivos legitimos:
alimentar a propria permissao `course.read` (decidir se o ator e membro) e o
contador exibido no card. Mas, por estar declarado no schema de saida, o
`options.out.parse(value)` de `src/api/registry/route.ts:215` - que existe
justamente para podar campos nao declarados - o preserva.

O servico de matricula documenta e aplica a regra oposta:

```
Students cannot list their classmates, a privacy default rather than a
technical limit.
```

`enrollmentService.findMany` exige `enrollment.read`, que so o dono do curso
tem. Essa restricao e contornada por outra rota.

### Por que e explorável

Aluno com matricula ACTIVE chama `GET /api/course/[discipline]/[course]` (ou
`GET /api/course`, ou simplesmente carrega a pagina do curso) e recebe a turma
inteira. Sem pre-condicao alem da matricula.

## Evidencia

`src/core/schemas/course.ts:7-24`

```ts
export const courseSchema = z.object({
  id: courseId,
  ...
  instructor: userInfo,
  enrollments: userInfo.array(),   // { name, username } de todos os matriculados
  ...
});
```

`src/db/services/course.service.ts:385-396` - `fromDb` nao filtra por ator:

```ts
function fromDb(row: DbCourse, actor: Actor): Course {
  return {
    ...row,
    enrollments: row.enrollments.map((e) => ({
      username: e.username,
      name: e.user.name,
    })),
    joinedAt: joinedAtFor(row, actor),
  };
}
```

`src/db/services/enrollment.service.ts:36-42` - a regra contradita.

## Impacto

Divulgacao do roster (nome civil + username) de toda a turma a qualquer colega,
contra a regra que o proprio codebase documenta. Em um LMS isso e dado pessoal
de terceiros. Combinado com a issue do convite sem checagem de posse, um invasor
que se auto-matricula em curso alheio extrai a turma inteira.

## Sugestao de correcao

Separar a forma interna da publica:

- Manter `enrollments` em `courseInclude` (o Prisma precisa dele para a checagem
  de permissao).
- Remover `enrollments` de `courseSchema`; expor `enrollmentCount: z.number()`
  para os cards.
- Quem precisa da lista continua usando `enrollmentService.findMany`, que aplica
  `enrollment.read`.

Ajustar as paginas que hoje leem `course.enrollments` para o novo campo.

## Criterios de aceite

- [ ] `GET /api/course/...` autenticado como aluno matriculado nao devolve
      `enrollments`.
- [ ] A mesma chamada como instrutor do curso ou admin mantem o comportamento
      previsto pela spec.
- [ ] As paginas que mostram contagem usam `enrollmentCount`.
- [ ] Teste de integracao afirma a ausencia do campo para o papel de aluno.
- [ ] `pnpm run lint` passa.
""",
    },
    {
        "n": 6,
        "title": "[Seguranca] Campos de autoria (createdBy, uploaderId) aceitos do corpo da requisicao",
        "labels": "security, severity:media, area:api",
        "body": """## Problema

Dois servicos gravam a autoria a partir da entrada do cliente em vez de derivar
do ator autenticado. Agrupados numa issue so por serem o mesmo defeito e a mesma
correcao.

### 1. `createdBy` do convite

`inviteCreate` mantem `createdBy: userInfo` vindo do cliente, e
`createTx` grava `createdById: input.createdBy.username` sem confronto com
`opts.actor`. As Astro Actions preenchem o campo corretamente, mas
`POST /api/invite` - a superficie que a CLI usa - nao.

Efeito colateral curioso: como o ramo de instrutor de
`invite.read | invite.update | invite.delete` filtra por
`target.createdBy.username === actor.username`, o convite forjado fica invisivel
para quem realmente o criou, e so o admin consegue revoga-lo.

### 2. `uploaderId` do anexo

`attachmentService.create` cobra a quota do ator (`assertWithinQuota`), mas
grava `uploaderId: input.uploaderId ?? username`. A classe esta documentada como
"Not routed" e nao aparece em `src/api/index.ts` - e alcancada apenas por
`resourceService`, que ja confere `course.update-contents`. Por isso hoje o
impacto e contabil, nao de acesso. Entra aqui para que vire um IDOR no dia em
que o servico for exposto.

## Evidencia

`src/core/schemas/invite.ts:21-28`

```ts
export const inviteCreate = inviteSchema
  .omit({ id: true, expiresAt: true, createdAt: true, redemptions: true })
  .extend({ expiresInMs: z.number().int().optional() });
//  -> mantem `createdBy: userInfo`, vindo do cliente
```

`src/db/services/invite.service.ts:79-93`

```ts
const invite = await tx.invite.create({
  data: { ..., createdById: input.createdBy.username },
});
```

`src/db/services/attachment.service.ts:100-111`

```ts
const username = opts.actor === SYSTEM ? null : opts.actor.username;
return this.fromDbWithSource(
  await tx.attachment.create({
    data: { ..., uploaderId: input.uploaderId ?? username },
  }), tx);
```

## Impacto

- Convite: trilha de auditoria de `/admin` e o campo `createdBy` deixam de ser
  confiaveis; o convite forjado escapa da visao do suposto autor. Exige conta
  INSTRUCTOR ou ADMIN com acesso a rota REST.
- Anexo: bytes atribuidos a outro usuario no ledger de armazenamento. Sem efeito
  de acesso enquanto o servico nao for roteado.

## Sugestao de correcao

Regra unica: nenhum campo de autoria chega do corpo da requisicao, exceto em
chamadas `SYSTEM`, que nao tem ator de quem derivar.

- Remover `createdBy` de `inviteCreate`; derivar `createdById` de `opts.actor`
  dentro de `createTx`, exigindo o campo explicito apenas quando
  `opts.actor === SYSTEM`.
- Mesmo tratamento para `uploaderId` em `attachmentService.create`.

## Criterios de aceite

- [ ] `POST /api/invite` com `createdBy` de outro usuario e rejeitado ou
      ignorado; o gravado e sempre o ator.
- [ ] `uploaderId` diferente do ator e ignorado fora de chamadas SYSTEM.
- [ ] Chamadas SYSTEM (seed, comandos `manage`) continuam funcionando.
- [ ] Testes cobrem as duas tentativas de falsificacao.
- [ ] `pnpm run lint` passa.
""",
    },
    {
        "n": 7,
        "title": "[Seguranca] Padronizar renderizacao de Markdown e sanitizacao do nome de arquivo servido",
        "labels": "security, severity:baixa, area:frontend, area:hardening",
        "body": """## Problema

Dois pontos de endurecimento. Nenhum e explorável hoje; ambos dependem de um
comportamento externo para continuar seguros, o que e exatamente o tipo de
protecao que some numa atualizacao de dependencia.

### 1. `new MarkdownIt()` sem opcoes explicitas

`src/pages/[discipline]/[course]/schedule.astro:23` instancia o markdown-it sem
argumentos e renderiza `event.description` com `set:html` na linha 163. Os
outros tres pontos de renderizacao do projeto fixam as opcoes:

```
src/components/question/Markdown.tsx:12
  new MarkdownIt({ html: false, linkify: true, typographer: true })
src/pages/[discipline]/[course]/exams/[slug].astro:36
  new MarkdownIt({ html: false, linkify: true, typographer: true })
src/pages/[discipline]/[course]/resources/[slug].astro:43
  new MarkdownIt({ html: false }).render(data.content)
```

O default do markdown-it 15 ja e `html: false`, e seu `validateLink` bloqueia
`javascript:`, `vbscript:` e `data:` - entao nao ha falha hoje. O risco e que um
bump de major que mude esse default transforme silenciosamente
`event.description` (escrito pelo instrutor, sincronizado pela CLI) em HTML
executavel na sessao de cada aluno, sem que nada no codigo mude.

### 2. Nome de arquivo da URL no Content-Disposition

`/files/[hash]/[name]` passa o segmento decodificado da URL direto para o
cabecalho. `escapeFilename` escapa `\\` e `"`, mas nao CR/LF, e `%0d%0a`
sobrevive a decodificacao do path.

Verificado no runtime alvo (Node 22, undici):
`new Headers({"Content-Disposition": 'attachment; filename="a\\r\\nX-Injected: 1"'})`
lanca `TypeError: invalid header value`. Ou seja, nao ha response splitting - a
excecao escapa do handler e a rota devolve 500 em vez de 404. A protecao vem do
undici, nao do codigo.

## Evidencia

`src/utils/blob-response.ts:19-27`

```ts
function escapeFilename(filename: string): string {
  return filename.replace(/[\\\\"]/g, "\\\\$&");   // escapa \\ e ", mas não CR/LF
}
export function contentDisposition(mimeType: string, filename: string): string {
  const disposition = isInlineMimeType(mimeType) ? "inline" : "attachment";
  return `${disposition}; filename="${escapeFilename(filename)}"`;
}
```

`src/db/services/blob.service.ts:282-287`

```ts
const filename = name ?? attachment.filename;
const headers = new Headers({
  "Content-Type": attachment.mimeType,
  "Content-Disposition": contentDisposition(attachment.mimeType, filename),
  ...blobSecurityHeaders(),
});
```

## Impacto

- Markdown: nenhum hoje; regressao silenciosa para XSS armazenado se o default
  do markdown-it mudar.
- Content-Disposition: 500 em vez de 404 para uma URL maliciosa. Nenhum
  cabecalho injetado no runtime atual.

## Sugestao de correcao

- Extrair uma unica instancia compartilhada de MarkdownIt com `html: false`
  explicito (por exemplo em `src/utils/`) e usa-la nos quatro pontos.
- Aplicar `sanitizeFilename` (ja existente, usado em
  `attachmentService.create`) tambem ao segmento `[name]` antes de montar o
  cabecalho, ou recusar qualquer caractere fora de `[\\w.\\- ]`.

## Criterios de aceite

- [ ] Nenhum `new MarkdownIt()` sem `html: false` explicito no projeto.
- [ ] As quatro chamadas usam o mesmo helper.
- [ ] `GET /files/<hash>/a%0d%0aX:1` responde 404 ou 400, nunca 500.
- [ ] O nome usado no cabecalho passa por `sanitizeFilename`.
- [ ] `pnpm run lint` passa.
""",
    },
]
