# chalk-worker

Worker pull do codehood: pede trabalhos de correção de questões de código ao
servidor, corrige na máquina do professor com o `chalk-grader` e devolve o
feedback com a chave `BOT` do professor. Ver `README.md`.

## Idioma

Nível 2 (`~/git/tools/tooling-root/dev/adr/0002-idioma-dos-repositorios.md`):
código, comentários e `README.md` em inglês; `AGENTS.md` e `dev/` em
português.

## Verificação

```sh
uv run ruff check && uv run pytest
```

## Contexto

- Repositório próprio, incluído no codehood como subtree em
  `workers/chalk-worker/`. Depende de `codehood-cli` por caminho
  (`../../cli`), então só resolve dentro do checkout do codehood. Sincronizar
  com o repositório próprio só quando o humano pedir, a partir da raiz do
  codehood:
  `git subtree push --prefix=workers/chalk-worker git@github.com:fabiommendes/chalk-worker.git main`
  (ou `subtree pull` com os mesmos argumentos).
- Desenho: RFC "Worker de correção do codehood (modelo pull)" no repositório
  do chalk (`dev/rfc/worker-de-correcao-do-codehood-modelo-pull.md`) e RFC
  `dev/rfc/fila-de-correcao-externa.md` do codehood (fila `GradingJob`,
  claim com lease).
- O motor é o `chalk-grader` (PyPI). Não depende do chalk. Mudança no motor
  vai para o repositório do chalk, não para cá.
- Os `packages/runner*` do codehood rodam código no frontend; não têm relação
  com este worker.
