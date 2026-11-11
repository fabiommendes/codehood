# @codehood/runner-api

Contrato entre o Codehood e os plugins de linguagem do executor de código.
O desenho está em `dev/rfc/runners-como-plugins.md`.

| Entrada                       | Quem importa                         |
| :---------------------------- | :----------------------------------- |
| `@codehood/runner-api`        | o descritor do plugin e o build step |
| `@codehood/runner-api/driver` | o driver, dentro do sandbox          |
| `@codehood/runner-api/schema` | o protocolo do executor              |

```ts
// plugin.ts
import { defineRunner } from "@codehood/runner-api";

export const scheme = () =>
	defineRunner({
		apiVersion: 1,
		id: "scheme",
		extension: "scm",
		modes: ["script"],
		defaultMode: "script",
		label: { en: "Scheme" },
		driver: "@codehood/runner-scheme/driver",
	});
```

```ts
// driver.ts
import type { Driver } from "@codehood/runner-api/driver";

const driver: Driver = {
	language: "scheme",
	modes: ["script"],
	async load(ctx) {},
	async run(ctx) {
		ctx.stdout("hello\n");
		return 0;
	},
};
export default driver;
```

O driver é empacotado no sandbox e só pode importar `./driver` deste pacote,
os arquivos ao lado dele e os pacotes que declarar em `sandboxDependencies`.
