---
type: issue
status: active
tags: [cli, mdq, testing]
relatedTo: [cli-widgets, mdq-py]
---

# Testes da CLI quebrados pela evolução do `mdq`

Quatro testes de `cli/` falham com o checkout atual de `../../mdq/mdq-py`
(último commit `0339e56`, "Regenerate the schema bundle"):

- `tests/test_widgets_questions.py::test_multiple_choice_records_the_picked_id`
- `tests/test_widgets_questions.py::test_true_false_leaves_an_unjudged_statement_out_of_answers`
- `tests/test_widgets_questions.py::test_fill_in_produces_one_typed_response_per_blank`
- `tests/test_push_run.py::test_run_plan_upsert_question_short_answer_keeps_camel_case_aliases`
  (`KeyError: 'openEnded'`)

Os erros vêm de regras novas do `mdq`, por exemplo
`InvalidDocument: error unreferenced-blank: blank 'capital' is never
referenced by a [^capital] marker in the stem`, e de ids de itens que mudaram
de forma. Os testes de widgets também variam entre execuções (2 a 4 falhas),
o que sugere ids gerados ou ordem de conjunto instável.

Não tem relação com a chamada: as falhas já existiam antes dela. Corrigir
atualizando os documentos de teste para a sintaxe atual do `mdq` e fixando a
ordem nos asserts.
