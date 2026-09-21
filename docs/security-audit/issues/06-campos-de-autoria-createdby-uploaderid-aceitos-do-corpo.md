# [Seguranca] Campos de autoria (createdBy, uploaderId) aceitos do corpo da requisicao

Labels: `security`, `severity:media`, `area:api`

## Problema

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
