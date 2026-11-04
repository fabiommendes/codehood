---
type: issue
status: backlog
tags: [db, services, blobs]
relatedTo: [0004-services-sao-a-unica-porta-de-acesso-ao-banco, 0009-escala-alvo-e-instancia-unica]
kind: defect
priority: low
created: 2026-11-04
creator: claude
---

# I/O de disco dentro de transação

`attachment.create` grava os bytes do blob (`blob.create` → `writeBytes`) e
cria os links dentro da transação. `repository.addFiles` faz isso para cada
arquivo enviado, numa transação só. `attachment.update`, `remove` e `detach`
apagam nomes do disco (`blob.unlink`) antes do commit.

## Problema

- O better-sqlite3 serializa as transações: enquanto o disco escreve, toda
  outra transação espera. Um envio grande pode estourar o timeout padrão do
  Prisma (5 s).
- Um rollback depois de `blob.unlink` deixa uma linha de `Attachment`
  apontando para um nome que não existe mais no disco.

## Critérios de aceitação

- [ ] Os bytes são gravados antes de abrir a transação (são endereçados pelo
      hash, então gravar de novo é idempotente), sem corrida com
      `blob.delete` do mesmo hash.
- [ ] `blob.unlink` roda só depois do commit.
