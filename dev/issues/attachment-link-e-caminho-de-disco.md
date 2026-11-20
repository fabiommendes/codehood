---
type: issue
status: open
tags: [anexos, blobs, urls]
---

# `Attachment.link` é um caminho de disco, não uma URL

`AttachmentService` preenche `link` com `blob.attachmentPath(hash, filename)`
(`src/db/services/attachment.service.ts`), que é o caminho do arquivo no
disco do servidor (`<blobDir>/<filename>`). O nome do campo faz parecer uma
URL.

A página de arquivo de repositório
(`src/pages/[discipline]/[course]/repositories/[slug]/[...path].astro`) usava
`file.link` como `src` da imagem e como `href` do download, e por isso os dois
apontavam para um caminho inexistente. Ela agora usa
`urls.files.named({ hash, name })`.

O campo não sai pela API REST (nenhum schema do snapshot OpenAPI o tem), mas
o nome continua convidando ao mesmo erro.

## Proposta

Renomear `link` para `path` em `Attachment` (`src/core/schemas/attachment.ts`)
ou removê-lo, se nenhum chamador precisar do caminho. Quem quer a URL usa
`urls.files.named({ hash, name })`.
