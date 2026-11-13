---
type: issue
status: backlog
tags: [markdown, performance, resources]
kind: enhancement
priority: low
created: 2026-11-13
creator: claude
---

# Guardar o HTML do Markdown já renderizado

## Problema

`src/utils/markdown.ts` renderiza e sanitiza o Markdown a cada requisição:
recurso, README e arquivos de repositório, descrição de prova, descrição de
evento. O realce dos blocos de código (`highlightRunnerBlocks`, Shiki) roda
junto. O texto muda pouco e é lido muitas vezes.

O custo do sanitizador é limitado por tamanho e por contagem de tags (acima do
limite o texto sai pelo caminho sem HTML), então o pior caso hoje são dezenas
de milissegundos por página. Não há medição de quanto isso pesa no tempo de
resposta real.

## Opções

1. **Coluna com o HTML no banco**, escrita junto com o Markdown.
   - A leitura não renderiza nada.
   - O HTML guardado é uma segunda cópia do conteúdo: toda mudança na política
     do sanitizador, no MarkdownIt ou no tema do realce exige renderizar tudo de
     novo. Uma correção de segurança no sanitizador só vale depois dessa
     migração de dados.
   - O texto de "bloco indisponível" do runner depende do idioma do leitor, e a
     disponibilidade do runner depende da instalação. O HTML guardado teria de
     ser um por idioma, ou esses trechos sairiam do HTML.
   - Conteúdo de repositório não tem linha própria onde guardar.
2. **Cache em memória** por hash de (texto, função, idioma, versão do
   renderizador), com limite de entradas.
   - Sem mudança de schema e sem cópia para invalidar: trocar a versão do
     renderizador esvazia o cache.
   - Perde-se no restart e não é compartilhado entre processos. Com um processo
     só, como hoje, isso não importa.
   - Cobre todos os chamadores, inclusive repositório.

## Recomendação

Medir primeiro (tempo de `renderMarkdown` mais `highlightRunnerBlocks` nas
páginas de recurso e de repositório). Se pesar, começar pela opção 2. A opção 1
só se justifica se o cache em memória não bastar.

## Critérios de aceitação

- [ ] Medição registrada antes da mudança.
- [ ] Mudar a política do sanitizador ou a versão do MarkdownIt nunca serve
      HTML produzido pela versão anterior.
- [ ] O texto que depende do idioma continua no idioma do leitor.
