---
type: issue
status: todo
tags: [ui, design-system, mdq]
relatedTo: [question]
---

# Radios com o mesmo `name` em `/design/questions`

- Cada `AnyQuestionView` da página é renderizado à parte no servidor, e o
  `createUniqueId` do Solid recomeça em cada render: as questões de múltipla
  escolha saem com `name="0"`, `"00"` etc., repetidos entre questões.
- O navegador deixa um só radio marcado por `name`, então a questão em modo
  review aparece sem a alternativa escolhida, embora o HTML traga `checked`.
- Só o catálogo é afetado: nas páginas de prova e correção os componentes são
  hidratados e os nomes saem únicos (`s0000252…`).
- Correção provável: renderizar as amostras dentro de uma única ilha Solid, ou
  passar um prefixo de id por questão, se o mdq-js aceitar um.
