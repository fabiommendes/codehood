---
type: issue
status: backlog
tags: [db, deploy, validation, ops]
kind: feature
priority: high
created: 2026-11-05
creator: claude
---

# Validar as colunas JSON do banco antes do deploy

Pedido do humano depois do deploy da 0.3.0.

## Problema

A 0.3.0 mudou o formato de `QuestionData.privatePayload` e `publicPayload`
sem converter os dados. O ensaio do deploy (`pnpm run package --rehearse`)
aplica só as migrações SQL, que não tocam o conteúdo JSON, e passou limpo. As
páginas do instrutor deram 500 em produção até rodar
`codehood-manage upgrade-questions`.

## Proposta

- Comando `codehood-manage check-json`: percorre toda coluna `Json` do
  schema Prisma e valida cada linha contra o schema Zod da sua forma
  armazenada; lista as linhas que falham, por tabela, coluna e id, e sai com
  1 quando há falha.
- Uma tabela declara o schema de cada coluna; uma coluna `Json` sem entrada
  faz o comando (e um teste) falhar, para que uma coluna nova não fique de
  fora.
- O `--rehearse` do `pnpm run package` roda o comando na cópia migrada do
  banco de produção, então o `deploy.yml` para antes de publicar.

## Critérios de aceitação

- [ ] O comando acusa as 105 questões de um banco da 0.2 (o backup
      `codehood-0.3.0-20261104T160417Z.db` serve de caso real).
- [ ] Toda coluna `Json` do schema tem schema declarado, verificado por teste.
- [ ] Um deploy sobre dados inválidos falha no ensaio.
