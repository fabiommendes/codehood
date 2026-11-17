---
type: spec
status: to-review
tags: [runner, editor, ui]
relatedTo: [runner-widget, code-question]
created: 2026-11-17
creator: claude
---

# Janela do editor: maximizar e recolher pelos botões da moldura

## Contexto

O editor de código que o aluno usa aparece dentro do `mockup-code` do daisyUI,
uma moldura de janela com três bolinhas no topo. As bolinhas são o `::before`
do `mockup-code`: decoração, sem função.

A moldura aparece em três lugares, todos de edição:

- `src/components/runner/CodeRunner.tsx`, modo `snippet` (recursos e blocos
  rodáveis das notas; o aluno clica em Editar e altera a cópia).
- `src/components/runner/CodeRunner.tsx`, modo `answer` (questão dissertativa
  com código numa prova, `src/components/exam/CodeEssayAnswer.tsx`).
- `src/components/exam/CodeAnswer.tsx` (questão `code` do MDQ numa prova).

O modo `review` (correção) não tem moldura e fica fora: a ideia é dar ao aluno
uma interface mais focada para escrever código, não mudar a correção.

Cada bolinha leva o editor a um estado:

| Bolinha  | Estado      | O que é                                                             |
| :------- | :---------- | :------------------------------------------------------------------ |
| cinza    | `inline`    | No fluxo da página, como hoje.                                      |
| vermelha | `collapsed` | Reduzido à barra de título, no fluxo da página.                     |
| verde    | `maximized` | Destacado da página, ocupa a área de conteúdo do app shell inteira. |

Vermelha e verde alternam: clicar na bolinha do estado atual volta a `inline`.
A cinza sempre leva a `inline`.

### Protótipo

O comportamento desta spec está prototipado e aprovado em
`src/pages/design/playground/janela-do-editor/`:

- `index.astro`: nota de aula com dois trechos (JS e Python).
- `prova.astro`: prova com a barra da prova, uma questão `code` e uma
  dissertativa com código.
- `_EditorWindow.tsx` e `_window.css`: o componente. Usa o editor real
  (`createEditor`); Rodar, pré-testes e Enviar são falsos.

A implementação parte de `_EditorWindow.tsx`. O protótipo é removido no fim
(o `pnpm run release` recusa o playground com outra coisa além do `index`).

## Glossário

- **Janela do editor**: a moldura com as três bolinhas e a barra de título, em
  volta do editor e dos controles dele. Entra no `GLOSSARY.md`. Não usar
  "runner" para o widget: no glossário, "Runner" é o comando de correção.
- **Barra do shell**: barra `sticky` do app shell que fica visível sobre o
  conteúdo (o breadcrumb no desktop, a barra da prova). Declara-se com
  `data-shell-bar`.

## Requisitos

### Componente

- R1. Componente Solid novo, `EditorWindow`
  (`src/components/runner/EditorWindow.tsx`), desenha a moldura nos três
  lugares do Contexto. Recebe por props o nome do arquivo, a linguagem, as
  ações da barra de título e o enunciado opcional (R13); recebe como filhos o
  editor e o que vem abaixo dele (terminal, relatório de pré-testes, status de
  envio, rodapé). Cuida do estado, das bolinhas, da animação, das barras
  presas e do espaço reservado. `CodeRunner` (modos `snippet` e `answer`) e
  `CodeAnswer` deixam de montar o `mockup-code` à mão.
- R2. Barra de título, de cima para baixo e da esquerda para a direita: as
  três bolinhas, o nome do arquivo (mono, `text-xs`), a linguagem
  (`text-(--code-muted)`), o botão do enunciado quando maximizada (R13) e, à
  direita, as ações. Fundo `bg-(--code-panel)` e borda inferior
  `border-(--code-border)`, para separar a barra do código também no tema
  escuro. A barra de ferramentas que hoje fica acima da moldura no modo
  `answer` e no `CodeAnswer` passa para dentro dela.
- R3. Ações da barra de título:
  - Executar: ícone de play (`btn btn-ghost btn-sm btn-square text-success`),
    `data-action="run"`, `aria-label` "Executar" (`runner_run`) e `title`
    "Executar (Ctrl+Enter)". No `CodeRunner` (`snippet` e `answer`).
    Substitui o botão redondo que hoje fica pendurado embaixo do código no
    `snippet` (e o `pb-5` que reserva espaço para ele) e o botão com texto
    do modo `answer`.
  - Durante a execução o play vira Parar: ícone de quadrado
    (`text-error`), `data-action="stop"`, `aria-label` "Parar"; enquanto
    prepara, spinner e `aria-label` "Cancelar". O foco volta ao play quando
    a execução parada termina, como hoje.
  - A nota de reinício da linguagem (`restartNote`, hoje tooltip do botão
    redondo e texto na barra do `answer`) vira `title` da linguagem na barra
    de título.
  - A barra de progresso do download e o aviso de execução bloqueada
    (`disabled`, `unsupported`, `unconfigured`) ficam dentro da janela, entre
    o editor e o terminal, como hoje no `snippet`.
  - No `answer`, Restaurar ao código inicial (`data-action="reset"`, só com
    `starterCode`) vai para a barra de título, antes do play.
  - Na prova (`CodeAnswer`): "Rodar pré-testes" (`btn btn-ghost btn-xs`,
    `data-action="run-pretests"`) e "Enviar para correção"
    (`btn btn-outline btn-xs`, `data-action="submit"`), nessa ordem, à
    direita. Sem play no `CodeAnswer` (D1): "Rodar pré-testes" é a ação
    principal e ganha `title` "Rodar pré-testes (Ctrl+Enter)"
    (`code_pretest_run_hint`). Enviar só aparece quando a questão tem
    corretor (`onSubmit`, como hoje), fica desabilitado durante o envio e
    com os envios esgotados, e mostra spinner enquanto envia. A contagem
    ("Envios: 1 de 3"), o valor do próximo envio e o resultado ("Enviado",
    recusa) ficam numa linha de status no rodapé da janela, logo abaixo do
    relatório dos pré-testes.
  - No `snippet`, os botões Editar e Restaurar que hoje flutuam no canto do
    código continuam no canto do código, abaixo da barra de título.
  - Os `data-action` existentes (`run`, `stop`, `reset`, `edit`,
    `run-pretests`, `submit`, `hide-terminal`, `retry`) não mudam: os specs
    atuais dependem deles.
- R4. As bolinhas são três `<button>` dentro de um `role="toolbar"` com
  `aria-label` "Janela do editor", na ordem cinza, vermelha, verde. Cada uma
  tem `aria-label` e `title` ("Tamanho normal", "Recolher editor",
  "Maximizar"; não "Restaurar", que já é o botão de restaurar o código) e
  `data-action` (`window-inline`, `window-collapsed`, `window-maximized`).
  Vermelha e verde têm `aria-pressed`. A área de clique é 24×24 px
  (`size-6`), com a bolinha desenhada em 12 px (`size-3`). Cores:
  `bg-base-content/35`, `bg-error`, `bg-success`.
- R5. A bolinha do estado atual ganha um anel
  (`ring-2 ring-(--code-fg)/60 ring-offset-1 ring-offset-(--code-bg)`). No
  hover e no foco, cada bolinha mostra um glifo (quadrado, traço, seta), como
  no macOS.
- R6. As bolinhas têm uma única parada de Tab (foco móvel): as setas
  esquerda e direita movem o foco, Enter e espaço aplicam.
- R7. O estado começa em `inline` em todo carregamento de página. Não é salvo
  entre páginas nem entre visitas.
- R8. No máximo uma janela fica maximizada por página. Maximizar uma segunda
  devolve a primeira a `inline` (evento `editor-window:maximize` no
  `document`).
- R9. A janela expõe o estado em `data-window-state` (`inline`, `collapsed`,
  `maximized`), para os testes e para o CSS.

### Estado `maximized`

- R10. A janela ocupa a área de conteúdo: `position: fixed`, `right: 0`,
  `bottom: 0`, `left` na borda esquerda de `#content` (à direita da sidebar no
  desktop) e `top` abaixo da navbar e da barra do shell presa mais baixa
  (R11). As medidas são lidas em JS ao maximizar e a cada `resize`: a altura
  das barras depende da rolagem (breadcrumb) e da quebra de linha (barra da
  prova), o que variáveis CSS fixas não acompanham. `z-[25]`: acima do
  conteúdo, abaixo da navbar (`z-30`) e do drawer do celular.
- R11. Barras do shell. Ao maximizar, cada elemento `[data-shell-bar]` cujo
  `position` calculado é `sticky` fica preso onde gruda (`position: fixed`,
  `top` igual ao `top` dele), como se a página já tivesse rolado além dele, e
  se estica por toda a área de conteúdo (`left` de `#content`, `right: 0`). O
  padding cresce pelo que a caixa cresceu, então o conteúdo da barra fica no
  mesmo pixel e só o fundo e as bordas alargam. Ao sair de `maximized`, o
  atributo `style` original de cada barra volta. Sem isso, o breadcrumb, que
  no topo da página ocupa uma linha própria, cobre parte da janela, e a barra
  da prova deixa faixas do fundo dos lados.
  - `src/components/nav/Breadcrumbs.astro` e a barra de
    `src/components/exam/ExamAttempt.tsx` (`sticky top-16`) ganham
    `data-shell-bar`. A janela não conhece nenhuma das duas.
  - O breadcrumb gruda dentro da navbar (`top: 0.875rem`), então não tira
    altura da janela. No celular ele não é `sticky` e não é preso.
- R12. A janela maximizada leva tudo o que o componente desenha: barra de
  título, editor, saída (terminal no `CodeRunner`, relatório de pré-testes no
  `CodeAnswer`), status de envio e contagem ("Envios: 0 de 3...") e o rodapé
  do `CodeEssayAnswer` ("Salvo às HH:MM", aviso de execução desligada). No
  `CodeAnswer` entram também a dica dos pré-testes (`data-pretest-hint`); a
  lista de envios já corrigidos (`data-sends`) fica fora da janela, abaixo
  dela. O editor cresce para a altura livre
  (`[&_.cm-editor]:h-full`); o limite `max-h-96` / `max-h-56` não vale nesse
  estado. A saída fica com no máximo 30% da altura, com rolagem. Quem tira
  o limite de altura é a janela (CSS sobre `data-window-state`), não cada
  host. Com o painel do enunciado aberto, a saída fica na coluna do editor,
  não embaixo do enunciado.
- R13. Enunciado. Nos dois lugares de prova, a janela maximizada mostra o
  enunciado num painel: à esquerda (`lg:w-[38%]`) em tela larga, em cima
  (`max-h-[40%]`) em tela estreita, com rolagem própria e fundo
  `bg-base-100`. Um botão na barra de título ("Esconder enunciado" /
  "Enunciado", `aria-expanded`) recolhe o painel. O painel começa aberto. O
  enunciado é desenhado pelos mesmos componentes que a página usa acima do
  editor (`Markdown` do mdq-js, `AttachmentList`), passados ao
  `EditorWindow` como função de render (`stem?: () => JSX.Element`), não
  como HTML: no `CodeAnswer`, enunciado, anexos e testes de exemplo; no
  `CodeEssayAnswer`, enunciado, anexos e epílogo. O painel só é montado
  enquanto a janela está maximizada.
- R14. No lugar da janela, a página guarda um espaço vazio com a altura que
  ela tinha antes de maximizar, `aria-hidden`, sem texto nem botão, para o
  texto em volta não pular.
- R15. A página atrás não rola: classe `editor-window-open` no `<html>` com
  `overflow: hidden`. O `z-index` do `#content` não muda (subi-lo cobriria o
  drawer do celular).
- R15a. Enquanto maximizada, o conteúdo de `#content` fora da janela fica
  `inert` (o Tab não cai em elementos escondidos atrás dela), exceto as
  barras do shell (`[data-shell-bar]`) e os ancestrais da janela. Ao sair de
  `maximized`, ou ao desmontar, o `inert` original de cada elemento volta.
- R16. Esc com o foco fora do editor (bolinhas, barra de título, saída) volta
  a `inline`. Esc dentro do CodeMirror é do editor: fecha o autocomplete ou a
  busca, cancela os cursores extras (`simplifySelection`, já ligado em
  `src/components/runner/editor.ts`) e mantém o atalho "Esc e depois Tab"
  para sair do editor.
- R17. Ao maximizar, o foco vai para o editor; ao voltar a `inline` ou
  `collapsed` pelas bolinhas, o foco fica na bolinha do novo estado.
- R18. O terminal (xterm) se reajusta ao tamanho novo ao maximizar e ao
  voltar. O CodeMirror já se reajusta sozinho.

### Estado `collapsed`

- R19. A janela vira só a barra de título (R2 e R3), no fluxo da página. O
  editor e a saída ficam escondidos, mas não são desmontados: o código, o
  histórico de desfazer e a execução em curso continuam.
- R20. Rodar (ou executar os pré-testes) com a janela recolhida mostra a
  saída abaixo da barra, sem abrir o editor. O mesmo vale para Enviar (a
  linha de status do envio aparece) e para uma falha de salvamento
  (`data-save="failing"`): com a janela recolhida, o rodapé aparece abaixo
  da barra enquanto o salvamento falha, para o aviso não ficar escondido.
- R21. Uma resposta de prova recolhida continua sendo salva como hoje;
  recolher ou maximizar não dispara salvamento nem entra no histórico de
  edição.

### Animação

- R22. Entre `inline` e `collapsed`, a altura anima com CSS:
  `grid-template-rows` de `1fr` para `0fr` em 200 ms. O texto abaixo da
  janela desliza junto.
- R23. Toda troca que entra ou sai de `maximized` usa
  `document.startViewTransition`, com `view-transition-name` único
  (`editor-window-<n>`) e `view-transition-class: editor-window` dados só à
  janela que muda, durante a transição. CSS da transição:
  - grupo: 220 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`, `overflow: clip`;
  - imagens velha e nova: `object-fit: none`, `object-position: left top`,
    para recortar em vez de esticar o código;
  - sem mistura de opacidade: imagem velha com `display: none`, nova com
    `animation: none`. A caixa cresce em volta do estado novo, opaco do
    começo ao fim. Com a mistura, a página aparecia através da janela no
    meio da animação;
  - raiz (`root`) com `animation: none`: o resto da página não muda.
- R24. Sem suporte à API, ou com `prefers-reduced-motion: reduce`, a troca é
  instantânea, com o mesmo resultado final.

### Textos

- R25. Mensagens novas em `messages/{en,pt-BR}/runner.json`:

  | Chave                          | pt-BR                 | en                 |
  | :----------------------------- | :-------------------- | :----------------- |
  | `runner_window_label`          | Janela do editor      | Editor window      |
  | `runner_window_inline`         | Tamanho normal        | Normal size        |
  | `runner_window_collapse`       | Recolher editor       | Collapse editor    |
  | `runner_window_maximize`       | Maximizar             | Maximize           |
  | `runner_window_stem_show`      | Enunciado             | Question           |
  | `runner_window_stem_hide`      | Esconder enunciado    | Hide question      |
  | `runner_run_hint`              | Executar (Ctrl+Enter) | Run (Ctrl+Enter)   |
  | `code_pretest_run_hint`        | Rodar pré-testes (Ctrl+Enter) | Run pretests (Ctrl+Enter) |

  Reaproveitadas sem mudar o texto: `runner_run` ("Executar"),
  `runner_stop`, `runner_cancel`, `runner_reset`, `code_pretest_run`
  ("Rodar pré-testes"), `code_submit` ("Enviar para correção").

### Catálogo e dados de dev

- R26. A janela entra no catálogo de design: uma seção em
  `src/pages/design/runner.astro` (ou na página de componentes, se o runner
  não for o lugar) com os três estados lado a lado, nos dois temas.
- R27. Nada novo em `src/db/bootstrap.ts`: os três lugares já aparecem nos
  dados de dev (recursos de código do curso, questões dissertativas com
  código e questões `code` das provas do seed).

## Fora do escopo

- Modo `review` (correção): continua sem moldura e sem estados.
- Fullscreen do navegador (`requestFullscreen`). A janela maximizada fica
  dentro do app shell, com a navegação à mostra.
- Lembrar o estado entre páginas ou visitas.
- Redimensionar a janela arrastando, ou janelas lado a lado.
- O painel de conflito de rascunho do `CodeEssayAnswer`: enquanto ele está
  na tela não há editor nem janela. Escolhida a versão, o `CodeRunner` é
  remontado e a janela começa em `inline` (R7).

## Decisões

- Cinza em vez de vermelho para `inline`: vermelho promete "fechar", e
  `inline` não fecha nada. A vermelha recolhe; amarelo foi testado no
  protótipo e não ficou bom.
- Vermelha e verde alternam com `inline`, como um interruptor: é o gesto que
  se espera de clicar de novo no mesmo botão.
- A janela maximizada continua no mesmo lugar do DOM (sem portal): mover o nó
  remontaria o CodeMirror e o xterm e perderia o estado.
- As barras do shell se declaram (`data-shell-bar`) em vez de a janela
  receber seletores: a janela não depende da prova nem do layout.
- Medir em JS, e não com variáveis CSS do `AppLayout`: ver R10.
- Textos: o produto já diz "Executar" para o runner e "Rodar pré-testes";
  o protótipo invertia os dois verbos. Mantidos os textos existentes.
- D1. O `CodeAnswer` não tem execução livre: Ctrl+Enter roda os
  pré-testes. O protótipo mostrava um play falso ali; ficou sem play, com
  "Rodar pré-testes" e Enviar na barra de título (R3).

## Revisão de UX

Rodada do revisor de UX do r2 em 2026-11-17 (relatório em
`.r2/reports/review/runner-janela/ux.md`). Como cada achado foi tratado:

- Barra da prova coberta pela janela maximizada: R10 e R11.
- Status do Enviar e "Salvo às" fora da janela: R12.
- Enunciado coberto: R13.
- Esc colidindo com "Esc e depois Tab": R16.
- Espaço reservado com botão que ninguém vê: R14.
- Bolinhas com cara de decoração e estado atual marcado por "apagado": R4 a
  R6.
- Superfície não mostrada: o protótipo (Contexto) e R2, R3.
- "Colapsar" duplicando "Recolher terminal": R25 ("Recolher editor").
- Atributos para os testes: R4 e R9.
- "Runner" no glossário: Glossário.

## Plano de ação

- T1. Componente (`sonnet`, TDD). `EditorWindow` a partir do protótipo, com
  R1 a R11, R14 a R18, R22 a R24, e `data-shell-bar` em `Breadcrumbs.astro`
  e `ExamAttempt.tsx`. Ligado primeiro ao modo `snippet` do `CodeRunner`.
  Pronto: specs e2e em `test/editor-window.spec.ts` (estados, alternância,
  Esc, foco, barras presas com a página rolada e no topo, sem
  `startViewTransition` com `prefers-reduced-motion`) passando.
- T2. Prova (`sonnet`, TDD). Modo `answer` do `CodeRunner` e `CodeAnswer`:
  barra de ferramentas para dentro da moldura (R2, R3), enunciado (R13),
  saída, envio e rodapé na janela (R12), recolhida (R19 a R21). Depende de
  T1. Pronto: specs e2e de A1 a A8 passando; os specs de prova existentes
  (`exam-code-answer`, `code-question-answer`, `exam-answer-history-code`)
  passando.
- T3. Textos, catálogo e limpeza (`haiku`). R25, R26, entrada no
  `GLOSSARY.md`, remoção de `src/pages/design/playground/janela-do-editor/`,
  `CHANGELOG.md`. Depende de T2. Pronto: `pnpm run lint` 0 e `pnpm test`
  verde.

## Critérios de aceite

- A1. Nos três lugares do Contexto, as bolinhas são botões com nome
  acessível, numa barra com uma parada de Tab; a do estado atual tem anel, e
  vermelha e verde informam `aria-pressed`.
- A2. Clicar de novo na verde (ou na vermelha) com a janela nesse estado
  volta a `inline`.
- A3. Maximizar, com a página no topo ou rolada, cobre a área de conteúdo
  abaixo da navbar e das barras do shell, sem cobrir nenhuma delas; a barra
  da prova fica com a largura da janela e o conteúdo dela não se move; o
  texto da página em volta não muda de posição.
- A4. Código digitado antes de recolher ou maximizar continua lá depois, e o
  Ctrl+Z desfaz a edição anterior à troca.
- A5. Rodar com a janela recolhida mostra a saída sem abrir o editor.
- A6. Esc com o autocomplete aberto fecha a lista e não sai de `maximized`;
  Esc com cursores extras os cancela e não sai; Esc com o foco numa bolinha
  sai.
- A7. Numa prova maximizada, o cronômetro e a navegação entre questões
  continuam visíveis, o enunciado aparece no painel, o resultado de Enviar
  (`CodeAnswer`) e o "Salvo às" (`CodeEssayAnswer`) aparecem dentro da
  janela.
- A8. Com `prefers-reduced-motion: reduce`, nenhum `startViewTransition` é
  chamado.
- A9. Recolher ou maximizar uma resposta de prova não dispara salvamento nem
  muda o histórico de edição.
