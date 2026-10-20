---
type: spec
status: to-do
tags: [forms, ui, actions, zod]
relatedTo: [design-forms]
---

# Formulários derivados de schemas zod

Hoje cada formulário do Codehood é escrito à mão: o HTML dos campos, os
atributos de validação, o schema da action e a exibição do erro. São 17
formulários em páginas `.astro` (POST para uma action, sem JS) e 12 ilhas
Solid que chamam `actions.*` direto. Este RFC propõe uma camada fina que deriva
campos, validação e mensagens de erro dos schemas zod que o projeto já tem, sem
adotar uma biblioteca de formulários.

A API que os formulários usam está em
[`dev/adrs/0001-formularios-por-schema.md`](../../adrs/0001-formularios-por-schema.md),
e este spec segue os nomes de lá (`formState`, `createSchemaForm`, `Field`,
`SchemaForm`, `FormAlert`, `FieldError`).

## Problemas atuais

- **Schema duplicado.** As actions declaram o `input` com `z.object` inline em
  vez de reaproveitar `src/core/schemas`. `admin.createEdition` repete os
  campos de `editionCreate`.
- **Erro só no topo.** O resultado de `getActionResult` vira um `alert` único
  (`src/pages/admin/disciplines.astro`). Nenhum formulário mostra erro por
  campo, embora `isInputError(error).fields` já traga as mensagens separadas.
- **Validação fora do lugar.** `src/actions/admin.ts` deixa de validar o
  formato do slug na action porque o erro de input do Astro aparece como "a
  JSON dump of the failing Zod issue". A regra foi parar no service por falta
  de UI para o erro de input.
- **Atributos à mão.** `required`, `minlength` e `placeholder` são escritos no
  HTML e podem divergir do schema.
- **Markup divergente.** `src/components/grading/GradeForm.tsx` usa `label` +
  `input-bordered` (classe do daisyUI 4), enquanto `src/pages/design/forms.astro`
  define `fieldset` + `legend` + `input`.
- **Coerção com surpresas.** No modo `accept: "form"`, o Astro converte campo
  vazio em `null`. Um `z.string().min(1)` vazio responde "Invalid input:
  expected string, received null", e um `z.coerce.date()` vazio passa como
  `1970-01-01` (testado com zod 4.4.3).

## O que existe

- **Astro Actions** validam no servidor com zod e devolvem `ActionInputError`
  com `fields: Record<string, string[]>`, tanto no POST sem JS
  (`getActionResult`) quanto na chamada da ilha.
- **Zod 4** oferece metadados (`.meta()`, registries), `toJSONSchema` com
  `override`, mapa de erros global e locales.
- **Bibliotecas Solid.** TanStack Form (`@tanstack/solid-form`, Standard Schema)
  é a única madura e mantida, mas resolve estado complexo de cliente e não sabe
  nada de Astro Actions nem de formulário sem JS. Modular Forms foi substituído
  pelo Formisch, que só aceita Valibot. Felte e solid-form-handler estão
  parados.
- **Geração automática.** AutoForm e zod-to-form só têm UI para React.

Nenhuma delas cobre o que falta aqui: erro por campo vindo do servidor e o
caminho sem JS.

## O protótipo anterior

`codehood-old/monorepo/astro/src/lib/forms.tsx` usava Modular Forms e gerava o
formulário inteiro a partir de um `z.object`. Aproveitamos o mapeamento de tipo
para campo, os metadados no schema e o fallback `humanize(name)` para o label.
O que faltou:

- o botão de envio dizia "Login" fixo, primeiro sinal de que gerar o
  formulário inteiro não tem ponto de extensão;
- o erro do servidor nunca chegava ao formulário;
- só existia como ilha Solid, sem caminho para as páginas sem JS;
- aceitava só string, email, base64 e boolean, sem atributos HTML derivados;
- o `id` do formulário era sombreado pelo `props` do campo e os ids saíam
  `undefined-<campo>`.

## Decisões de design

### Fonte única de schema

As actions usam os schemas de `src/core/schemas` (`disciplineCreate`,
`editionUpdate`), com `.pick`, `.extend` ou `.partial` quando o formulário
difere do schema de domínio. `astro/zod` e `zod` resolvem para a mesma
instância (mesmas classes, mesmo `globalRegistry`), então misturar os imports
não quebra metadados.

### Metadados de formulário em `meta({ form })`

```ts
declare module "zod/v4/core" {
	interface GlobalMeta {
		form?: FieldMeta;
	}
}

const slug = z.string().min(1).meta({ form: { placeholder: "cs102" } });
```

- `FieldMeta` tem `label`, `hint`, `placeholder` e `widget` (`"textarea"`,
  `"select"`, `"radio"`, `"toggle"`, `"password"`...). A augmentation torna a
  chave tipada; o tsc recusa `{ form: { label: 1 } }`.
- O label resolve nesta ordem: override do formulário, `form.label`, `title`,
  `humanize(name)`. A dica segue a mesma ordem com `form.hint` e
  `description`. Um campo documentado para a API já ganha label e dica sem
  configuração de formulário.
- O override por formulário é um objeto tipado pelas chaves do schema:
  `fields={{ slug: { label: "Identificador permanente" } }}`. Ele cobre o
  mesmo campo com textos diferentes em formulários diferentes.
- `toJSONSchema` copia toda chave do meta para a saída. `jsonSchemaOf`
  (`src/rpc/registry/openrpc-document.ts`) ganha
  `override: (ctx) => { delete ctx.jsonSchema.form }`, e todo outro ponto que
  gere JSON Schema passa por ele. Sem isso, `form` vaza para o OpenAPI e para a
  codegen do `cli/`.
- Wrappers (`.optional()`, `.nullable()`, `.default()`) criam outra instância
  e perdem o meta. Checks encadeados (`.max()`) preservam. A leitura do meta
  desembrulha o schema até achar um.

Alternativa descartada: um `z.registry<FieldMeta>()` separado. Isola por
construção, mas obriga a extrair cada campo para uma variável ou registrar com
`registry.add(schema.shape.x, ...)`. O ganho não paga a verbosidade.

### `describeField`: do schema ao campo

Função pura que recebe nome, schema do campo e override, e devolve:

```ts
type FieldSpec = {
	name: string;
	kind: "text" | "email" | "url" | "number" | "date" | "datetime" | "boolean" | "enum" | "textarea";
	required: boolean;
	label: string;
	hint?: string;
	placeholder?: string;
	attrs: { type?: string; minlength?: number; maxlength?: number; min?: number | string; max?: number | string; step?: number; pattern?: string };
	options?: { value: string; label: string }[];
};
```

- Aceita uma lista fechada: string e seus formatos (email, url), número,
  `coerce.date`, boolean, enum, e os wrappers optional, nullable, default e
  pipe. Qualquer outro tipo lança erro na renderização e obriga a declarar
  `widget` ou a escrever o campo à mão.
- `required`, `minlength`, `maxlength`, `min`, `max` e `step` saem dos checks
  do schema. A validação nativa do navegador passa a valer também nas páginas
  sem JS.
- `pattern` só é emitido quando a regex do zod é compatível com o atributo
  HTML (flag `v`). Na dúvida, fica de fora e a validação fica com o zod.

### Coerção de FormData

O cliente precisa transformar FormData no mesmo objeto que o servidor vê, senão
o formulário passa no cliente e falha no servidor. A função do Astro
(`formDataToObject` em `astro/dist/actions/runtime/server.js`) não é exportada
pelo pacote. Escrevemos `formToInput(schema, formData)` com as mesmas regras:

- campo vazio vira `undefined` se opcional, senão `null`;
- `ZodNumber` vira `Number(value)`;
- boolean é `"true"`/`"false"` ou presença da chave;
- array usa `getAll`; objeto aninhado usa nomes `a.b`;
- `default` se aplica quando a chave não veio.

Um teste de contrato importa a função do Astro pelo caminho do arquivo e
compara as duas saídas numa tabela de schemas e entradas. Uma atualização do
Astro que mude a regra quebra o teste em vez de quebrar o formulário.

### Mensagens de erro

Um mapa de erros zod central (`z.config({ customError })`) é carregado no
servidor e no cliente. Ele traduz `invalid_type` com entrada `null` ou
`undefined` para "Required", o que corrige a mensagem da coerção acima. Como o
schema e o mapa são os mesmos, cliente e servidor mostram o mesmo texto. O
idioma das mensagens segue o da UI.

### Erros de service por campo

Erros que só o servidor detecta (slug repetido, formato validado no service)
precisam chegar ao campo, não ao topo.

- `src/core/error.ts` ganha `FieldError(field, message)`.
- `withServiceErrors` traduz `FieldError` num `ActionError` com
  `type: "AstroActionInputError"` e `issues: [{ path: [field], message }]`.
  `serializeActionResult` copia as propriedades próprias do erro e
  `ActionError.fromJson` reconstrói um `ActionInputError` a partir de `type` e
  `issues`. O cliente recebe `fields` como se a falha viesse do schema.
- `ActionInputError` não é exportado por `astro:actions`, então isso depende
  de um contrato interno do Astro. Um teste e2e cobre os dois caminhos (POST
  sem JS e ilha) e falha se o contrato mudar.
- O formato do slug volta a ser validado no schema da action, porque o erro de
  input passa a ter UI.

Erros que não pertencem a um campo (`FORBIDDEN`, `NOT_FOUND`, falha genérica)
continuam como `Alert` no topo do formulário.

### Um renderizador, em Solid

Componentes Solid renderizam no servidor quando usados num `.astro` sem
diretiva `client:`, e nesse caso não enviam JS. Por isso há uma só
implementação:

- `<Field>` recebe um `FieldSpec`, o valor e os erros, e consulta o tema.
- O tema é um mapa `kind → componente`. O padrão segue
  `src/pages/design/forms.astro`: `fieldset` + `legend`, `p.label` para a dica,
  `input-error` + `aria-invalid` + `p.label.text-error` para o erro. Um
  formulário ou o projeto inteiro pode trocar o tema.
- Em página `.astro`, o formulário é estático: valores e erros vêm de
  `getActionResult` via props.
- Em ilha, `createSchemaForm(schema, action)` mantém uma store própria
  (`createStore`) com valores, erros e campos tocados. Valida com `safeParse`
  no envio e, depois do primeiro erro, a cada `input` nos campos com erro.
  Mapeia `isInputError(error).fields` de volta para os campos.

Sem biblioteca de formulários: o que o Modular Forms fornecia ao protótipo cabe
em uma store Solid de poucas dezenas de linhas.

### `<Field>` é o primitivo, `<SchemaForm>` é um loop

O formulário inteiro gerado só serve para formulários simples. O de disciplina
já é `flex-wrap` em linha, e o de nota tem campos com `data-*` e foco
controlado. Então:

- `<Field name="slug" />` dentro de um formulário escrito à mão é o uso
  principal;
- `<SchemaForm schema action submitLabel fields>` itera os campos na ordem do
  `shape` e serve aos CRUDs de admin;
- qualquer campo pode ser escrito à mão ao lado dos gerados, e continua
  recebendo seu erro pelo nome.

### Onde fica o código

- `src/forms/`: lógica pura (`describeField`, `formToInput`, mapa de erros,
  tipos de `FieldMeta`, augmentation). Sem JSX.
- `src/components/form/`: `Field`, `SchemaForm`, `createSchemaForm` e o tema
  daisyUI.

A tabela de layout em `AGENTS.md` ganha a linha de `src/forms/`.

## Fora do escopo

- Listas dinâmicas (adicionar e remover linhas) e objetos aninhados editáveis.
- Upload de arquivo (depende de `blob-upload-and-gc.md`).
- Formulários em várias etapas, autosave e confirmação de saída.
- Migrar os 29 formulários de uma vez. Este RFC migra dois como prova; o resto
  segue por demanda.

## Questões em aberto

- **Q1. Valores após erro sem JS.** Quando o POST falha, a página renderiza
  com `getActionResult`, mas o Astro não devolve os valores enviados e os
  campos voltam vazios. Ler `Astro.request.formData()` na página resolve se o
  corpo ainda não tiver sido consumido pela action. A T5 investiga e resolve;
  `formState` aceita os valores enviados quando houver como obtê-los.
- **Q2. Idioma das mensagens.** A UI hoje está em inglês. O mapa de erros
  segue o inglês até existir i18n.

## Plano de ação

| Tarefa | Modelo | Depende de | Entrega |
| :----- | :----- | :--------- | :------ |
| T1     | sonnet | -          | `src/forms/`: `FieldMeta`, augmentation, `describeField`, strip em `jsonSchemaOf` |
| T2     | sonnet | -          | `formToInput` e teste de contrato contra o Astro |
| T3     | sonnet | -          | mapa de erros central, carregado no servidor e no cliente |
| T4     | sonnet | -          | `FieldError` e tradução em `withServiceErrors`, com e2e dos dois caminhos |
| T5     | sonnet | T1, T3     | `Field`, tema daisyUI, `SchemaForm`; resolve Q1 |
| T6     | sonnet | T2, T4, T5 | `createSchemaForm` para ilhas |
| T7     | sonnet | T5, T4     | migra `src/pages/admin/disciplines.astro` (sem JS) |
| T8     | sonnet | T6         | migra `src/components/grading/GradeForm.tsx` (ilha) |
| T9     | sonnet | T7, T8     | migra o formulário de login (`src/pages/login.astro`) |

As tarefas rodam em quatro levas: T1 a T3 (lógica pura em `src/forms/`) e T4;
T5 e T7; T6 e T8; T9.

- **T1.** Pronto quando `describeField` cobre cada `kind` da lista, lança erro
  para tipo desconhecido, desembrulha wrappers, e o OpenRPC gerado não contém
  a chave `form`.
- **T2.** Pronto quando a tabela de contrato passa para string, número,
  boolean, data, enum, opcional, default, array e objeto aninhado.
- **T4.** Pronto quando um slug repetido aparece no campo `slug`, com e sem JS.
- **T7 e T8.** Os testes de história existentes continuam verdes. O formulário
  de disciplina mostra erro por campo para slug vazio e slug repetido.

## Critérios de aceite

- As actions migradas usam schemas de `src/core/schemas`, sem `z.object`
  inline.
- O mesmo texto de erro aparece no campo quando o erro vem do cliente, do
  schema no servidor e do service.
- A página de disciplinas funciona com JS desligado, com erro por campo.
- Os campos renderizados seguem o markup de `src/pages/design/forms.astro`.
- `pnpm run lint` e `pnpm test` saem 0.
