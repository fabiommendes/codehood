---
type: adr
status: accepted
tags: [release, ci, mdq, cli, chalk-worker]
created: 2026-11-17
creator: claude
---

# Versão única e mdq fixado por `.mdq-ref`

O servidor, a CLI e o chalk-worker saem deste repositório com uma versão só.
O mdq vive em `../mdq` (mdq-spec) e o commit com que o codehood é construído e
testado fica gravado em `.mdq-ref`.

## Contexto

O mdq entra de três jeitos: o servidor embute `mdq-js` (`link:../mdq/mdq-js`,
que lê o `dist`), a CLI depende de `mdq>=X.Y.Z` do PyPI com caminho local em
`[tool.uv.sources]`, e o CI faz checkout do mdq-spec. Sem um commit fixado, um
release saía com o que `../mdq` tivesse (sujo, sem push, `dist` velho) e a tag
não registrava qual mdq usou.

## Decisão

- `.mdq-ref` (raiz) guarda o SHA completo do commit do mdq.
- `package.json`, `cli/pyproject.toml` e `workers/chalk-worker/pyproject.toml`
  têm a mesma versão. O worker exige `codehood-cli==<mesma versão>` e mantém
  caminho local em `[tool.uv.sources]`. Os `packages/runner*` são `private`.
- mdq-js, mdq-py e o schema da spec compartilham MAJOR.MINOR (o patch pode
  divergir), e o `mdq>=` da CLI tem o mesmo MAJOR.MINOR.
- As checagens entre repositórios rodam a cada push, não só no release: uma
  divergência descoberta no release já está velha.

## Uso

| Comando                                            | O que faz                                                                     |
| :------------------------------------------------- | :---------------------------------------------------------------------------- |
| `pnpm run check:siblings`                          | Avisa (exit 0) o que diverge de `.mdq-ref`. Roda no `pnpm run lint`.         |
| `pnpm exec tsx scripts/check-siblings.ts --strict` | Todo problema vira erro (exit 1).                                             |
| `... --ci`                                         | `--strict` sem a checagem de push (o checkout do CI já vem do remoto).        |
| `... --fetch`                                      | `git fetch origin` em `../mdq` antes, para a checagem de push não usar ref velha. |
| `pnpm run check:versions`                          | Falha se as três versões ou o pin do worker diferem. Roda no lint.            |
| `pnpm run mdq:bump`                                | Faz `git fetch origin` em `../mdq`, recusa árvore suja ou HEAD sem push, reconstrói o `dist` do mdq-js e grava o HEAD em `.mdq-ref`. |

`check-siblings` verifica: `../mdq` no commit de `.mdq-ref`; mdq-js, mdq-py e
schema sem alterações não commitadas; o commit em algum branch remoto
(`git branch -r --contains`); `mdq-js/dist/.build-sha` (gravado pelo `build`
do mdq-js, com sufixo `-dirty` se havia alterações) igual a `.mdq-ref` e sem
`-dirty`; o MAJOR.MINOR de mdq-js, mdq-py, schema e do `mdq>=` da CLI.

Para adotar um mdq novo: commit e push em `../mdq`, `pnpm run mdq:bump`,
`pnpm run lint`, commit de `.mdq-ref`.

## Release

`pnpm run release` roda `check-siblings --strict --fetch` e `check-versions` e
exige que a versão de `mdq` pedida pela CLI exista no PyPI ("Publish mdq-py X
first"). Depois sobe as três versões (o worker troca também o pin de
`codehood-cli` e regera `uv.lock`) e grava o mdq na mensagem da tag:

```
Codehood X.Y.Z

mdq: <sha> (mdq-js A, mdq-py B, spec C)
```

A tag publica a CLI e depois o worker no PyPI
(`.github/workflows/publish-python.yml`).

## CI

- Todo checkout do mdq-spec usa `ref:` lido de `.mdq-ref`. Os jobs `lint`,
  `test` e `runner` rodam `check-siblings --ci`. O job `cli` não roda Node e
  não checa o `dist`; ele também roda os testes do chalk-worker.
- `cli-pypi` testa a CLI com `uv run --no-sources`, como o release, para um
  mdq-py não publicado aparecer já no push.
- O worker não roda com `--no-sources` no CI: o pin `codehood-cli==X` só existe
  no PyPI depois da tag.

## Consequências

- Uma tag identifica o mdq exato com que foi testada.
- Mexer em `../mdq` sem bump gera aviso no lint local e erro no CI e no
  release.
