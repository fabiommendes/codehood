---
type: spec
status: to-do
tags: [ui, design-system, accessibility]
relatedTo: [toggle-group, card-actions]
---

# Varredura de toggles e ações

Duas regras de consistência, aplicadas em `src/pages/` e `src/components/`.

## Regras

1. Botões de ação (primário, de página, de card, rodapé de formulário) ficam à
   direita. Em linha com mais de um botão, o primário é o último (cancelar
   antes de confirmar).
2. Grupos de alternância (filtros segmentados) usam um único componente,
   `src/components/ui/ToggleGroup.tsx`, com o mesmo tamanho (`btn-sm`) e fonte
   em todo lugar.

## `ToggleGroup`

- `options`: `{ value, label, href?, attrs? }[]`; `label`: nome acessível do grupo.
- `mode="single"` (padrão): `value: V | null`, `onChange(value)`.
- `mode="multiple"`: `value: V[]`, `onChange(selecao)` recebe a seleção inteira.
- Opção com `href` vira `<a aria-current="true">` (filtros na query string,
  renderizados no servidor, sem hidratar). Sem `href` vira `<button aria-pressed>`.
- `attrs` repassa `data-*` por opção.

### Cor

Selecionado: `btn-primary` sólido e `font-semibold`. Não selecionado: `btn`
padrão com peso normal. `btn-active` sozinho muda só o fundo para um cinza
quase igual ao do botão comum, que era o defeito. Primário foi mantido: o
verde sólido com texto claro tem contraste alto nos dois temas e o grupo é
pequeno (`btn-sm`), então não pesa ao lado do resto. `secondary`/`accent` e
variantes `soft`/`outline` foram descartados por contraste menor contra o
botão comum. O peso da fonte dá uma segunda pista que não depende de matiz.

## Inventário

Toggles:

| Onde | O que | Ação |
| :--- | :--- | :--- |
| `src/components/report/ReportFilters.astro` | dois grupos `join` de links (status, tipo), `btn-active` | `ToggleGroup` com `href` |
| `src/components/question/QuestionsTable.tsx` | `join` de status, multisseleção, `btn-active` | `ToggleGroup mode="multiple"` |

Revisados e mantidos:

- `src/components/question/QuestionPage.tsx`, `QuestionPreview.tsx`: `tabs-box`
  com `role="tab"`. Troca de visão do mesmo conteúdo, não filtro.
- `src/components/ui/Tabs.astro`, `src/pages/index.astro` (abas da demo):
  navegação por abas / decoração.
- `src/components/ui/Pagination.tsx`: pager, `aria-current="page"`.
- `src/components/dev/VariantPicker.astro`, `src/pages/design/components/_ComponentsPage.astro`:
  ferramentas do catálogo, já usam `btn-sm btn-primary` ativo; ficam fora do app.
- `src/components/grading/RubricPanel.tsx` (radiogroup de itens de rubrica) e
  `src/pages/design/playground/correcao-objetivas/*` (outro trabalho): fora do escopo.

Ações que não estavam à direita:

| Onde | Correção |
| :--- | :--- |
| `src/components/report/ReportQueue.tsx` (salvar) | `flex justify-end` |
| `src/components/grading/GradeForm.tsx`, `BlankGradeForm.tsx` | `justify-end`, cancelar antes de salvar |
| `src/components/grading/RegradeResolve.tsx` | `justify-end`, rejeitar antes de aceitar |
| `src/components/grading/RubricGrader.tsx` (fim da fila) | `justify-end`, primário por último |
| `src/components/grading/RubricEditor.tsx` (dividir, renomear) | `justify-end` / `self-end` |
| `src/components/grading/NewRubricItem.tsx` | `self-end` |
| `src/components/repository/RotateToken.astro` | cancelar antes de confirmar (e à direita via `card-actions`) |
| `src/pages/[discipline]/[course]/settings.astro` (gerar convite) | `flex justify-end` |
| `src/pages/profile.astro` (criar chave de API) | `flex justify-end` |
| `.card-actions` (`profile`, `login`, `check-in`, `courses/join`, `RotateToken`) | regra global `justify-content: flex-end` em `src/styles/global.css` |

Já corretos: `modal-action` (daisyUI alinha à direita), cabeçalhos com
`justify-between` e ação à direita, botões `btn-block` (largura total).

Deixados: `src/pages/getting-started.astro` (botão em linha com texto, não
é rodapé de ação) e `Tuner.astro` (ferramenta de dev).

## Catálogo

`src/pages/design/elements.astro`: seção `ToggleGroup` e uma instância dentro
de cada tema do bloco "Both themes" (`src/components/design/ToggleGroupDemo.tsx`).
`src/pages/design/components/reports.astro` já mostra os filtros de relatório.
