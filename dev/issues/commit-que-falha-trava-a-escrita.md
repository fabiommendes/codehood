---
type: issue
status: todo
tags: [database, sqlite, ops, exam]
relatedTo: [sqlite-em-modo-wal, lentidao-na-prova-de-2026-11-18]
kind: defect
priority: high
created: 2026-11-19
creator: claude
---

# Um `COMMIT` que falha por banco ocupado trava toda a escrita

## Sintoma

Em 2026-11-19, das 17:06:20 às 17:13:46 (America/Sao_Paulo), todo
`exam.answer` em produção respondeu 400 depois de 2 s. Havia 4 alunos numa
prova e pelo menos 156 saves foram recusados. As leituras continuaram
funcionando. Só voltou com `systemctl restart codehood`.

## O que disparou

Uma consulta feita à mão na VPS, com `sqlite3 -readonly`, varreu `Submission`
por 19 s. O banco estava em `journal_mode=delete`, em que um leitor segura o
lock compartilhado e nenhum commit entra enquanto ele não termina.

O log do servidor, no primeiro save que falhou:

```
{"event":"slow-query","at":"2026-11-19T20:06:20.958Z","ms":5034.2,"sql":"COMMIT","op":"response.answer"}
```

Dali em diante cada `response.answer` levou 2000 ms, com uma query só, e
falhou. O arquivo `codehood.db-journal` ficou no disco até o restart.

## Causa, reproduzida em 2026-11-19

Dois defeitos em sequência no `@prisma/adapter-better-sqlite3` 7.9.1, que só
aparecem em `journal_mode=delete`:

1. O `COMMIT` espera o leitor pelos 5 s do `timeout` padrão do
   better-sqlite3 e falha com `SQLITE_BUSY`. Ninguém manda `ROLLBACK`: a
   conexão, que é uma só, continua dentro da transação.
2. A transação seguinte pega o mutex do adapter e o `BEGIN` falha com
   "cannot start a transaction within a transaction". `startTransaction` não
   solta o mutex nesse caminho. Daí em diante toda transação espera o mutex
   pelos 2 s do `maxWait` do Prisma e falha com "Unable to start a
   transaction in the given time". Leituras fora de transação não passam
   pelo mutex e continuam funcionando.

Saída do script abaixo, com `DATABASE_JOURNAL_MODE=delete`:

```
1 before the reader: ok in 125 ms
reader holds the shared lock
2 with the reader open: FAILED in 5013 ms: SocketTimeout
reader gone
3 after the reader left: FAILED in 1 ms: cannot start a transaction within a transaction
4 again: FAILED in 2002 ms: Transaction API error: Unable to start a transaction in the given time.
5 plain read: ok
```

Com `DATABASE_JOURNAL_MODE=wal`, as quatro escritas passam, a segunda em 9 ms
com o leitor aberto.

O script, para rodar de `tmp/` sobre uma cópia de `dev.db`
(`DATABASE_URL=file:<cópia> DATABASE_JOURNAL_MODE=delete pnpm exec tsx tmp/repro-stuck-commit.ts`):

```ts
// Reproduces a COMMIT that fails with SQLITE_BUSY and checks whether later writes recover.
import { spawn } from "node:child_process";
import { prisma } from "../src/db/client";

const path = (process.env.DATABASE_URL ?? "").replace(/^file:/, "");
const write = (label: string) => {
	const started = Date.now();
	return prisma
		.$transaction(async (tx) => {
			const user = await tx.user.findFirst({ select: { username: true, name: true } });
			if (!user) throw new Error("no user");
			await tx.user.update({ where: { username: user.username }, data: { name: user.name } });
		})
		.then(
			() => console.log(`${label}: ok in ${Date.now() - started} ms`),
			(error) =>
				console.log(`${label}: FAILED in ${Date.now() - started} ms: ${String(error.message).split("\n").at(-1)}`),
		);
};

await write("1 before the reader");
const reader = spawn("sqlite3", [path], { stdio: ["pipe", "pipe", "inherit"] });
reader.stdin.write("BEGIN; SELECT count(*) FROM User;\n");
await new Promise((resolve) => reader.stdout.once("data", resolve));
console.log("reader holds the shared lock");
await write("2 with the reader open");
reader.stdin.end("COMMIT;\n");
await new Promise((resolve) => reader.once("exit", resolve));
console.log("reader gone");
await write("3 after the reader left");
await Promise.race([write("4 again"), new Promise((r) => setTimeout(r, 12000)).then(() => console.log("4 again: still waiting after 12 s"))]);
await prisma.user.findFirst({ select: { username: true } }).then(
	() => console.log("5 plain read: ok"),
	(e) => console.log(`5 plain read: FAILED ${e.message.split("\n").at(-1)}`),
);
process.exit(0);
```

## O que fazer

- Em `src/db/client.ts`, onde o adapter já é embrulhado (`withPragmas`,
  `instrumentAdapter`): quando o `COMMIT` falha, mandar `ROLLBACK` na mesma
  conexão antes de devolver o erro, e soltar o mutex quando o `BEGIN` falha.
  Decidir se o `COMMIT` ocupado merece novas tentativas antes de desistir: o
  rollback perde o save, e a página do aluno reenvia.
- Transformar o script num spec `unit`, que hoje falharia.
- Ver se uma versão mais nova do adapter corrige, e relatar ao Prisma se não.
- Em WAL um leitor não bloqueia o escritor, então o gatilho some com
  `sqlite-em-modo-wal` em produção. A correção ainda vale:
  `DATABASE_JOURNAL_MODE=delete` continua como saída de emergência.

## Enquanto isso

- Não consultar o banco de produção com alguém salvando: copiar o arquivo e
  ler a cópia.
- O backup (`/usr/local/bin/codehood-backup`, com `.backup`) também é um
  leitor longo. Conferir a que horas ele roda.
- Há um backup de antes do restart em
  `/var/backups/codehood-pre-restart-20261119-1715/` na VPS.
