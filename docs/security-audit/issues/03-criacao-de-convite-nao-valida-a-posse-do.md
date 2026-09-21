# [Seguranca] Criacao de convite nao valida a posse do curso

Labels: `security`, `severity:alta`, `area:auth`, `area:api`

## Problema

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
