---
type: adr
status: accepted
tags: [db, services, validation, zod]
created: 2026-11-03
decided: 2026-09-02
creator: claude
---

# Validação de entrada e saída nos Services

Todo método de Service passa por `@Validate`, que valida os argumentos na
entrada e o resultado (`returns:`) na saída. A entrada é tão estrita quanto o
domínio permite e pode converter valores; a saída só restringe a forma do que
sai, sem converter nem repetir regras de formato.

## Contexto

O decorator `@Validate` (`src/utils/validate.ts:59`) entrou no commit
`26d8181` (2026-09-02). Um schema de entrada frouxo deixa passar dados que
violam regras de negócio; um schema de saída ausente deixa um campo novo do
banco (um hash, um token) chegar à API sem ninguém notar.

## Decisão

- `@Validate` envolve todo método de Service. Em subclasses de `CrudBase`, ele
  fica nos métodos `xxxTx` (`createTx`, `findOneTx`...), não nos públicos.
- **Entrada protege a consistência do banco.** O schema é tão estrito quanto o
  domínio permite. Pode converter valores para o formato certo.
- **Saída protege a forma.** `returns:` funciona como lista branca do que sai
  do Service. Não converte valores e não repete regras de formato que o schema
  de create/update já impõe: o dado lido do banco já foi validado na entrada, e
  a validação dupla custa desempenho e dispara exceções por bugs sem efeito.
- `opts.validate` (ADR 0005) desliga a validação de entrada, de saída ou das
  duas, para chamadas internas que já validaram.
- Schemas de create e update derivam do schema da entidade, em
  `src/core/schemas/`, com `.pick`, `.omit`, `.extend` e `.partial`, sem
  redigitar campos. Um schema redigitado diverge da entidade em silêncio: uma
  coluna nova chega ao banco sem nada que a rejeite. Quando um campo de entrada
  é diferente de fato do da entidade, use `.extend`, para que a diferença fique
  explícita.
- Opcionalidade nos campos de create/update:
  - sem modificador: obrigatório;
  - `.optional()`: "não estou dizendo", o campo mantém o valor que tem;
  - `.nullish()`: "posso também dizer nada", `null` limpa a coluna.

  Todo campo de create/update sobre uma coluna anulável é `.nullish()`. Um
  campo `.optional()` sobre coluna anulável não pode ser limpo, porque
  `undefined` chega ao Prisma como "deixe como está".
- A exceção é a opcionalidade de forma na saída, que não fala de coluna:
  `apiKeySchema.token` e `inviteSchema.token` são `.optional()` porque só
  aparecem na resposta do create.

## Consequências

- O mesmo schema de entrada valida o formulário (ADR 0001), a Action, a REST
  API e o Service.
- Um campo novo no banco não sai do Service até alguém o pôr no schema de
  saída.
- Um `out` errado só aparece em tempo de execução, como erro 500.
