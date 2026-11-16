---
type: spec
status: implemented
tags: [release, ci, mdq, cli, chalk-worker]
relatedTo: [mdq-biblioteca]
---

# Versões e repositórios irmãos

## Contexto

O servidor, a CLI e o chalk-worker saem do mesmo repositório. O mdq vive em
`../mdq` (mdq-spec) e entra de três jeitos: o servidor embute `mdq-js` (via
`link:../mdq/mdq-js`, que lê o `dist`), a CLI depende de `mdq>=X.Y.Z` do PyPI
com um caminho local em `[tool.uv.sources]`. Nada fixava qual commit do mdq o
codehood usa: um release saía com o que `../mdq` tivesse (sujo, sem push,
`dist` velho), o CI baixava a `main` do mdq-spec e a tag não registrava o mdq.

## Decisões

1. **`.mdq-ref`** (raiz) guarda o SHA completo do commit do mdq com que o
   codehood é construído e testado.
2. **Uma versão só** para `package.json`, `cli/pyproject.toml` e
   `workers/chalk-worker/pyproject.toml`. O worker exige
   `codehood-cli==<mesma versão>` e mantém um caminho local em
   `[tool.uv.sources]`. O worker não é publicado e o release não faz subtree
   push dele. Os pacotes `packages/runner*` são `private`.
3. **mdq-js, mdq-py e spec** compartilham MAJOR.MINOR (o patch pode divergir), e
   o limite inferior `mdq>=` da CLI tem o mesmo MAJOR.MINOR.
4. **Checagens entre repositórios a cada push**, não só no release.

## Uso

| Comando                                          | O que faz                                                                 |
| :----------------------------------------------- | :------------------------------------------------------------------------ |
| `pnpm run check:siblings`                        | Avisa (exit 0) o que diverge de `.mdq-ref`. Roda no `pnpm run lint`.       |
| `pnpm exec tsx scripts/check-siblings.ts --strict` | Qualquer problema vira erro (exit 1). Usado no release.                  |
| `... --ci`                                       | `--strict` sem a checagem de push (o checkout do CI vem do remoto).        |
| `... --fetch`                                    | Roda `git fetch origin` em `../mdq` antes, para o push não depender de ref velha. |
| `pnpm run check:versions`                        | Falha se as três versões ou o pin do worker diferem. Roda no lint e no CI. |
| `pnpm run mdq:bump`                              | Grava o HEAD de `../mdq` em `.mdq-ref` e reconstrói o `dist` do mdq-js. Recusa árvore suja ou commit sem push. |

`check-siblings` verifica: `../mdq` no commit de `.mdq-ref`; mdq-js, mdq-py e
schema sem alterações não commitadas; commit em algum branch remoto
(`git branch -r --contains`, sem rede salvo `--fetch`); `mdq-js/dist/.build-sha`
(gravado pelo `build` do mdq-js: SHA do HEAD, com `-dirty` se havia alterações)
igual a `.mdq-ref` e sem `-dirty`; e o
MAJOR.MINOR de mdq-js, mdq-py, schema e do `mdq>=` da CLI.

Para adotar um mdq novo: commit e push em `../mdq`, `pnpm run mdq:bump`,
`pnpm run lint`, commit de `.mdq-ref`.

## Release

`pnpm run release` roda `check-siblings --strict --fetch` e `check-versions`,
e exige que a versão de `mdq` pedida pela CLI exista no PyPI (senão: "Publish
mdq-py X first"). Depois sobe as três versões (o worker também troca o pin de
`codehood-cli` e regera `uv.lock`) e grava na mensagem da tag:

```
Codehood X.Y.Z

mdq: <sha> (mdq-js A, mdq-py B, spec C)
```

## CI

- Todo checkout do mdq-spec usa `ref:` lido de `.mdq-ref`; os jobs `lint`,
  `test` e `runner` rodam `check-siblings --ci`. O job `cli` não roda Node e
  não checa o `dist`.
- `cli-pypi`: testes da CLI com `uv run --no-sources`, como o release, para um
  mdq-py não publicado aparecer no push.
- `cli` também roda os testes do chalk-worker (com o caminho local do mdq).

## Fora do escopo

- O worker com `--no-sources` no CI: o pin `codehood-cli==X` só existe no PyPI
  depois da tag.
