---
type: issue
status: todo
tags: [attachments, blobs, gc, cascade]
relatedTo: [attachment-service, blob-service, course-service]
---

# Anexos órfãos quando o banco apaga o dono em cascata

`Attachment` tem dono polimórfico (`attachedToType`, `attachedToId`), que o
SQLite não cascateia. `ResourceService.delete` solta o anexo antes de apagar o
recurso, mas `CourseService.delete` (`src/db/services/course.service.ts`) faz
só `prisma.course.delete`: `Resource` e `QuestionRef` saem pela cascata do
banco, e as linhas de `Attachment` com `RESOURCE` e `QUESTION` continuam lá,
apontando para ids que não existem mais.

O GC de blobs (`BlobService`) só recolhe blobs sem nenhum anexo, então os
bytes desses anexos ficam no disco para sempre e continuam contando na quota
do uploader.

Caminhos possíveis: um passo no GC que apaga os anexos cujo dono não existe
(o mesmo que `dev/specs/to-do/reports.md` prevê para `REPORT`), ou
`CourseService.delete` soltando os anexos do curso na mesma transação.
