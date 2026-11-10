---
type: issue
status: todo
tags: [exam, student, hydration]
kind: bug
priority: high
created: 2026-11-10
creator: claude
---

# Resposta de texto salva não aparece no campo ao reabrir a prova

Visto num e2e (`toHaveValue` falha), ainda sem confirmar à mão.

## Problema

Com uma resposta de texto já salva no servidor, o `<textarea>` da questão chega
do SSR como `<textarea value="...">` (atributo, não conteúdo) e a hidratação do
Solid não aplica a propriedade `value`. O campo abre vazio.

## Passos

1. Salvar uma resposta de texto numa prova em andamento.
2. Recarregar a página.

## O que o aluno vê e o servidor guarda

O campo aparece vazio, mas o servidor guarda o texto. Digitar de novo
sobrescreve a resposta sem o aluno ter visto a anterior. Limpar o campo (`fill("")`
sobre um campo que parece vazio) não dispara `input`, então nada é enviado.

## Direção

Corrigir o `Essay` do mdq (`src/solid/Essay.tsx`, `value={text()}`) para definir o
valor depois da hidratação, ou renderizar o texto como conteúdo do `textarea`.
Rascunho restaurado por `restoreDrafts` aparece, porque entra por mudança de
sinal depois da hidratação.
