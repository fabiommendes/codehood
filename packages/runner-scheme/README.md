# @codehood/runner-scheme

Scheme para o runner do Codehood, com o
[BiwaScheme](https://www.biwascheme.org/) 0.8.3 (um interpretador R7RS em
JavaScript). É um plugin de fora do núcleo: importa só `@codehood/runner-api`.

```ts
// codehood.config.ts
import scheme from "@codehood/runner-scheme";

export default defineConfig({
	runner: { languages: [...defaultRunners(), scheme()] },
});
```

- Tags: `scheme`, `scm`, `ss`. Arquivo padrão `main.scm`, modos `script` e
  `repl`.
- `display`, `write` e `newline` escrevem no terminal; `read-line` lê uma
  linha (o objeto eof no fim da entrada); `(exit n)` termina com o código `n`.
- Um erro aponta a linha onde começa a forma de topo que falhou, não a linha
  exata dentro dela: o BiwaScheme não guarda posições.
- Limites do motor: sem bignum, e lento em laços longos (10⁶ iterações levam
  segundos).

Testes: `pnpm run test:scheme` na raiz do Codehood. A suíte monta o bundle
com este pacote como raiz, como faria uma instância que o instala, e roda o
contrato de `@codehood/runner/testing/contract` mais os casos de
`test/scheme.spec.ts`.
