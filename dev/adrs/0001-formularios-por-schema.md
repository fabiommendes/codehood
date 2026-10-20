---
type: adr
status: accepted
tags: [forms, ui, actions, zod]
relatedTo: [specs/to-do/forms]
created: 2026-10-20
decided: 2026-10-20
deciders: [fabio, claude]
---

# Formulários derivados de schemas zod

## Context

Os formulários eram escritos à mão: HTML dos campos, atributos de validação,
schema inline na action e um `alert` único para qualquer erro. O schema zod que
valida a action já sabe quais campos existem, quais são obrigatórios e quais
limites têm. O detalhamento e o plano estão em
[`dev/specs/to-do/forms.md`](../specs/to-do/forms.md).

## Options

- Adotar TanStack Form. Resolve estado de cliente, mas não conhece Astro
  Actions nem formulário sem JS.
- Gerar o formulário inteiro a partir do schema, como no protótipo antigo com
  Modular Forms. Quebra no segundo formulário que foge do layout padrão.
- Camada própria: o schema descreve cada campo, e o formulário usa os campos
  gerados onde quiser.

## Decision

Camada própria, com o campo como primitivo. Lógica pura em `src/forms/`,
componentes em `src/components/form/`. Um único conjunto de componentes Solid
serve às páginas `.astro` (renderizado no servidor, sem JS) e às ilhas.

### 1. A action usa o schema de domínio

```ts
// src/actions/admin.ts
createDiscipline: defineAction({
	accept: "form",
	input: disciplineCreate, // de src/core/schemas, nunca z.object inline
	handler: withServiceErrors(async (input, context) => { ... }),
}),
```

### 2. Textos de formulário ficam em `meta({ form })`

```ts
// src/core/schemas/discipline.ts
slug: z.string().min(1).meta({
	description: "First segment of every course URL.",
	form: { placeholder: "cs102" },
}),
```

`FieldMeta` tem `label`, `hint`, `placeholder` e `widget`. O label resolve na
ordem: override do formulário, `form.label`, `title`, nome do campo com a
inicial maiúscula. A dica segue a mesma ordem com `form.hint` e `description`.
Ponha em `meta` só o que vale para todo formulário que usa o campo. O que muda
de um formulário para outro vai no override (seção 3). A chave `form` é
removida do OpenRPC e do OpenAPI. Encadeie `.meta()` depois de `.openapi()`:
o segundo clona o schema e o clone perde o meta.

### 3. Página `.astro`, sem JS

Formulário de CRUD comum, gerado inteiro:

```astro
---
const result = Astro.getActionResult(actions.admin.createDiscipline);
---
<SchemaForm
  schema={disciplineCreate}
  action={actions.admin.createDiscipline}
  result={result}
  values={await submittedValues(Astro.request)}
  submitLabel="Create"
  fields={{ slug: { label: "Permanent slug" } }}
/>
```

Layout próprio, campos gerados:

```astro
---
const form = await actionForm(Astro, actions.admin.createDiscipline, disciplineCreate, {
  id: "create-discipline", // prefixo dos ids; um por formulário da página
});
---
<form method="POST" action={actions.admin.createDiscipline} class="flex flex-wrap items-end gap-4">
  <FormAlert error={form.error} />
  <Field {...form.field("slug")} class="font-mono" />
  <Field {...form.field("name")} />
  <button class="btn btn-primary">Create</button>
</form>
```

`actionForm` lê o resultado da action e, só quando ele é um erro dessa action,
repõe os valores enviados (sem `submittedValues` à mão; vários formulários na
mesma página não se misturam). `formState` é a função pura por baixo.

`form.field(name)` devolve tudo que `<Field>` precisa: o `FieldSpec` derivado
do schema, o valor enviado e os erros desse campo. `form.error` é uma `string` com o erro que
não pertence a nenhum campo (`FORBIDDEN`, `NOT_FOUND`, falha genérica).

`class` em `<Field>` vai para o controle (`input`, `select`...), não para o
`fieldset`; largura e posição ficam num `div` ao redor.

### 4. Ilha Solid

```tsx
const form = createSchemaForm(answerGrade, {
	action: actions.grading.grade,
	hidden: { discipline, course, exam, submission },
	onSuccess: () => window.location.reload(),
});

return (
	<form onSubmit={form.submit} noValidate>
		<FormAlert error={form.error()} />
		<Field {...form.field("score")} control={{ inputmode: "numeric" }} />
		<Field {...form.field("comment")} />
		<button class="btn btn-primary" disabled={form.busy()}>Save</button>
	</form>
);
```

`form.field` tem a mesma forma do caso `.astro` (mais `onInput`), só que reativa:
`value` e `errors` são getters. Valida com o schema no envio, com a mesma
conversão de FormData do servidor, e foca o primeiro campo inválido. Depois do
primeiro erro, revalida a cada digitação só os campos que têm erro.

- `hidden` entra no FormData e vence um controle de mesmo nome. Erro de um campo
  sem controle no formulário vai para `form.error()`.
- `accept` (`"json"` por padrão) diz o que a action espera. `"json"` envia o
  objeto de `formToInput`; `"form"` envia o `FormData`, para actions com
  `accept: "form"`.
- `busy()` fica `true` após o sucesso: `onSuccess` deve navegar.
- `control` em `<Field>` passa atributos ao elemento (`inputmode`, `data-*`).
- Uma ilha pode importar `@/core/schemas`; `test/schemas-browser-safe.spec.ts`
  garante que o barrel carrega sem `process` nem `Buffer`.

### 5. Erro que só o servidor detecta

```ts
// no service
throw new FieldError("slug", `Slug "${slug}" is already taken.`);
```

`withServiceErrors` entrega esse erro como erro de input. Ele aparece no campo
`slug`, com ou sem JS, igual a um erro do schema.

### 6. Campo escrito à mão

Um campo que o gerador não cobre fica ao lado dos gerados e usa o mesmo nome do
schema. `form.field(name).errors` continua disponível para ele. `<Field>`
lança erro para tipos zod que não reconhece; use `widget` ou escreva o campo.

### 7. Aparência

`<Field>` segue `src/pages/design/forms.astro`. Para outra aparência, passe
`theme`, um mapa de `kind` (ou `radio`/`toggle`) para componente, em `<Field>` ou em `<SchemaForm>`.

## Consequences

- Validação, atributos HTML (`required`, `minlength`, `max`...) e mensagens
  saem de um lugar só. O mesmo texto de erro aparece no cliente e no servidor.
- O formato de um campo volta a ser validado no schema da action, não no
  service.
- `formToInput` replica a conversão de FormData do Astro, e `FieldError`
  depende do formato interno de `ActionInputError`. Os dois têm testes de
  contrato que quebram se o Astro mudar.
- Listas dinâmicas, objetos aninhados editáveis e upload ficam fora. Esses
  formulários continuam escritos à mão.
