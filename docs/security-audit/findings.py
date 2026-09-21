"""
Dados da auditoria de seguranca do Codehood Server.

Separado do gerador do PDF para que uma reauditoria altere apenas este arquivo.
Cada achado aponta para arquivo e linha verificados no commit auditado.
"""

PROJECT = "Codehood Server"
AUDIT_DATE = "20 de setembro de 2026"
COMMIT = "381f36c (branch main, arvore de trabalho suja)"

STACK = [
    ("Linguagem / runtime", "TypeScript (ESM), Node >= 22.12"),
    ("Framework", "Astro 7 em modo `output: \"server\"`, adapter @astrojs/node standalone"),
    ("Frontend", "SolidJS + DaisyUI/Tailwind, ilhas dentro de paginas `.astro`"),
    ("ORM / banco", "Prisma 7 + SQLite (adapter better-sqlite3)"),
    ("Autenticacao", "Cookie de sessao (token aleatorio, SHA-256 no banco) + Bearer API key"),
    ("Autorizacao", "Tabela declarativa de permissoes em `src/auth/permissions/index.ts`"),
    ("Superficies de API", "REST gerada por registry (`src/api/`), Astro Actions (`src/actions/`), JSON-RPC (`/rpc`)"),
    ("Deploy", "Nenhum Dockerfile/Helm/Terraform no repositorio. CI: GitHub Actions (lint + testes)"),
]

METHODOLOGY = [
    (
        "1. Banco sem tranca (isolamento)",
        "Nao ha Supabase nem RLS. O isolamento e feito em duas camadas dentro das classes de "
        "servico em `src/db/services/`: um fragmento `where` do Prisma (`courseWhere`, "
        "`userWhere`, `inviteWhere`, `questionWhere`, `courseContentsWhere`) que restringe a "
        "consulta, seguido de um laco `hasPerm(...)` sobre cada linha retornada. O inquilino e "
        "o curso (dono = instrutor; membros = matriculas ACTIVE). Auditamos toda consulta de "
        "listagem, busca e exportacao a procura de uma das duas camadas ausente.",
    ),
    (
        "2. Permissao definida no navegador",
        "Cada gate de papel do frontend (`hasPerm` em paginas `.astro`, `canManage`, `canWrite`, "
        "`adminMiddleware`, abas de `CourseHeader`) foi cruzado com o endpoint REST, a Astro "
        "Action e o metodo RPC correspondentes, verificando se o servidor repete a checagem.",
    ),
    (
        "3. IDOR",
        "Percorremos todos os handlers das tres superficies: as rotas CRUD geradas por "
        "`src/api/registry/crud.ts` para 10 entidades, as 18 Astro Actions e os metodos RPC. "
        "Para cada uma verificamos se o objeto e carregado e conferido contra o ator antes de "
        "ser lido, alterado ou removido.",
    ),
    (
        "4. Chaves expostas",
        "Varredura do codigo, de `.env`/`.env.example`, do workflow de CI, dos scripts e da "
        "documentacao. Alem de literais, procuramos defaults inseguros de variavel de ambiente "
        "e ausencia de validacao de startup. O historico completo do git (44 commits) foi "
        "varrido por segredos ja commitados.",
    ),
    (
        "5. Inputs sem tratamento (XSS)",
        "Sinks do Astro (`set:html`, `define:vars`) e do Solid (`innerHTML`), renderizacao de "
        "Markdown, `eval`/`new Function`, URLs controladas pelo usuario e montagem de "
        "cabecalhos HTTP a partir da URL.",
    ),
]

SEV_ORDER = ["critical", "high", "medium", "low", "info"]

SEV_COLOR = {
    "critical": "#B91C1C",
    "high": "#EA580C",
    "medium": "#D97706",
    "low": "#2563EB",
    "info": "#6B7280",
    "strength": "#059669",
}

CATEGORIES = {
    "isolamento": "1. Banco sem tranca (isolamento de dono/curso)",
    "frontend-perm": "2. Permissao definida no navegador",
    "idor": "3. IDOR",
    "segredos": "4. Chaves expostas e defaults inseguros",
    "xss": "5. Inputs sem tratamento (XSS)",
}

FINDINGS = [
    {
        "id": "F1",
        "sev": "high",
        "cat": "xss",
        "title": "XSS armazenado no roster: JSON do aluno injetado dentro de <script> sem escape",
        "loc": [("src/pages/[discipline]/[course]/roster.astro", "448-452")],
        "code": '''<script
  type="application/json"
  id="roster-csv-data"
  set:html={JSON.stringify(csvRows)}
/>''',
        "extra_code": [
            (
                "src/pages/[discipline]/[course]/roster.astro:93-103",
                '''const csvRows = [
  ["Name", "Username", "Email", "GitHub", "School ID", "Enrolled"],
  ...students.map((s) => [
    s.name, s.username, s.email, s.githubId, s.schoolId,
    s.enrolledAt.toISOString().slice(0, 10),
  ]),
];''',
            ),
            (
                "src/core/schemas/user.ts:40-51 (userUpdate, aplicado pelo proprio aluno)",
                '''export const userUpdate = userSchema
  .pick({ name: true, email: true, githubId: true, schoolId: true })
  .extend({ password: z.string().min(1).optional() })
  .partial()
  .strict();''',
            ),
        ],
        "why": (
            "`set:html` e o escape hatch do Astro: o valor e escrito cru no HTML. `JSON.stringify` "
            "protege aspas e barras invertidas, mas nao escapa `</script`, e o parser HTML "
            "encerra o elemento nesse ponto mesmo com `type=\"application/json\"`. Os campos "
            "`name`, `email`, `githubId` e `schoolId` sao gravados pelo proprio aluno via "
            "`actions.profile.update` ou `PATCH /api/user/me`, e `name` so exige `min(1)`. "
            "Verificado: `JSON.stringify([\"</script><img src=x onerror=alert(1)>\"])` devolve a "
            "sequencia intacta."
        ),
        "impact": (
            "Um aluno matriculado define o proprio nome como "
            "`</script><img src=x onerror=...>`; o script roda toda vez que o instrutor (ou um "
            "admin) abre a aba Students do curso. O cookie de sessao e `httpOnly`, mas o "
            "payload age em nome da vitima na mesma origem: criar convites, apagar conteudo do "
            "curso e - encadeando com o F2 - trocar a senha do instrutor sem conhecer a atual, "
            "o que e tomada de conta completa. Se a vitima for admin, e comprometimento total "
            "da instancia."
        ),
        "fix": (
            "Nao usar `set:html` para dados. Serializar com um escape de `<`/`>`/`&` (por "
            "exemplo `JSON.stringify(x).replace(/</g, \"\\\\u003c\")`) ou, melhor, passar as "
            "linhas por `define:vars`, que o Astro ja escapa, ou montar o CSV em um endpoint "
            "autenticado."
        ),
        "criteria": [
            "O roster renderiza literalmente um aluno chamado `</script><img src=x onerror=alert(1)>` sem executar nada.",
            "Nenhum `set:html` do projeto recebe dado originado de entrada de usuario.",
            "Teste de regressao em `test/` cria um aluno com nome contendo `</script>` e afirma que a pagina do roster nao contem `<img`.",
        ],
        "exploitable": "Sem pre-condicao: basta uma conta de aluno matriculada no curso.",
    },
    {
        "id": "F2",
        "sev": "high",
        "cat": "frontend-perm",
        "title": "Troca de senha pela API nao exige a senha atual, ao contrario da UI",
        "loc": [
            ("src/api/index.ts", "142-153"),
            ("src/core/schemas/user.ts", "40-51"),
            ("src/db/services/user.service.ts", "161-192"),
        ],
        "code": '''updateMe: PATCH("/api/user/me", {
  in: schema.userUpdate,                       // userUpdate inclui `password`
  out: schema.userSchema.omit({ passwordHash: true }),
  handler: async (args) => {
    return db.user.update({ username: args.actor.username }, args.body, {
      actor: args.actor,
    });
  },
}),''',
        "extra_code": [
            (
                "src/actions/profile.ts:68-91 - o caminho da UI, que exige a senha atual",
                '''changePassword: defineAction({
  input: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  }),
  handler: async (input, context) => {
    const actor = requireUser(context);
    const user = await db.user.findOne({ username: actor.username }, { actor });
    if (!user || !(await verifyPassword(user.passwordHash, input.currentPassword)))
      throw new ActionError({ code: "UNAUTHORIZED", ... });
    await db.user.updatePassword(user, input.newPassword, { actor });
  },
}),''',
            ),
            (
                "src/db/services/user.service.ts:174-188 - o servico so checa forca da senha",
                '''if (password) {
  const issues = await passwordStrengthIssues(password);
  InvalidData.ensureNoError({ password: issues });
}
return toUser(await tx.user.update({
  where: { username: target.username },
  data: { ...rest, ...(password !== undefined
    ? { passwordHash: await hashPassword(password) } : {}) },
}));''',
            ),
        ],
        "why": (
            "A regra \"para trocar a senha, prove que sabe a atual\" existe apenas no handler da "
            "Astro Action que a tela `/profile` usa. O mesmo efeito e alcancado por "
            "`PATCH /api/user/me` com corpo `{\"password\": \"...\"}`, que passa pela permissao "
            "`user.update` (o ator e o proprio alvo) e reescreve o hash sem nenhuma reprova de "
            "credencial. O endpoint aceita tanto o cookie de sessao quanto uma API key Bearer."
        ),
        "impact": (
            "Qualquer captura momentanea de sessao vira posse permanente da conta: XSS (F1), "
            "uma estacao deixada aberta, ou uma API key de robo de correcao vazada em log de CI "
            "- todas se convertem em troca de senha e bloqueio do dono legitimo. Tambem remove "
            "a ultima barreira contra escalada quando a vitima e admin."
        ),
        "fix": (
            "Remover `password` de `userUpdate` e expor a troca de senha por uma rota propria "
            "(`POST /api/user/me/password`) que exija `currentPassword`, reutilizando a logica "
            "de `profile.changePassword`. Trocar a senha deve tambem invalidar as demais "
            "sessoes e API keys do usuario."
        ),
        "criteria": [
            "`PATCH /api/user/me` com `password` no corpo responde 400/404 e nao altera o hash.",
            "Existe rota dedicada que exige `currentPassword` e a valida com `verifyPassword`.",
            "Trocar a senha revoga as demais sessoes do usuario.",
            "Teste de integracao cobre os dois caminhos.",
        ],
        "exploitable": "Sem pre-condicao: qualquer credencial valida (cookie ou Bearer) do proprio usuario.",
    },
    {
        "id": "F3",
        "sev": "high",
        "cat": "idor",
        "title": "Convite de turma nao valida a posse do curso: instrutor matricula alunos no curso alheio",
        "loc": [
            ("src/db/services/invite.service.ts", "72-97"),
            ("src/auth/permissions/index.ts", "193-198"),
            ("src/actions/auth.ts", "163-183"),
        ],
        "code": '''protected async createTx(tx, input: InviteCreate, opts) {
  ensurePerm(opts.actor, "invite.create", { invitedRole: input.invitedRole });
  const token = generateToken();
  const invite = await tx.invite.create({
    data: {
      ...,
      courseId: input.courseId,          // <- nunca confrontado com o ator
      createdById: input.createdBy.username,
    },
    include: inviteInclude,
  });''',
        "extra_code": [
            (
                "src/auth/permissions/index.ts:193-198 - a regra so olha o papel convidado",
                '''"invite.create": {
  admin: (_, target) => target.invitedRole !== "ADMIN",
  instructor: (_, target) => target.invitedRole === "STUDENT",
  student: false,
  audit: (target) => ({ invitedRole: target.invitedRole }),
} satisfies PermDef<InviteCreateTarget>,''',
            ),
            (
                "src/actions/auth.ts:57-116 - o resgate matricula como SYSTEM, sem nova checagem",
                '''if (invite.courseId) {
  await db.enrollment.create(
    { courseId: invite.courseId, username: createdUser.username },
    { ...FULL_ACCESS, tx },
  );
}''',
            ),
        ],
        "why": (
            "`InviteCreateTarget` carrega apenas `invitedRole`, entao a permissao nao tem como "
            "olhar `courseId`. Nem a Action `createClassroomInvite`, nem "
            "`createPersonalInvite`, nem `POST /api/invite` carregam o curso para conferir o "
            "dono. Todas as demais escritas ligadas a curso (`enrollment.create`, `exam`, "
            "`question`, `resource`, `time-slot`, `calendar-event`, `passphrase`) fazem essa "
            "checagem - convite e a unica que nao faz. O resgate em `actions/auth.ts` roda "
            "como `FULL_ACCESS`, portanto tambem nao repara o buraco."
        ),
        "impact": (
            "O instrutor A emite um link de turma para o curso do instrutor B. Quem resgatar "
            "vira aluno ACTIVE de B, e com isso ganha `course.read-contents`: provas "
            "publicadas, recursos, calendario e a lista completa de matriculados (ver F5) do "
            "curso de B. A permite popular o curso alheio com contas que controla, o que "
            "corrompe o roster e qualquer nota futura."
        ),
        "fix": (
            "Estender o alvo de `invite.create` para `{ invitedRole, course }` e exigir "
            "`enrollment.manage` (ou `course.update-contents`) sobre o curso quando `courseId` "
            "for informado; carregar o curso em `createTx` antes do `ensurePerm`, como fazem "
            "`timeSlotService.create` e `calendarEventService.create`."
        ),
        "criteria": [
            "Instrutor A recebe 403 ao criar convite com `courseId` de um curso de B, pela Action e pela rota REST.",
            "Admin que nao leciona o curso segue o comportamento decidido e documentado na spec.",
            "Convite sem `courseId` continua funcionando para o papel permitido.",
            "Teste de regressao cobre o caso cruzado.",
        ],
        "exploitable": "Requer conta com papel INSTRUCTOR (ou ADMIN). Aluno e barrado por `student: false`.",
    },
    {
        "id": "F4",
        "sev": "high",
        "cat": "segredos",
        "title": "Contas padrao admin/admin criadas em runtime, atras de dois interruptores de producao divergentes",
        "loc": [
            ("src/core/constants.ts", "56-73"),
            ("src/middleware.ts", "74-95"),
            ("src/db/bootstrap.ts", "17-56"),
        ],
        "code": '''// src/core/constants.ts:57
export const ENVIRONMENT = assertIn(readEnv("ENVIRONMENT", "dev"), ["dev", "prod"]);
export const PRODUCTION = ENVIRONMENT === "prod";
export const SESSION_COOKIE_OPTIONS = { httpOnly: true, secure: PRODUCTION, ... };

// src/middleware.ts:92-95
export const onRequest = env.ENVIRONMENT === "dev"
  ? sequence(...DEVELOPMENT_MIDDLEWARES, ...COMMON_MIDDLEWARES)
  : sequence(...COMMON_MIDDLEWARES);''',
        "extra_code": [
            (
                "src/db/bootstrap.ts:17-56 - outro interruptor, outra variavel",
                '''export function ensureDevAdmin(): Promise<void> {
  if (process.env.NODE_ENV === "production") { ...; return Promise.resolve(); }
  devAdminPromise ??= createDevAdminIfMissing();
  return devAdminPromise;
}
...
await demoUser({ email: DEV_ADMIN_EMAIL, username: "admin", name: "Admin",
                 role: "ADMIN", password: DEV_ADMIN_USERNAME });   // senha = "admin"''',
            ),
            (
                "src/actions/auth.ts:12-17 - um terceiro interruptor, resolvido em build time",
                '''const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  secure: import.meta.env.PROD,
  sameSite: "lax" as const,
  path: "/",
};''',
            ),
        ],
        "why": (
            "Nao ha segredo em texto claro no repositorio - o problema sao os defaults. "
            "`ENVIRONMENT` tem default `\"dev\"`, e nada no startup recusa esse valor. Com ele, "
            "`devBootstrapMiddleware` entra na cadeia e roda `ensureDevAdmin()` no primeiro "
            "request. Essa funcao consulta uma variavel *diferente*, `NODE_ENV`, e, se o banco "
            "estiver vazio, cria `admin/admin`, `instructor/instructor` e `student/student` "
            "mais os cursos de demonstracao. Verificado no build: "
            "`dist/server/virtual_astro_middleware.mjs:16` mantem "
            "`process.env.NODE_ENV === \"production\"` como teste de runtime, ou seja, subir "
            "`node dist/server/entry.mjs` sem exportar nenhuma das duas variaveis basta. "
            "Como efeito colateral, `ENVIRONMENT` != `\"prod\"` tambem deixa o cookie de sessao "
            "sem a flag `Secure`. O README e o AGENTS.md nao mencionam nenhuma das variaveis."
        ),
        "impact": (
            "Instancia publicada com as variaveis de ambiente esquecidas fica com um "
            "administrador de senha `admin` acessivel na tela de login - comprometimento total "
            "e trivial de descobrir. Na mesma condicao, o cookie de sessao trafega sem `Secure`."
        ),
        "fix": (
            "Unificar em um unico interruptor (`ENVIRONMENT`), sem default: falhar o boot se a "
            "variavel nao estiver definida. Mover o seed de desenvolvimento para fora do "
            "middleware, deixando-o apenas no script de seed explicito. Se as contas de demo "
            "permanecerem, gerar senha aleatoria e imprimi-la uma unica vez no log."
        ),
        "criteria": [
            "Subir o servidor sem `ENVIRONMENT` definido falha com mensagem clara em vez de assumir `dev`.",
            "Nenhum caminho de request cria usuario; o seed so roda por `pnpm run db:seed`.",
            "`secure`, `httpOnly` e `sameSite` do cookie derivam de um unico ponto compartilhado por `src/api/auth.ts` e `src/actions/auth.ts`.",
            "README documenta as variaveis obrigatorias de producao.",
        ],
        "exploitable": (
            "Requer deploy com `ENVIRONMENT` e `NODE_ENV` ausentes (ou nao iguais a "
            "`prod`/`production`) e banco ainda sem usuarios. Nao e exploravel em uma instancia "
            "ja povoada, porque `createDevAdminIfMissing` desiste quando encontra qualquer "
            "usuario."
        ),
    },
    {
        "id": "F5",
        "sev": "medium",
        "cat": "isolamento",
        "title": "Lista completa de matriculados devolvida a qualquer aluno do curso",
        "loc": [
            ("src/core/schemas/course.ts", "13"),
            ("src/db/services/course.service.ts", "385-396"),
            ("src/api/index.ts", "25-38"),
        ],
        "code": '''// src/core/schemas/course.ts:7-24
export const courseSchema = z.object({
  id: courseId,
  ...
  instructor: userInfo,
  enrollments: userInfo.array(),   // { name, username } de todos os matriculados
  ...
});''',
        "extra_code": [
            (
                "src/db/services/course.service.ts:385-396 - `fromDb` nao filtra por ator",
                '''function fromDb(row: DbCourse, actor: Actor): Course {
  return {
    ...row,
    instructor: row.instructor,
    enrollments: row.enrollments.map((e) => ({
      username: e.username,
      name: e.user.name,
    })),
    joinedAt: joinedAtFor(row, actor),
  };
}''',
            ),
            (
                "src/db/services/enrollment.service.ts:36-42 - a regra que o vazamento contradiz",
                '''/**
 * Dropping marks the row `DROPPED` rather than deleting it, so re-enrolling
 * keeps history. Students cannot list their classmates, a privacy default
 * rather than a technical limit.
 */''',
            ),
        ],
        "why": (
            "`enrollments` e carregado em `courseInclude` para alimentar a propria permissao "
            "`course.read` (decidir se o ator e membro) e o contador exibido no card, mas "
            "segue inteiro para a saida. Como `enrollments` esta declarado em `courseSchema`, "
            "o `options.out.parse(value)` de `src/api/registry/route.ts:215` - que existe "
            "justamente para podar campos nao declarados - o preserva. Resultado: o aluno "
            "matriculado recebe nome e username de toda a turma em "
            "`GET /api/course/[discipline]/[course]`, em `GET /api/course` e no payload da "
            "pagina do curso. A permissao `enrollment.read`, que restringe a listagem ao dono "
            "do curso, e simplesmente contornada por outra rota."
        ),
        "impact": (
            "Divulgacao do roster (nome civil + username) de toda a turma a qualquer colega, "
            "ao contrario da regra que o proprio servico de matricula documenta e aplica. Em "
            "um LMS isso e dado pessoal de terceiros; combinado com o F3, um invasor que se "
            "auto-matricula em curso alheio extrai a turma inteira."
        ),
        "fix": (
            "Separar a forma interna da publica: manter `enrollments` no include do Prisma para "
            "a checagem de permissao, mas tirar do `courseSchema`, substituindo por "
            "`enrollmentCount` para o card. Quem precisa da lista ja tem "
            "`enrollmentService.findMany`, que aplica `enrollment.read`."
        ),
        "criteria": [
            "`GET /api/course/...` autenticado como aluno matriculado nao devolve `enrollments`.",
            "A mesma chamada como instrutor do curso ou admin mantem o comportamento esperado pela spec.",
            "As paginas que mostram a contagem passam a usar o novo campo.",
            "Teste de integracao afirma a ausencia do campo para o papel de aluno.",
        ],
        "exploitable": "Sem pre-condicao: qualquer aluno com matricula ACTIVE no curso.",
    },
    {
        "id": "F6",
        "sev": "medium",
        "cat": "idor",
        "title": "`createdBy` do convite vem do corpo da requisicao, permitindo forjar a autoria",
        "loc": [
            ("src/core/schemas/invite.ts", "21-28"),
            ("src/db/services/invite.service.ts", "90"),
        ],
        "code": '''// src/core/schemas/invite.ts:21-28
export const inviteCreate = inviteSchema
  .omit({ id: true, expiresAt: true, createdAt: true, redemptions: true })
  .extend({ expiresInMs: z.number().int().optional() });
//  -> mantem `createdBy: userInfo`, vindo do cliente

// src/db/services/invite.service.ts:79-93
const invite = await tx.invite.create({
  data: { ..., createdById: input.createdBy.username },
});''',
        "why": (
            "`POST /api/invite` aceita `createdBy` do cliente e o grava sem confronto com "
            "`opts.actor`. As Astro Actions preenchem o campo corretamente com o ator, mas a "
            "rota REST e a superficie que a CLI usa. A permissao `invite.create` nao inspeciona "
            "esse campo."
        ),
        "impact": (
            "Um instrutor emite convites que aparecem, para o admin, como emitidos por outra "
            "pessoa - a trilha de auditoria de `/admin` e o proprio campo `createdBy` deixam de "
            "ser confiaveis. Efeito colateral: como `invite.read` do instrutor filtra por "
            "`createdBy.username`, o convite forjado fica invisivel para quem realmente o criou "
            "e revogavel apenas pelo admin."
        ),
        "fix": (
            "Remover `createdBy` de `inviteCreate` e derivar `createdById` de `opts.actor` "
            "dentro do servico (`SYSTEM` continua precisando informa-lo explicitamente)."
        ),
        "criteria": [
            "`POST /api/invite` com `createdBy` de outro usuario e rejeitado ou ignorado.",
            "O convite gravado tem sempre `createdById` igual ao ator (exceto chamadas SYSTEM).",
            "Teste cobre a tentativa de falsificacao.",
        ],
        "exploitable": "Requer conta INSTRUCTOR ou ADMIN, com acesso a rota REST.",
    },
    {
        "id": "F7",
        "sev": "low",
        "cat": "xss",
        "title": "`new MarkdownIt()` sem opcoes explicitas em schedule.astro, fora do padrao dos demais pontos",
        "loc": [("src/pages/[discipline]/[course]/schedule.astro", "23, 163")],
        "code": '''// linha 23
const md = new MarkdownIt();
// linha 163
set:html={md.render(event.description)}''',
        "extra_code": [
            (
                "Os outros tres pontos fixam as opcoes",
                '''src/components/question/Markdown.tsx:12
  new MarkdownIt({ html: false, linkify: true, typographer: true })
src/pages/[discipline]/[course]/exams/[slug].astro:36
  new MarkdownIt({ html: false, linkify: true, typographer: true })
src/pages/[discipline]/[course]/resources/[slug].astro:43
  new MarkdownIt({ html: false }).render(data.content)''',
            ),
        ],
        "why": (
            "Hoje nao e explorável: o default do markdown-it ja e `html: false`, e seu "
            "`validateLink` bloqueia `javascript:`, `vbscript:` e `data:`. O achado e de "
            "consistencia: este e o unico dos quatro pontos de renderizacao cujo comportamento "
            "seguro depende do default de uma dependencia em vez de estar escrito no codigo. "
            "Um bump de major version que mude o default transforma silenciosamente "
            "`event.description` - escrito pelo instrutor e sincronizado pela CLI - em HTML "
            "executavel na sessao de cada aluno."
        ),
        "impact": "Nenhum hoje. Regressao silenciosa para XSS armazenado em caso de mudanca de default.",
        "fix": "Extrair uma unica instancia compartilhada de MarkdownIt com `{ html: false }` explicito e usar nos quatro pontos.",
        "criteria": [
            "Nenhum `new MarkdownIt()` sem `html: false` explicito no projeto.",
            "As quatro chamadas usam o mesmo helper.",
        ],
        "exploitable": "Nao explorável na versao atual de markdown-it (15.x). Condicional a mudanca de default upstream.",
    },
    {
        "id": "F8",
        "sev": "low",
        "cat": "xss",
        "title": "Nome de arquivo vindo da URL entra no Content-Disposition sem filtrar CR/LF",
        "loc": [
            ("src/utils/blob-response.ts", "19-27"),
            ("src/db/services/blob.service.ts", "282-287"),
            ("src/pages/files/[hash]/[name].ts", "6-7"),
        ],
        "code": '''// src/utils/blob-response.ts:19-27
function escapeFilename(filename: string): string {
  return filename.replace(/[\\\\"]/g, "\\\\$&");   // escapa \\ e ", mas não CR/LF
}
export function contentDisposition(mimeType: string, filename: string): string {
  const disposition = isInlineMimeType(mimeType) ? "inline" : "attachment";
  return `${disposition}; filename="${escapeFilename(filename)}"`;
}''',
        "extra_code": [
            (
                "src/db/services/blob.service.ts:282-287 - `name` e o segmento cru da URL",
                '''const filename = name ?? attachment.filename;
const headers = new Headers({
  "Content-Type": attachment.mimeType,
  "Content-Disposition": contentDisposition(attachment.mimeType, filename),
  ...blobSecurityHeaders(),
});''',
            ),
        ],
        "why": (
            "`/files/[hash]/[name]` passa o segmento decodificado da URL direto para o "
            "cabecalho. `%0d%0a` sobrevive a decodificacao e a `escapeFilename`. Verificamos o "
            "comportamento no runtime alvo (Node 22, undici): "
            "`new Headers({\"Content-Disposition\": 'attachment; filename=\"a\\r\\nX-Injected: 1\"'})` "
            "lanca `TypeError: invalid header value`. Portanto nao ha response splitting - a "
            "excecao escapa do handler e a rota devolve 500."
        ),
        "impact": (
            "Erro 500 em vez de 404 para uma URL maliciosa daquele blob; nenhum cabecalho "
            "injetado. O risco real e de defesa em profundidade: a protecao vem do undici, nao "
            "do codigo, e qualquer troca de runtime ou de caminho de resposta a remove."
        ),
        "fix": "Sanitizar `name` com o mesmo `sanitizeFilename` usado em `attachmentService.create`, ou rejeitar qualquer caractere fora de `[\\w.\\- ]` antes de montar o cabecalho.",
        "criteria": [
            "`GET /files/<hash>/a%0d%0aX:1` responde 404 ou 400, nunca 500.",
            "O nome usado no cabecalho passa por `sanitizeFilename`.",
        ],
        "exploitable": "Parcialmente: causa 500, nao injecao. Requer conhecer um hash de blob valido (que e publico por design).",
    },
    {
        "id": "F9",
        "sev": "low",
        "cat": "idor",
        "title": "`uploaderId` do anexo aceita outro usuario, desviando a contabilidade de quota",
        "loc": [("src/db/services/attachment.service.ts", "84-115")],
        "code": '''const username = opts.actor === SYSTEM ? null : opts.actor.username;
return this.fromDbWithSource(
  await tx.attachment.create({
    data: {
      ...,
      uploaderId: input.uploaderId ?? username,   // input vence o ator
    },
  }), tx);''',
        "why": (
            "`assertWithinQuota` cobra a quota do ator, mas a linha gravada atribui a autoria a "
            "`input.uploaderId` quando presente. A classe esta documentada como \"Not routed\" e "
            "nao aparece em `src/api/index.ts`: e alcancada apenas por `resourceService`, que "
            "ja confere `course.update-contents`. Por isso o impacto hoje e contabil, nao de "
            "acesso."
        ),
        "impact": "Bytes atribuidos a outro usuario no ledger de armazenamento; sem efeito de acesso enquanto o servico nao for roteado.",
        "fix": "Aceitar `uploaderId` apenas quando `opts.actor === SYSTEM`; caso contrario derivar do ator.",
        "criteria": [
            "`uploaderId` diferente do ator e ignorado (ou rejeitado) fora de chamadas SYSTEM.",
            "Se o servico for roteado no futuro, existe teste cobrindo a regra.",
        ],
        "exploitable": "Nao explorável por HTTP hoje: servico nao roteado. Listado porque vira um IDOR no dia em que for exposto.",
    },
    {
        "id": "F10",
        "sev": "info",
        "cat": "isolamento",
        "title": "Blobs servidos sem autenticacao, por decisao de projeto",
        "loc": [
            ("src/db/services/blob.service.ts", "243-289"),
            ("src/pages/files/[hash].ts", "6-7"),
        ],
        "code": '''/**
 * ... No authentication check by design
 * (FR-NFR-030, amended): the URL is the content's own hash, and nothing
 * whose disclosure matters is meant to live in a resource (FR-NFR-032).
 */
async serve(hash: string | undefined, name: string | undefined): Promise<Response> {''',
        "why": (
            "Escolha documentada: a URL e o hash do conteudo e funciona como capability. Nao e "
            "um controle esquecido. Registrado para que a decisao seja revisitada "
            "conscientemente se algum dia um recurso passar a conter material restrito (prova "
            "nao publicada, gabarito em PDF, dado de aluno)."
        ),
        "impact": "Quem obtiver o hash le os bytes, sem sessao. Aceito pela spec.",
        "fix": "Nenhuma acao enquanto a premissa FR-NFR-032 valer. Se mudar, exigir `course.read-contents` sobre o recurso que aponta para o blob.",
        "criteria": [
            "A premissa esta registrada na spec e revisada quando anexos passarem a carregar material restrito.",
        ],
        "exploitable": "Por design. Requer conhecer o hash (256 bits) do conteudo.",
    },
]

STRENGTHS = [
    (
        "Permissoes declarativas com verificacao em tempo de compilacao",
        "src/auth/permissions/index.ts:145-293",
        "Toda regra vive em um unico objeto `PERMISSIONS`, e os tipos `_AssertPermissionsKeys`, "
        "`_AssertPermissionsUnique` e `_AssertPermissionsAudited` fazem o `tsc` recusar uma "
        "permissao com nome fora do vocabulario, duplicada ou sem reducao de auditoria. Um "
        "`hasPerm` com alvo do tipo errado nao compila.",
    ),
    (
        "Isolamento em duas camadas nas listagens",
        "course.service.ts:301-317, user.service.ts:310-313, invite.service.ts:278-282, question.service.ts:456-468",
        "Cada `findMany` combina um fragmento `where` do Prisma que restringe a consulta com um "
        "laco `hasPerm` sobre o resultado. Conferimos `course`, `user`, `invite`, `question`, "
        "`resource`, `exam`, `time-slot`, `calendar-event`, `api-key`, `passphrase` e "
        "`enrollment`: todas as onze aplicam pelo menos uma das camadas, e nove aplicam as duas.",
    ),
    (
        "Rotas CRUD geradas, nao escritas a mao",
        "src/api/registry/crud.ts:307-527",
        "As 10 entidades REST compartilham um unico gerador que delega ao servico passando "
        "sempre `{ actor }`. Nao ha handler artesanal onde o ator possa ser esquecido, que e o "
        "modo de falha classico de IDOR em API propria.",
    ),
    (
        "Saida podada pelo schema de resposta",
        "src/api/registry/route.ts:211-215",
        "`options.out.parse(value)` remove qualquer campo nao declarado antes do `Response.json`. "
        "E o que impede, por exemplo, `passwordHash` de escapar por `GET /api/user/[username]`, "
        "cujo `entity` e `userSchema.pick({ username, name })`.",
    ),
    (
        "Gabarito de questao nunca sai da consulta",
        "src/db/services/question.service.ts:65-87, 193-231",
        "`questionInclude(includePrivate)` decide na propria query se `privatePayload` e "
        "selecionado. O aluno nao recebe o gabarito filtrado depois - ele nunca e lido do "
        "banco. A segunda consulta, com a metade privada, so e emitida apos `course."
        "update-contents` ser concedido.",
    ),
    (
        "Guarda unica para /admin",
        "src/middleware.ts:42-50",
        "`adminMiddleware` exige `system.manage` para todo o prefixo `/admin`, em vez de duas "
        "linhas repetidas no topo de cada pagina. As Actions administrativas ainda assim "
        "revalidam no servico (`edition.create`, `discipline.delete`, `user.create`, "
        "`session.manage`), de modo que a protecao nao depende do caminho da URL.",
    ),
    (
        "Credenciais armazenadas corretamente",
        "src/auth/password.ts:10-18, src/auth/token.ts:6-14",
        "Argon2id com os parametros do baseline OWASP (m=19456, t=2, p=1). Tokens de sessao, "
        "API key e convite sao 32 bytes de `randomBytes`, persistidos apenas como SHA-256 e "
        "exibidos em claro uma unica vez. A forca da senha e checada contra lista de comuns e "
        "contra vazamentos (`wildleek`).",
    ),
    (
        "Nenhum segredo no codigo nem no historico",
        ".env.example, .github/workflows/ci.yml:78, 44 commits",
        "O unico `.env` versionado e o exemplo, com apenas `DATABASE_URL`. O CI usa "
        "`${{ secrets.CODECOV_TOKEN }}`. A varredura dos 44 commits nao encontrou chave, "
        "certificado ou banco commitado - apenas senhas de fixture de teste "
        "(`correct-horse-battery-staple`), que nao sao credenciais reais.",
    ),
    (
        "Travessia de diretorio barrada no armazenamento de blobs",
        "src/db/services/blob.service.ts:298-315, 256-263",
        "`attachmentPath` resolve o caminho e recusa qualquer nome cujo diretorio final saia do "
        "diretorio do blob. `serve` valida o hash contra `blobHash` antes de tocar o disco, o "
        "que descarta `..` e maiusculas.",
    ),
    (
        "Allowlist de MIME para exibicao inline",
        "src/utils/blob-response.ts:1-35",
        "So imagem, audio, video e PDF sao servidos `inline`; `image/svg+xml` e explicitamente "
        "excluido e todo o resto vira `attachment`, sempre com `X-Content-Type-Options: "
        "nosniff`. Um `.html` enviado por instrutor nao executa na origem da aplicacao.",
    ),
    (
        "Autenticacao resolvida antes do handler nas tres superficies",
        "src/api/registry/route.ts:183-188, src/rpc/registry/index.ts:47-55, src/middleware.ts:42-50",
        "REST, RPC e paginas recusam o anonimo antes de validar parametros, o que evita usar "
        "mensagens de erro para sondar a forma de metodos que o chamador nao pode invocar.",
    ),
    (
        "Semantica de PUT consistente com a de POST",
        "src/db/base-service.ts:134-145",
        "O helper `upsert` exige um `assertCreatable` que roda no ramo de update, garantindo "
        "que um `PUT` nao conceda escrita mais ampla do que o `POST` equivalente - um caminho "
        "de escalada que costuma passar despercebido.",
    ),
]

WEAKNESSES = [
    "O convite e a unica escrita ligada a curso que nao confere a posse do curso (F3), num "
    "codebase em que todas as outras conferem. E uma lacuna pontual, nao sistemica - mas "
    "concede matricula, que e a chave de leitura de todo o conteudo do curso.",
    "Duas regras de negocio existem apenas na Astro Action e nao na rota REST equivalente: a "
    "senha atual na troca de senha (F2) e a autoria do convite (F6). O padrao do projeto - "
    "controlador fino sobre servico - e o certo; esses dois casos escaparam dele.",
    "Configuracao de producao depende de tres interruptores diferentes (`ENVIRONMENT`, "
    "`NODE_ENV`, `import.meta.env.PROD`), todos com default inseguro e nenhum validado no "
    "startup (F4). O modo de falha e silencioso: o servidor sobe normalmente.",
    "`courseSchema` mistura a forma interna (matriculas usadas pela checagem de permissao) com "
    "a forma publica (F5), e o `out.parse` - que e a defesa contra vazamento de campo - "
    "obedece ao schema, entao nao ajuda quando o proprio schema esta largo demais.",
    "Um unico `set:html` recebendo dado de usuario (F1) anula boa parte do cuidado do restante "
    "da aplicacao, porque o alvo e sempre uma sessao mais privilegiada que a do atacante.",
]

RECOMMENDATIONS = [
    (
        "P1",
        "Fechar o XSS armazenado do roster (F1)",
        "Trocar `set:html={JSON.stringify(csvRows)}` por uma serializacao que escape `<`, ou "
        "por `define:vars`. E o unico achado que da execucao de codigo na sessao de outra "
        "pessoa, e encadeia com o F2 ate tomada de conta.",
    ),
    (
        "P1",
        "Exigir a senha atual em toda troca de senha (F2)",
        "Tirar `password` de `userUpdate`, criar rota dedicada com `currentPassword`, e "
        "invalidar as demais sessoes e API keys apos a troca. Isso tambem rebaixa o impacto do "
        "F1 de tomada de conta para acao pontual.",
    ),
    (
        "P1",
        "Definir o ambiente de producao de forma explicita e unica (F4)",
        "Um so interruptor, sem default, com falha no boot se ausente; seed de desenvolvimento "
        "fora do middleware de request. Enquanto isso nao for feito, publicar sempre com "
        "`ENVIRONMENT=prod` e `NODE_ENV=production` e conferir que nao existe usuario `admin`.",
    ),
    (
        "P2",
        "Validar a posse do curso na criacao de convite (F3)",
        "Ampliar o alvo de `invite.create` para incluir o curso e exigir `enrollment.manage` "
        "quando `courseId` for informado, alinhando o convite ao que as outras onze escritas "
        "de curso ja fazem.",
    ),
    (
        "P2",
        "Separar a forma interna da publica em `courseSchema` (F5)",
        "Manter `enrollments` no include do Prisma para a checagem de permissao, remover do "
        "schema de saida, expor `enrollmentCount` para os cards.",
    ),
    (
        "P2",
        "Derivar `createdBy`/`uploaderId` do ator (F6, F9)",
        "Nenhum campo de autoria deve chegar do corpo da requisicao, exceto em chamadas SYSTEM. "
        "Os dois casos sao a mesma correcao aplicada em dois servicos.",
    ),
    (
        "P3",
        "Padronizar a renderizacao de Markdown e o nome de arquivo servido (F7, F8)",
        "Uma unica instancia compartilhada de MarkdownIt com `html: false` explicito; "
        "`sanitizeFilename` aplicado tambem ao segmento `[name]` da rota de blobs.",
    ),
    (
        "P3",
        "Revisitar a premissa dos blobs publicos (F10)",
        "Manter a decisao enquanto FR-NFR-032 valer; anotar na spec o gatilho de revisao (o dia "
        "em que um recurso puder conter prova nao publicada ou dado de aluno).",
    ),
]
