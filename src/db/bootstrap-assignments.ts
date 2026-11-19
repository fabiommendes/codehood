import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { UserActor } from "@/auth/actor";
import { FULL_ACCESS } from "@/auth/actor";
import type { TeamId } from "@/core/schemas/base";
import { type Course, db, type User } from "@/db";
import { prisma } from "@/db/client";
import { bareRepositoryPath } from "@/services/git/bare";

const run = promisify(execFile);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/// Students of the demo cohort, by the role they play in the assignments.
export type AssignmentCast = {
	bob: User;
	hopper: User;
	hamilton: User;
	liskov: User;
	knuth: User;
	ritchie: User;
	thompson: User;
	backus: User;
};

/// A push to make: the files to write (`null` removes one), who, and when.
type PushPlan = {
	by: User;
	at: Date;
	message: string;
	files: Record<string, string | null>;
};

/// Isolated git environment, so the seed never reads the developer's config.
function gitEnv(home: string, at: Date): NodeJS.ProcessEnv {
	const when = at.toISOString();
	return {
		PATH: process.env.PATH,
		HOME: home,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		GIT_AUTHOR_DATE: when,
		GIT_COMMITTER_DATE: when,
	};
}

async function git(
	cwd: string,
	home: string,
	at: Date,
	args: string[],
): Promise<string> {
	const { stdout } = await run("git", args, { cwd, env: gitEnv(home, at) });
	return stdout.trim();
}

/**
 * Makes `plans` as commits on top of the repository of `teamId`, pushes each
 * one to its `main` with the git binary and records it as a `TeamPush` made at
 * the planned instant.
 */
async function pushAs(teamId: TeamId, plans: PushPlan[]): Promise<void> {
	const home = await mkdtemp(path.join(tmpdir(), "codehood-seed-"));
	try {
		const bare = bareRepositoryPath(teamId);
		const work = path.join(home, "work");
		await git(home, home, new Date(), ["clone", "--quiet", bare, work]);
		let previous =
			(
				await prisma.teamPush.findFirst({
					where: { teamId },
					orderBy: { id: "desc" },
				})
			)?.newSha ?? null;
		for (const plan of plans) {
			for (const [file, content] of Object.entries(plan.files)) {
				const target = path.join(work, file);
				if (content === null) {
					await rm(target, { force: true });
				} else {
					await mkdir(path.dirname(target), { recursive: true });
					await writeFile(target, content);
				}
			}
			const env = (args: string[]) => git(work, home, plan.at, args);
			await env(["add", "--all"]);
			await env([
				"-c",
				`user.name=${plan.by.name}`,
				"-c",
				`user.email=${plan.by.email}`,
				"commit",
				"--quiet",
				"--allow-empty",
				"-m",
				plan.message,
			]);
			const sha = await env(["rev-parse", "HEAD"]);
			await env(["push", "--quiet", "origin", "HEAD:refs/heads/main"]);
			const push = await db.team.recordPush(
				{ id: teamId },
				{ username: plan.by.username, oldSha: previous, newSha: sha },
				FULL_ACCESS,
			);
			await prisma.teamPush.update({
				where: { id: push.id },
				data: { createdAt: plan.at },
			});
			previous = sha;
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}

function actorOf(user: User): UserActor {
	return { username: user.username, role: user.role, name: user.name };
}

const REPORT =
	"# Relatório\n\nO que fizemos, o que deu errado e o que aprendemos.\n";

const FINAL_PROJECT_BODY = `# Projeto final

Estenda a calculadora do laboratório com expressões completas (parênteses,
precedência e potência), em equipes de 2 a 3 pessoas.

## Entrega

- Faça \`git push\` na \`main\` do repositório da equipe.
- O último push até o prazo é a sua entrega.
- Escreva o \`RELATORIO.md\` na raiz: ele é obrigatório.
`;

const GIT_LAB_BODY = `# Laboratório de git

Clone o repositório, crie três commits com mensagens claras e faça o push.
O trabalho é individual.
`;

const ZERO_BODY = `# Trabalho zero

Um programa que imprime "olá, mundo". Serve só para testar a entrega por git.
`;

const SURPRISE_BODY = `# Projeto surpresa

Ainda não foi liberado para os alunos.
`;

/**
 * Seeds the demo assignments of `course` with real bare repositories.
 *
 * Who is in which state:
 * - `projeto-final` (teams of 2 to 3, template, required `RELATORIO.md`):
 *   `bob` and `hopper` deliver on time after three pushes; `liskov` is alone
 *   and lacks the report; `knuth` is alone and has not pushed; `hamilton`,
 *   `ritchie`, `thompson` and `backus` are 4 in a team placed by the
 *   instructor, above the maximum, next to an empty team; the dev account `student` has no team.
 * - `lab-git` (individual, due date passed, still open): `bob` delivered on
 *   time and late; `hopper` only late; `hamilton` has an extension and so
 *   delivers on time; everyone else has no repository.
 * - `trabalho-zero` (individual, closed): `bob` and `hopper` have a repository
 *   with a delivery; pushes are refused and cloning still works.
 * - `projeto-surpresa` (opens in the future): hidden from students.
 */
export async function seedAssignments(
	course: Course["id"],
	cast: AssignmentCast,
): Promise<void> {
	const started = Date.now();
	const now = Date.now();
	const at = (offsetMs: number) => new Date(now + offsetMs);
	const { bob, hopper, hamilton, liskov, knuth, ritchie, thompson } = cast;
	const { backus } = cast;

	// Final project: teams of 2 to 3.
	const finalProject = await db.assignment.upsert(
		{
			course,
			slug: "projeto-final",
			title: "Projeto final",
			body: FINAL_PROJECT_BODY,
			opensAt: at(-20 * DAY_MS),
			dueAt: at(5 * DAY_MS),
			teamMin: 2,
			teamMax: 3,
			template: "lab-calculadora",
			restrictions: { require: ["RELATORIO.md"] },
		},
		FULL_ACCESS,
	);
	const pk = { id: finalProject.id };
	const compiladores = await db.team.create(
		pk,
		{ name: "Os Compiladores" },
		{ actor: actorOf(bob) },
	);
	await db.team.join(
		pk,
		{ joinCode: compiladores.joinCode as string },
		{ actor: actorOf(hopper) },
	);
	await pushAs(compiladores.id, [
		{
			by: bob,
			at: at(-9 * DAY_MS),
			message: "Parser de expressões",
			files: {
				"calc/parser.py": "def parse(text):\n    return text.split()\n",
			},
		},
		{
			by: hopper,
			at: at(-6 * DAY_MS),
			message: "Precedência de operadores",
			files: {
				"calc/precedencia.py": "PRECEDENCIA = {'+': 1, '-': 1, '*': 2}\n",
			},
		},
		{
			by: bob,
			at: at(-2 * DAY_MS),
			message: "Relatório",
			files: { "RELATORIO.md": REPORT },
		},
	]);

	const semRelatorio = await db.team.create(
		pk,
		{ name: "Sem Relatório" },
		{ actor: actorOf(liskov) },
	);
	await pushAs(semRelatorio.id, [
		{
			by: liskov,
			at: at(-3 * DAY_MS),
			message: "Primeiros testes",
			files: {
				"tests/test_soma.py": "def test_soma():\n    assert 1 + 1 == 2\n",
			},
		},
	]);

	await db.team.create(pk, { name: "Solitários" }, { actor: actorOf(knuth) });
	await db.team.createFor(
		pk,
		{
			name: "Os Quatro",
			members: [hamilton, ritchie, thompson, backus].map((u) => u.username),
		},
		FULL_ACCESS,
	);
	await db.team.createFor(
		pk,
		{ name: "Equipe Vazia", members: [] },
		FULL_ACCESS,
	);

	// Git lab: individual. The teams are made while the deadline is ahead, as
	// students cannot create one afterwards; then the deadline moves to the past.
	const labInput = {
		course,
		slug: "lab-git",
		title: "Laboratório de git",
		body: GIT_LAB_BODY,
		opensAt: at(-30 * DAY_MS),
		dueAt: at(10 * DAY_MS),
		teamMin: 1,
		teamMax: 1,
	};
	const lab = await db.assignment.upsert(labInput, FULL_ACCESS);
	const labPk = { id: lab.id };
	const labTeams = new Map<string, TeamId>();
	for (const user of [bob, hopper, hamilton]) {
		const team = await db.team.create(
			labPk,
			{ name: user.username },
			{ actor: actorOf(user) },
		);
		labTeams.set(user.username, team.id);
	}
	await db.assignment.upsert(
		{ ...labInput, dueAt: at(-3 * DAY_MS), closesAt: at(4 * DAY_MS) },
		FULL_ACCESS,
	);
	const hello = (who: string) => ({ "hello.txt": `olá de ${who}\n` });
	await pushAs(labTeams.get("bob") as TeamId, [
		{
			by: bob,
			at: at(-5 * DAY_MS),
			message: "Primeiro commit",
			files: hello("bob"),
		},
		{
			by: bob,
			at: at(-1 * DAY_MS),
			message: "Corrige a mensagem",
			files: { "hello.txt": "olá, mundo\n" },
		},
	]);
	await pushAs(labTeams.get("hopper") as TeamId, [
		{
			by: hopper,
			at: at(-1 * DAY_MS),
			message: "Entrega",
			files: hello("hopper"),
		},
	]);
	await pushAs(labTeams.get("hamilton") as TeamId, [
		{
			by: hamilton,
			at: at(-1 * DAY_MS),
			message: "Entrega",
			files: hello("hamilton"),
		},
	]);
	await db.team.setDueAt(
		{ id: labTeams.get("hamilton") as TeamId },
		at(2 * DAY_MS),
		FULL_ACCESS,
	);

	// Trabalho zero: closed.
	const zeroInput = {
		course,
		slug: "trabalho-zero",
		title: "Trabalho zero",
		body: ZERO_BODY,
		opensAt: at(-40 * DAY_MS),
		dueAt: at(10 * DAY_MS),
		teamMin: 1,
		teamMax: 1,
	};
	const zero = await db.assignment.upsert(zeroInput, FULL_ACCESS);
	const zeroTeams = new Map<string, TeamId>();
	for (const user of [bob, hopper]) {
		const team = await db.team.create(
			{ id: zero.id },
			{ name: user.username },
			{ actor: actorOf(user) },
		);
		zeroTeams.set(user.username, team.id);
	}
	await db.assignment.upsert(
		{ ...zeroInput, dueAt: at(-20 * DAY_MS), closesAt: at(-10 * DAY_MS) },
		FULL_ACCESS,
	);
	await pushAs(zeroTeams.get("bob") as TeamId, [
		{
			by: bob,
			at: at(-22 * DAY_MS),
			message: "Olá, mundo",
			files: { "ola.py": "print('olá, mundo')\n" },
		},
	]);
	await pushAs(zeroTeams.get("hopper") as TeamId, [
		{
			by: hopper,
			at: at(-12 * DAY_MS),
			message: "Olá, mundo (atrasado)",
			files: { "ola.py": "print('olá')\n" },
		},
	]);

	// Surprise: not open to students yet.
	await db.assignment.upsert(
		{
			course,
			slug: "projeto-surpresa",
			title: "Projeto surpresa",
			body: SURPRISE_BODY,
			opensAt: at(3 * DAY_MS),
			dueAt: at(20 * DAY_MS),
			teamMin: 1,
			teamMax: 3,
		},
		FULL_ACCESS,
	);

	console.log(
		`[dev] seeded assignments projeto-final, lab-git, trabalho-zero and projeto-surpresa (${Date.now() - started} ms)`,
	);
}
