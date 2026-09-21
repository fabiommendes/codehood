# [Seguranca] Lista completa de matriculados devolvida a qualquer aluno do curso

Labels: `security`, `severity:media`, `area:api`, `area:privacy`

## Problema

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
