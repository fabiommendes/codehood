---
type: adr
status: accepted
tags: [db, services, auth]
created: 2026-11-03
decided: 2026-09-02
creator: claude
---

# Actor obrigatório em toda chamada de Service

Todo método de Service recebe `opts.actor` obrigatório (um usuário ou o
sentinela `SYSTEM`) e decide sozinho o que esse actor pode ver ou fazer. Um
`findMany` filtra no banco e ainda verifica cada registro, para que uma regra
divergente vire exceção, não vazamento.

## Contexto

Controle de acesso que falha aberto parece funcionar: um `actor` omitido
compilaria e devolveria tudo. O tipo `ServiceOpts` (`src/db/base-service.ts:18`)
torna `actor` obrigatório desde o commit `26d8181` (2026-09-02). A
justificativa foi escrita em `src/db/services/README.md` na auditoria de
segurança do commit `1835079` (2026-09-21).

## Decisão

- Todo método público de Service declara `opts: ServiceOpts`, nunca `opts?`.
  Um `opts?` reabre o buraco do fail-open.
- `ServiceOpts` tem `actor` (obrigatório), `tx` (transação Prisma, opcional) e
  `validate` (`"both"`, o padrão, `"none"`, `"input"` ou `"output"`; ver
  ADR 0006).
- `SYSTEM` (`src/auth/actor.ts:30`) é um `Symbol`, para que nunca chegue por
  acidente de um JSON ou de uma variável esquecida: escrever `SYSTEM` é uma
  decisão visível no diff. `FULL_ACCESS` é o atalho `{ actor: SYSTEM }` para
  chamadas confiáveis sem transação (seeds, comandos de gerenciamento).
- As regras ficam em `src/auth/permissions/`; `hasPerm` e `ensurePerm` são as
  funções de uso diário. Cada spec diz as regras de acesso do seu modelo.
- Em `findMany`, filtre no banco o que der (o SQL do [Permission pair]) e,
  ainda assim, verifique a permissão de cada registro com `ensurePerm`. Se a
  regra de negócio divergir entre o filtro e o predicado, o resultado é uma
  exceção nos testes, não um vazamento silencioso.
- A verificação por registro é dispensada quando todos os registros dependem
  de um mesmo recurso pai (as questões de um curso, por exemplo). Nesse caso,
  verifique o pai e não declare permissão por registro.

[Permission pair]: ../../GLOSSARY.md#permission-pair

## Consequências

- Esquecer o actor é erro de compilação.
- O chamador não filtra resultados depois; quem decide é o Service.
- Métodos que estabelecem a identidade (`ApiKeyService.validate`,
  `SessionService.validate`) não têm actor antes de rodar. Eles são a exceção
  e precisam dizer isso no doc comment.
- A dupla checagem custa uma avaliação de permissão por registro em listas.
