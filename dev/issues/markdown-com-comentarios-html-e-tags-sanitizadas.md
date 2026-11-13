---
type: issue
status: backlog
tags: [markdown, html, security, resources]
kind: feature
priority: medium
creator: claude
---

# Aceitar comentários HTML e um subconjunto sanitizado de HTML no Markdown

## Problema

O renderizador compartilhado, em `src/utils/markdown.ts`, usa MarkdownIt com
`html: false`. Isso protege contra execução de HTML arbitrário, mas também
impede dois usos legítimos na autoria do material:

- Ocultar trechos com comentários HTML, como `<!-- exercícios em revisão -->`.
- Usar tags simples para recursos de apresentação que o Markdown básico não
  oferece, como conteúdo expansível, teclas e sobrescritos.

No curso Paradigmas, uma seção de exercícios colocada entre `<!--` e `-->`
continuou visível, junto com links ainda quebrados. Foi necessário substituir
cada linha por uma definição de referência Markdown, no formato
`[//]: # "conteúdo"`, apenas para ocultá-la.

## Proposta

Permitir HTML na autoria do Markdown, mas publicar somente HTML processado
por um sanitizador com uma lista explícita de tags e atributos permitidos.
Não basta mudar a opção do MarkdownIt para `html: true`.

### Comentários

Interpretar comentários HTML fora de código e removê-los do HTML final:

```markdown
Texto público.

<!--
## Exercícios em revisão

* [Questão](questions/exemplo.md)
-->

Mais texto público.
```

Somente os dois parágrafos públicos devem aparecer. Os delimitadores e o
conteúdo comentado não devem estar no HTML renderizado, nem como texto
escapado. Comentários escritos dentro de blocos ou trechos de código devem
continuar aparecendo como exemplos literais.

Comentários são um recurso de autoria, não um controle de acesso: o Markdown
original pode estar disponível no repositório ou na API. Não armazenar segredos
nem depender deles para esconder gabaritos de alunos sem autorização.

### Tags simples

Proposta inicial de extensões ao Markdown, a validar na implementação:

| Tag | Uso | Atributos propostos |
| --- | --- | --- |
| `details` | Conteúdo expansível | `open`, booleano |
| `summary` | Título do conteúdo expansível | Nenhum |
| `kbd` | Teclas e atalhos | Nenhum |
| `sup`, `sub` | Sobrescritos e subscritos | Nenhum |
| `mark` | Destaque textual | Nenhum |
| `br` | Quebra de linha | Nenhum |

Exemplos:

```html
<details>
<summary>Ver explicação</summary>
<p>Uma explicação complementar.</p>
</details>

Pressione <kbd>Ctrl</kbd> + <kbd>D</kbd>.
A complexidade é O(n<sup>2</sup>).
```

O sanitizador também precisa preservar as tags seguras que o Markdown já
gera, como parágrafos, títulos, listas, tabelas, links e blocos de código.
Documentar uma única política compartilhada, em vez de criar listas
incompatíveis para cada página. Definir separadamente o subconjunto válido
para renderização inline, que não deve aceitar blocos como `details`.

## Requisitos de segurança

- Usar um sanitizador mantido, baseado em parsing de HTML, com política de
  permissão explícita. Não implementar sanitização por expressões regulares.
- Não aceitar scripts, handlers `on*`, `style`, formulários, iframes, embeds,
  SVG ou MathML arbitrários, nem protocolos executáveis em URLs.
- Validar protocolos também em atributos do HTML permitido, incluindo URLs
  com entidades, variações de caixa e caracteres de controle.
- Não permitir que HTML escrito pelo autor forje os marcadores internos dos
  blocos executáveis, como classes e atributos `data-*` usados pelo runner.
- Preservar o funcionamento do realce de código e dos blocos executáveis
  gerados pela aplicação. Distinguir esses elementos do HTML do autor na
  definição da política e da ordem das transformações.
- Aplicar a proteção no renderizador compartilhado, inclusive nas funções de
  corpo de documento e de fragmento inline; não confiar na página chamadora.

## Critérios de aceitação

- [ ] Comentários de uma ou várias linhas não aparecem no HTML final.
- [ ] Cabeçalhos, links e listas dentro de comentários não são renderizados.
- [ ] Comentários entre trechos visíveis não apagam conteúdo fora deles.
- [ ] HTML dentro de código inline ou cercado continua literal e visível.
- [ ] As tags e os atributos permitidos estão documentados e funcionam nas
      páginas que usam o renderizador compartilhado.
- [ ] HTML não permitido é removido ou neutralizado segundo política
      documentada, sem execução de JavaScript ou criação de controles ativos.
- [ ] Testes de regressão cobrem scripts, handlers, URLs `javascript:`,
      entidades, HTML malformado, SVG/MathML e falsificação de blocos do runner.
- [ ] Markdown existente, links, tabelas, realce e blocos executáveis continuam
      funcionando; a renderização inline não passa a admitir blocos.
- [ ] Há testes unitários do HTML produzido e testes de navegador para os
      casos de interação permitida e de XSS.

## Relação com o CLI

Esta feature pertence ao renderizador do Codehood, não ao CLI. Não resolve a
reescrita de caminhos locais para URLs de objetos publicados, registrada em
`cli/dev/issues/links-relativos-em-recursos-markdown.md`.

Também não substitui a convenção de vínculos de materiais do calendário,
registrada em `cli/dev/issues/links-de-materiais-duplicados-no-calendario.md`.
Mesmo que um comentário oculte links na descrição, cabe ao CLI interpretar o
bloco reservado e associar os recursos ao evento.
