---
type: rfc
status: draft
tags: [runner, config, build, plugins]
relatedTo: [ambiente-de-execucao-no-cliente, runner-elm, runner-de-correcao]
created: 2026-11-10
creator: claude
---

# Runners como plugins

## Problema

Uma linguagem nova no runner exige mexer em pelo menos 12 lugares do
repositório. Por isso:

- terceiros que queiram suportar uma linguagem própria precisam fazer um fork;
- não dá para tirar dos nossos runners as linguagens que uma instância não usa;
- não dá para mover os runners atuais para projetos separados.

Pontos tocados hoje por linguagem:

| Arquivo                                     | O que guarda                                       |
| :------------------------------------------ | :------------------------------------------------- |
| `src/runner/protocol.ts`                    | `languageId` (enum zod)                            |
| `src/runner/languages.ts`                   | aliases, extensão, modo padrão, nome de arquivo    |
| `src/runner/sandbox/drivers/index.ts`       | `DRIVERS`, um `import()` por linguagem             |
| `src/runner/sandbox/runtimes.ts`            | `RUNTIMES`, de tipo fechado                        |
| `src/runner/server/integration.ts`          | cache do Elm fixo, `restrictImports`, `watched`    |
| `src/runner/server/assets.ts`               | arquivos de runtime servidos (lê `RUNTIMES`)       |
| `src/components/runner/editor.ts`           | `if/else` com o modo CodeMirror de cada linguagem  |
| `src/components/runner/shiki-highlight.ts`  | `GRAMMARS`                                         |
| `src/components/runner/CodeRunner.tsx`      | `LANGUAGE_LABELS` e avisos de restart Prolog/Elm   |
| `messages/*.json`                           | `runner_language_*`, `runner_*_restarts`           |
| `src/db/bootstrap.ts`                       | exemplos de cada linguagem                         |
| `test/runner-*.spec.ts`                     | casos por linguagem                                |

## Proposta

Um runner vira um **plugin**: um pacote que descreve a linguagem e aponta para
os módulos de cada ambiente. A instância escolhe os plugins em
`codehood.config.ts`. O build gera os registros que hoje são escritos à mão.

### Três ambientes, três módulos

O código de um runner roda em três lugares que não podem se misturar:

- **sandbox**: o Worker na origem do runner. É o driver, bundlado pelo esbuild
  com `restrictImports`;
- **app**: a página do Codehood. Aqui ficam o modo do CodeMirror e a gramática
  do Shiki, carregados por `import()`;
- **build**: Node, no `astro build` e no `astro dev`. Aqui ficam passos como
  o cache de pacotes do Elm.

Por isso o descritor do plugin é **só dado**. Ele não importa o driver: aponta
para ele por especificador. Assim, importar o config (o servidor faz isso no
boot) não puxa código de sandbox nem de build.

```ts
// packages/runner-scheme/src/index.ts
import { defineRunner } from "@codehood/runner-api";

export default function scheme() {
	return defineRunner({
		apiVersion: 1,
		id: "scheme",
		aliases: ["scheme", "scm", "ss"],
		extension: "scm",
		modes: ["script", "repl"],
		defaultMode: "script",
		label: { en: "Scheme" },
		notes: {
			restart: {
				en: "Each Run starts a fresh interpreter.",
				"pt-BR": "Cada execução começa um interpretador novo.",
			},
		},
		driver: "@codehood/runner-scheme/driver",
		editor: "@codehood/runner-scheme/editor",
		grammar: { shiki: "scheme" },
		runtimes: [
			{
				pkg: "biwascheme",
				version: "0.8.3",
				files: { "release/biwascheme.js": "biwascheme.mjs" },
				wrap: { "biwascheme.mjs": { prefix: "...", suffix: "..." } },
			},
		],
		sandboxDependencies: [],
	});
}
```

Campos:

- `id`: `[a-z][a-z0-9-]*`. É único entre os plugins e não pode ser `fake`.
- `aliases`: tags de bloco de código e de `CODE.language`. Um alias repetido
  entre plugins falha o build.
- `extension`, `defaultFilename` (opcional, padrão `main.<extension>`),
  `modes`, `defaultMode`.
- `label` e `notes`: textos por locale, com fallback para `en`. Ficam fora do
  paraglide, porque o plugin não edita `messages/*.json`. Como o locale é
  constante de build, o módulo gerado embute só o texto do locale escolhido.
- `driver`: módulo cujo `default` implementa `Driver`. Obrigatório.
- `editor`: opcional. Módulo cujo `default` é
  `() => Extension | Promise<Extension>`; ele importa o que precisar do
  CodeMirror (`@codemirror/*` como `peerDependencies`). Sem ele, o editor fica
  sem suporte estrutural (indentação, parênteses); as cores do Shiki
  continuam.
- `grammar`: `{ shiki: "<nome embutido>" }` ou `{ module: "<especificador>" }`
  para uma gramática TextMate própria. Serve ao editor e à vista só leitura do
  servidor (`src/utils/highlight-code.ts`).
- `runtimes`: lista de `RuntimePackage`, com o mesmo formato de hoje. O build
  copia os arquivos para `/runner/rt/<pkg>@<versão>/` e confere a versão
  instalada.
- `sandboxDependencies`: pacotes que o driver pode importar além da API (como
  `acorn` hoje).
- `build`: opcional. Módulo Node cujo `default` é
  `(ctx: BuildContext) => Promise<void>`. Ele escreve arquivos no bundle do
  runner (`ctx.emit(nome, bytes)`) e declara as entradas do cache
  (`ctx.inputs`). O cache do Elm passa a ser isto.

Especificadores são resolvidos a partir da raiz do projeto: um nome de pacote
(com `exports` no `package.json`) ou um caminho relativo à raiz para plugins
dentro do repositório.

### Config

`runner.languages` entra no config como constante de build:

```ts
// codehood.config.ts
import elm from "@codehood/runner-elm";
import python from "@codehood/runner-python";
import scheme from "@codehood/runner-scheme";
import { defaultRunners } from "@/runner/plugins";

export default defineConfig({
	runner: {
		origin: null, // build-time constant
		languages: [...defaultRunners(), scheme()], // build-time constant
	},
});
```

- `defaultRunners()` devolve só Python, JavaScript e TypeScript. Quem não
  lista `languages` recebe esse padrão. Lua, Prolog e Elm viram plugins; o
  config de desenvolvimento, o de testes e o deploy de codehood.dev listam
  todos os suportados.
- O zod valida a forma do descritor, ids e aliases únicos e o `apiVersion`.
- `fake` não é plugin: o build o registra fora de produção, como hoje.

### Build

`runnerBundle()` lê `config.runner.languages` e gera:

- `virtual:codehood/runners` (app e servidor): id, aliases, extensão, modos,
  rótulo, avisos e um `import()` por `editor` e por `grammar`. Substitui
  `ALIASES`, `EXTENSIONS`, `GRAMMARS`, `LANGUAGE_LABELS`, o `if/else` do
  editor e os avisos de restart;
- a entrada do sandbox `drivers.gen.ts`, com um `import()` por driver.
  Substitui `DRIVERS`;
- a lista de runtimes que `copyRuntimes` e `assets.ts` usam. Substitui
  `RUNTIMES` como registro (o tipo `RuntimePackage` fica na API);
- as chamadas dos hooks `build`, cada uma com o seu cache em
  `node_modules/.cache/runner-<id>/`.

`restrictImports` passa a aceitar:

- os diretórios de cada plugin listado;
- os pacotes em `sandboxDependencies`;
- `@codehood/runner-api`, além do que aceita hoje.

O `astro dev` observa esses diretórios para refazer o bundle.

### Protocolo

- `languageId` passa de enum para `z.string().regex(/^[a-z][a-z0-9-]*$/)`.
- O frame recusa um `start` ou `prepare` para uma linguagem fora do seu
  registro. Ele já anuncia as suas linguagens em `ready`, então o app sabe o
  que existe.
- `RUNNER_PROTOCOL_VERSION` não muda: o formato das mensagens é o mesmo.
- `LanguageId` vira `string`. O `runnerLanguage()` continua sendo a única
  porta de entrada a partir de tags.

### `@codehood/runner-api`

É um pacote do workspace pnpm, com um `package.json` próprio. Exporta:

- os tipos `Driver`, `LoadContext`, `RunContext`, `Diagnostic`, `RunMode`,
  `RuntimePackage`, `RunnerPlugin` e `BuildContext`;
- `defineRunner`, que valida em tempo de desenvolvimento e devolve o
  descritor;
- `runtimeDir` e `runtimePath`, os caminhos de um runtime sob `/runner/rt/`;
- `StdinCancelled`;
- os schemas `languageId` e `runMode`, que o protocolo reaproveita.

Ele não pode importar nada de `src/`. Os drivers internos importam dele, e
isso prova que a API basta.

Três entradas, para o sandbox não levar o que não usa:

| Entrada                        | Conteúdo                                         | Sandbox |
| :----------------------------- | :----------------------------------------------- | :------ |
| `@codehood/runner-api`         | descritor (`defineRunner`, schema), `BuildStep`  | não     |
| `@codehood/runner-api/driver`  | tipos do driver, `runtimePath`, `StdinCancelled` | sim     |
| `@codehood/runner-api/schema`  | `languageId`, `runMode` (zod)                    | sim     |

O `restrictImports` aceita só os arquivos de `./driver` e `./schema`: um
driver que importa o descritor quebra o build. Os helpers de erro de sintaxe
do JavaScript ficaram no driver, porque só ele e o TypeScript os usam.

### Kit de contrato

`@codehood/runner/testing/contract` exporta `runnerContractTests(contract)`,
que declara num spec Playwright os testes que todo plugin precisa passar, no
frame real servido pelo servidor de teste do core:

- o frame anuncia a linguagem em `ready`;
- um programa lê a linha `hello` e a imprime (código 0);
- um erro na linha 3 aparece em stderr apontando essa linha;
- `stop` encerra um laço infinito, e o frame roda de novo em seguida.

O plugin fornece os programas, porque são escritos na linguagem dele
(`src/runner/plugins/<id>/test/contract.spec.ts`). O laço é opcional: o Elm
não o declara. Diagnósticos do editor e os modos ficam nos casos específicos
de cada plugin.

### Testes fora da suíte principal

Os testes do runner são caros (baixam e iniciam runtimes de dezenas de MB, e
o protocolo espera tempos de tolerância do service worker) e quase nunca
quebram por mudanças fora dele. Por isso o core do runner é um pacote do
workspace, `@codehood/runner` (`packages/runner`), com a própria suíte:

| Pacote                  | Conteúdo                                                        |
| :---------------------- | :-------------------------------------------------------------- |
| `@codehood/runner-api`  | contrato dos plugins: descritor, tipos do driver                |
| `@codehood/runner`      | sandbox (frame, worker, sw, stdin, driver `fake`), protocolo, `RunnerHost`, build do bundle, roteamento e handler da origem do runner, registro gerado, infraestrutura de teste (`testing/`) |
| app (`src/runner/`)     | plugins internos (descritor, driver, editor, runtime e testes), `languages.ts` e a cola com `codehood:config` |

| Suíte                     | Comando                  | Conteúdo                                         | Tempo  |
| :------------------------ | :----------------------- | :----------------------------------------------- | :----- |
| principal (`test/`)       | `pnpm test`              | endpoint, origem, widget, revisão, blocos e recursos de código, controles de `/design/runner`, cookie de sessão; driver `fake` e JavaScript | parte dos ~3 min do e2e |
| core (`packages/runner/test/`) | `pnpm run test:runner` | protocolo, host, frame, isolamento e stdin, com `fake` e JavaScript | ~20 s |
| plugins (`src/runner/plugins/<id>/test/`) | `pnpm run test:plugins` | contrato e casos de cada linguagem | ~1 min |

- O servidor de teste (`@codehood/runner/testing/server`) não usa Astro nem
  banco: um `node:http` na porta 0 responde como app em `localhost` (uma
  página que expõe `RunnerHost` em `window.__runner`) e como origem do
  runner em `127.0.0.1` (`serveRunner`, o mesmo handler da app).
- `runnerGlobalSetup` monta o bundle, sobe o servidor e passa as origens aos
  workers. O bundle de teste encurta a tolerância de canal desconhecido do
  service worker (`stdinGraceMs`, 1,5 s em vez de 5 s).
- Cada plugin é um projeto Playwright: `pnpm run test:plugins
  --project=python` monta o bundle só com ele.
- A história "student: run a code example" roda dois exemplos em JavaScript.
- `test/scope.ts` só varre `test/`, então nada em `packages/` ou
  `src/runner/plugins/` entra na suíte principal.
- **CI**: um job `runner` roda as duas suítes. Sem filtro por caminho: juntas
  levam menos de dois minutos.

## Ordem de implementação

1. **Refatoração interna.** Cada linguagem ganha um descritor em
   `src/runner/plugins/<id>/`; os drivers ficam onde estão por enquanto. Os
   pontos da tabela passam a ler o registro gerado. Os testes atuais servem
   de rede, e nada muda para o usuário de uma instância que lista as seis.
2. **`packages/runner-api`** como workspace pnpm. Os drivers internos importam
   dele. Feito.
3. **`packages/runner-scheme`**, que importa só `@codehood/runner-api`. Não
   entra no padrão; é instalável.
4. **Kit de contrato**, aplicado às seis linguagens internas, e o core em
   `packages/runner` com suíte própria. Feito; falta o Scheme.
5. Mais tarde: mover os runners atuais para `packages/` ou para repositórios
   próprios.

## Motor do Scheme (spike de 2026-11-10)

Testei dois pacotes no Node (sem browser):

- **BiwaScheme 0.8.3** (MIT, 270 KB min):
  - `read-line` síncrono funciona com um `define_libfunc` que chama
    `readLine()`;
  - a saída é capturada por `Port.CustomOutput`;
  - `call/cc` funciona;
  - **lento**: um laço de cauda com 10⁶ iterações leva 5 s;
  - **não tem bignum**: `(expt 2 100)` dá `1.26e+30`;
  - os erros não trazem a linha;
  - o build ESM do pacote chama `window.jQuery` e `document.querySelector` ao
    carregar, então o Worker precisa de um wrap com stubs.
- **LIPS 1.0.0-beta.20** (MIT): sem `call/cc` ("Continuations are not
  implemented yet"). A biblioteca padrão precisa de bootstrap à parte e a API
  é assíncrona. Descartado.
- Nenhum Scheme em wasm publicado no npm (Chibi, s7, Gambit). Usar um deles
  exige compilar com Emscripten e publicar os binários.

O plugin Scheme serve para validar a API. O BiwaScheme basta para isso, e o
wrap com stubs ainda exercita o `wrap` de runtimes. Se um curso precisar de
Scheme de verdade (bignum, desempenho, R7RS), o motor muda dentro do plugin
sem mexer na API.

## Fora de escopo

- Carregar plugins em runtime por URL. Os plugins entram só no build; trocar
  de plugin exige um novo release.
- O runner de correção (`dev/specs/to-review/runner-de-correcao.md`). O
  descritor pode ganhar uma metade `grader` depois.
- Plugins de outras categorias (tipos de questão, temas). O formato do
  config já tem lugar para elas.

## Segurança

- Um plugin é uma dependência de build com acesso total ao build e ao bundle
  do runner. Confiar nele é decisão de quem opera a instância, como com
  qualquer pacote.
- O isolamento do runner não muda: o driver continua na origem do runner,
  dentro do Worker travado. `restrictImports` continua impedindo que o bundle
  do sandbox importe código do app.
- O app só usa do plugin texto (rótulos, avisos) e módulos de editor, que
  rodam na origem do app. O rótulo e os avisos são escapados como qualquer
  texto. O módulo de editor é código de terceiro na origem do app, e esse é o
  maior risco do desenho. Escolher o plugin no build é aceitar esse risco.

## Decisões

- Especificadores resolvidos a partir da raiz do projeto (pacote com
  `exports` ou caminho relativo à raiz).
- O módulo `editor` pode ser código do plugin. Escolher o plugin no build já
  é aceitar a cadeia de confiança dele.
- Scheme não entra em `defaultRunners()`.
- Padrão: Python, JavaScript e TypeScript.
