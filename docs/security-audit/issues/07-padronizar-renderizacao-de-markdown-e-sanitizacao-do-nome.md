# [Seguranca] Padronizar renderizacao de Markdown e sanitizacao do nome de arquivo servido

Labels: `security`, `severity:baixa`, `area:frontend`, `area:hardening`

## Problema

Dois pontos de endurecimento. Nenhum e explorável hoje; ambos dependem de um
comportamento externo para continuar seguros, o que e exatamente o tipo de
protecao que some numa atualizacao de dependencia.

### 1. `new MarkdownIt()` sem opcoes explicitas

`src/pages/[discipline]/[course]/schedule.astro:23` instancia o markdown-it sem
argumentos e renderiza `event.description` com `set:html` na linha 163. Os
outros tres pontos de renderizacao do projeto fixam as opcoes:

```
src/components/question/Markdown.tsx:12
  new MarkdownIt({ html: false, linkify: true, typographer: true })
src/pages/[discipline]/[course]/exams/[slug].astro:36
  new MarkdownIt({ html: false, linkify: true, typographer: true })
src/pages/[discipline]/[course]/resources/[slug].astro:43
  new MarkdownIt({ html: false }).render(data.content)
```

O default do markdown-it 15 ja e `html: false`, e seu `validateLink` bloqueia
`javascript:`, `vbscript:` e `data:` - entao nao ha falha hoje. O risco e que um
bump de major que mude esse default transforme silenciosamente
`event.description` (escrito pelo instrutor, sincronizado pela CLI) em HTML
executavel na sessao de cada aluno, sem que nada no codigo mude.

### 2. Nome de arquivo da URL no Content-Disposition

`/files/[hash]/[name]` passa o segmento decodificado da URL direto para o
cabecalho. `escapeFilename` escapa `\` e `"`, mas nao CR/LF, e `%0d%0a`
sobrevive a decodificacao do path.

Verificado no runtime alvo (Node 22, undici):
`new Headers({"Content-Disposition": 'attachment; filename="a\r\nX-Injected: 1"'})`
lanca `TypeError: invalid header value`. Ou seja, nao ha response splitting - a
excecao escapa do handler e a rota devolve 500 em vez de 404. A protecao vem do
undici, nao do codigo.

## Evidencia

`src/utils/blob-response.ts:19-27`

```ts
function escapeFilename(filename: string): string {
  return filename.replace(/[\\"]/g, "\\$&");   // escapa \ e ", mas não CR/LF
}
export function contentDisposition(mimeType: string, filename: string): string {
  const disposition = isInlineMimeType(mimeType) ? "inline" : "attachment";
  return `${disposition}; filename="${escapeFilename(filename)}"`;
}
```

`src/db/services/blob.service.ts:282-287`

```ts
const filename = name ?? attachment.filename;
const headers = new Headers({
  "Content-Type": attachment.mimeType,
  "Content-Disposition": contentDisposition(attachment.mimeType, filename),
  ...blobSecurityHeaders(),
});
```

## Impacto

- Markdown: nenhum hoje; regressao silenciosa para XSS armazenado se o default
  do markdown-it mudar.
- Content-Disposition: 500 em vez de 404 para uma URL maliciosa. Nenhum
  cabecalho injetado no runtime atual.

## Sugestao de correcao

- Extrair uma unica instancia compartilhada de MarkdownIt com `html: false`
  explicito (por exemplo em `src/utils/`) e usa-la nos quatro pontos.
- Aplicar `sanitizeFilename` (ja existente, usado em
  `attachmentService.create`) tambem ao segmento `[name]` antes de montar o
  cabecalho, ou recusar qualquer caractere fora de `[\w.\- ]`.

## Criterios de aceite

- [ ] Nenhum `new MarkdownIt()` sem `html: false` explicito no projeto.
- [ ] As quatro chamadas usam o mesmo helper.
- [ ] `GET /files/<hash>/a%0d%0aX:1` responde 404 ou 400, nunca 500.
- [ ] O nome usado no cabecalho passa por `sanitizeFilename`.
- [ ] `pnpm run lint` passa.
