---
type: issue
status: todo
tags: [packaging, pypi, install]
kind: enhancement
priority: medium
created: 2026-11-13
creator: claude
---

# Publicar o chalk-worker no PyPI

## Problema

O worker só instala dentro do checkout do codehood. O `pyproject.toml` aponta
o `codehood-cli` para `../../cli` (`[tool.uv.sources]`), e o `codehood-cli`
aponta o `mdq` para `../../mdq/mdq-py`. Fora dessa árvore, como no repositório
próprio (`fabiommendes/chalk-worker`), a instalação falha:

```
× Failed to download and build `codehood-cli @
│ git+https://github.com/fabiommendes/chalk-worker#subdirectory=../../cli`
╰─▶ ... has no subdirectory `../../cli`
```

Na `teste2-elm` (2026-11-13), o worker só rodou em outra máquina com este
contorno:

```sh
uvx --no-sources --from git+https://github.com/fabiommendes/chalk-worker \
  --with "codehood-cli @ git+https://github.com/fabiommendes/codehood#subdirectory=cli" \
  chalk-worker --help
```

## Observação

O código do worker não importa nada do `codehood-cli`. Ele usa `mdq.models`
(`CodeQuestion`, `RunnerReport`, `ReportCase`), `httpx`, `typer` e
`chalk-grader`. O `codehood-cli` entra só para trazer o `mdq`, e o `mdq` já
está no PyPI (0.2.0). Os nomes `chalk-worker` e `codehood-cli` estavam livres
no PyPI em 2026-11-13.

## Proposta

- Trocar a dependência `codehood-cli` por `mdq` e `httpx` diretos, com versão
  mínima. Manter `[tool.uv.sources]` só para o desenvolvimento no subtree
  (`mdq` por caminho), para que um `uv build` gere metadados que resolvam no
  PyPI.
- Conferir se o `mdq` do PyPI tem os modelos que o worker usa. Se não tiver,
  publicar uma versão nova do `mdq` antes.
- Publicar o `chalk-worker` no PyPI, com um fluxo de release (tag → build →
  publish) no repositório próprio, como o `chalk-grader` já faz.
- Atualizar o `README.md`: `uvx chalk-worker ...` e `pip install chalk-worker`.
- Fora do escopo, mas relacionado: publicar o `codehood-cli` também, para que
  o professor instale o CLI sem clonar o codehood.

## Critérios de aceitação

- [ ] `uvx chalk-worker --help` funciona numa máquina sem nenhum checkout.
- [ ] `pip install chalk-worker` num venv limpo instala e roda `--help`.
- [ ] `uv run ruff check && uv run pytest` continua passando no subtree.
- [ ] O `README.md` mostra a instalação pelo PyPI.
