/// Hard-coded fixtures for the grading mockups. Nothing here touches the database.

export interface Student {
	id: number;
	name: string;
	username: string;
	/// Mean exam score on the other questions, 0 to 100.
	avg: number;
}

export interface Member {
	student: Student;
	/// The score the auto-grader gave, as a percentage.
	auto: number;
	/// The instructor's score when changed by hand.
	manual?: number;
	/// What this student actually wrote, when it differs from the group label.
	detail?: string;
}

export interface Chip {
	text: string;
	ok: boolean;
}

export interface Group {
	label: string;
	/// Extra line under the label.
	sub?: string;
	/// A typical mistake or class the group was clustered under.
	tag?: string;
	/// Ordering responses and the like, drawn as chips instead of the label.
	chips?: Chip[];
	/// The auto score of the group as a percentage, null when it varies.
	score: number | null;
	members: Member[];
	/// Shown next to the mean when strong students picked a wrong answer.
	flag?: string;
}

export interface Block {
	title?: string;
	hint?: string;
	groups: Group[];
	showMean?: boolean;
	/// "score" shows the score column, "accepted" shows a yes/no badge.
	mode?: "score" | "accepted";
	responseHeader?: string;
}

export interface AttentionRow {
	student: Student;
	kind: "pending" | "regrade" | "suspicious";
	detail: string;
}

export interface OverrideRow {
	student: Student;
	kind: "Nota alterada" | "Sanção";
	auto: number;
	final: number;
	comment: string;
	when: string;
}

export interface Fixture {
	slug: string;
	title: string;
	position: number;
	points: string;
	typeLabel: string;
	answers: number;
	/// Share of answers with the full score, 0 to 100.
	correctPct: number;
	discrimination: number | null;
	pending: number;
	attention: AttentionRow[];
	/// Show the "nothing needs attention" sentence instead of omitting the section.
	showEmptyAttention?: boolean;
	blocks: Block[];
	overrides: OverrideRow[];
	statement: string;
	key: { text: string; ok?: boolean }[];
	/// Explains how a change of grade applies, for questions with several blanks.
	changeNote?: string;
}

const NAMES = [
	"Ana Beatriz Souza",
	"Bruno Carvalho Lima",
	"Camila Ferreira",
	"Daniel Rocha Pinto",
	"Eduarda Martins",
	"Felipe Araújo",
	"Gabriela Nunes",
	"Heitor Monteiro",
	"Isabela Teixeira",
	"João Pedro Almeida",
	"Karina Barbosa",
	"Lucas Ribeiro",
	"Mariana Cavalcanti",
	"Nicolas Gomes",
	"Olívia Duarte",
	"Pedro Henrique Costa",
	"Quitéria Mendes",
	"Rafael Moreira",
	"Sofia Andrade",
	"Thiago Batista",
	"Úrsula Freitas",
	"Vinícius Correia",
	"Wesley Santana",
	"Ximena Lopes",
	"Yasmin Azevedo",
	"Zeca Vasconcelos",
	"Alice Ramos",
	"Breno Siqueira",
	"Clara Medeiros",
	"Davi Lucas Pereira",
	"Elisa Fonseca",
	"Fernando Queiroz",
	"Giovana Tavares",
	"Henrique Dias",
	"Letícia Prado",
];

const slug = (name: string): string =>
	name
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.split(" ")
		.slice(0, 2)
		.join(".");

/// A deterministic pseudo-random sequence, so every render shows the same class.
function rng(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

const rand = rng(7);

export const STUDENTS: Student[] = NAMES.map((name, index) => ({
	id: index + 1,
	name,
	username: slug(name),
	avg: Math.round(38 + rand() * 58),
}));

const byAvgDesc = [...STUDENTS].sort((a, b) => b.avg - a.avg);

/// Splits the class into groups of the given sizes; `high` takes the best students left, `low` the worst, `any` a scattered pick.
function allocate(
	specs: { count: number; bias: "high" | "low" | "any" }[],
): Student[][] {
	const left = [...byAvgDesc];
	const pick = rng(11);
	return specs.map(({ count, bias }) => {
		const taken: Student[] = [];
		for (let i = 0; i < count; i++) {
			const index =
				bias === "high"
					? 0
					: bias === "low"
						? left.length - 1
						: Math.floor(pick() * left.length);
			const [student] = left.splice(index, 1);
			if (student) taken.push(student);
		}
		return taken;
	});
}

const student = (id: number): Student => STUDENTS[id - 1] as Student;

function group(
	label: string,
	score: number | null,
	students: Student[],
	options: Partial<Group> & { manual?: Record<number, number> } = {},
): Group {
	const { manual = {}, ...rest } = options;
	return {
		label,
		score,
		members: students.map((s) => ({
			student: s,
			auto: score ?? 0,
			manual: manual[s.id],
		})),
		...rest,
	};
}

/// The class, split in the given counts with the given biases; each group built with `make`.
function split(
	specs: { count: number; bias: "high" | "low" | "any" }[],
): Student[][] {
	return allocate(specs);
}

export function fmt(value: number, digits = 0): string {
	return value.toFixed(digits).replace(".", ",");
}

export function meanOf(g: Group): number | null {
	return g.members.length >= 3
		? g.members.reduce((sum, m) => sum + m.student.avg, 0) / g.members.length
		: null;
}

const answersOf = (blocks: Block[]): number => {
	const first = blocks[0];
	return first ? first.groups.reduce((n, g) => n + g.members.length, 0) : 0;
};

function finish(
	base: Omit<Fixture, "answers" | "correctPct"> & { pending: number },
): Fixture {
	const first = base.blocks[0] as Block;
	const answers = answersOf(base.blocks) + base.pending;
	const graded = first.groups.flatMap((g) => g.members);
	const full = graded.filter(
		(m) => m.auto >= 100 && (m.manual === undefined || m.manual >= 100),
	).length;
	return {
		...base,
		answers,
		correctPct: Math.round((full / Math.max(1, answers)) * 100),
	};
}

export function multipleChoice(options: { quiet?: boolean } = {}): Fixture {
	const [wrongStrong, right, a, d, blank] = split([
		{ count: 12, bias: "high" },
		{ count: 16, bias: "any" },
		{ count: 4, bias: "low" },
		{ count: 2, bias: "low" },
		{ count: 1, bias: "low" },
	]) as [Student[], Student[], Student[], Student[], Student[]];
	const quiet = options.quiet === true;
	const rebelde = wrongStrong[3] as Student;
	const sancionado = a[0] as Student;
	return finish({
		slug: "quicksort-pior-caso",
		title: "Quicksort no pior caso",
		position: 3,
		points: "20",
		typeLabel: "Múltipla escolha",
		discrimination: quiet ? null : 0.08,
		pending: 0,
		showEmptyAttention: quiet,
		attention: quiet
			? []
			: [
					{
						student: rebelde,
						kind: "regrade",
						detail:
							'Pede revisão: "o enunciado não diz se é pior caso ou caso médio".',
					},
					{
						student: sancionado,
						kind: "suspicious",
						detail: "Enviada 3 s após abrir a prova, igual à de outro aluno.",
					},
				],
		blocks: [
			{
				responseHeader: "Alternativa",
				groups: [
					group("C. O(n²)", 100, right),
					group("B. O(n log n)", 0, wrongStrong, {
						manual: quiet ? {} : { [rebelde.id]: 100 },
						flag: "Alunos fortes escolheram: verificar o gabarito",
					}),
					group("A. O(n)", 0, a),
					group("D. O(log n)", 0, d),
					group("Em branco", 0, blank),
				],
			},
		],
		overrides: quiet
			? []
			: [
					{
						student: rebelde,
						kind: "Nota alterada",
						auto: 0,
						final: 100,
						comment: "Enunciado ambíguo, aceito pior caso esperado.",
						when: "12/11 14:02",
					},
					{
						student: sancionado,
						kind: "Sanção",
						auto: 100,
						final: 0,
						comment: "Zerada por cola, ver relatório.",
						when: "12/11 16:40",
					},
				],
		statement:
			"Qual a complexidade de tempo do quicksort no pior caso, escolhendo sempre o primeiro elemento como pivô?",
		key: [
			{ text: "A. O(n)" },
			{ text: "B. O(n log n)" },
			{ text: "C. O(n²)", ok: true },
			{ text: "D. O(log n)" },
		],
	});
}

export function multipleSelection(): Fixture {
	const [acd, ac, ce, acde, ae, rest] = split([
		{ count: 13, bias: "any" },
		{ count: 7, bias: "any" },
		{ count: 5, bias: "any" },
		{ count: 3, bias: "low" },
		{ count: 2, bias: "any" },
		{ count: 5, bias: "low" },
	]) as [Student[], Student[], Student[], Student[], Student[], Student[]];
	const options = [
		"A. A busca percorre no máximo a altura da árvore",
		"B. Todo nó tem exatamente dois filhos",
		"C. O percurso em ordem devolve as chaves ordenadas",
		"D. A altura é sempre log n",
		"E. A chave da raiz separa as subárvores esquerda e direita",
	];
	return finish({
		slug: "bst-propriedades",
		title: "Propriedades de uma árvore binária de busca",
		position: 5,
		points: "20",
		typeLabel: "Múltipla seleção",
		discrimination: null,
		pending: 0,
		attention: [],
		blocks: [
			{
				title: "Combinações mais comuns",
				responseHeader: "Combinação",
				groups: [
					group("A + C + E", 100, acd),
					group("A + C", 67, ac, { sub: "faltou E" }),
					group("C + E", 67, ce, { sub: "faltou A" }),
					group("A + C + D + E", 67, acde, { sub: "D marcada a mais" }),
					group("A + E", 33, ae, { sub: "faltou C" }),
					{
						...group("Outras (5 combinações)", null, rest),
						sub: "cada uma com 1 aluno",
					},
				].map((g, i) =>
					i === 5
						? {
								...g,
								members: rest.map((s, k) => ({
									student: s,
									auto: [33, 33, 0, 67, 0][k] ?? 0,
									detail: ["B + C", "A", "D", "A + C + D", "B + D"][k],
								})),
							}
						: g,
				),
			},
		],
		overrides: [],
		statement:
			"Marque todas as afirmações verdadeiras sobre árvores binárias de busca.",
		key: options.map((text, i) => ({ text, ok: [0, 2, 4].includes(i) })),
	});
}

export function trueFalse(): Fixture {
	const [ok, one, two, three, rest] = split([
		{ count: 12, bias: "high" },
		{ count: 8, bias: "any" },
		{ count: 6, bias: "any" },
		{ count: 4, bias: "low" },
		{ count: 5, bias: "any" },
	]) as [Student[], Student[], Student[], Student[], Student[]];
	const statements = [
		"1. HTTP é um protocolo sem estado.",
		"2. Uma requisição GET deve alterar dados no servidor.",
		"3. O código 404 indica recurso não encontrado.",
		"4. HTTPS cifra o corpo e os cabeçalhos da requisição.",
	];
	return finish({
		slug: "http-verdadeiro-falso",
		title: "Julgue as afirmações sobre HTTP",
		position: 4,
		points: "20",
		typeLabel: "Verdadeiro ou falso",
		discrimination: null,
		pending: 0,
		attention: [],
		blocks: [
			{
				title: "Padrões de resposta (V · F · V · V é o gabarito)",
				responseHeader: "Respostas 1 a 4",
				groups: [
					group("V · F · V · V", 100, ok),
					group("V · F · V · F", 75, one, { sub: "errou a 4" }),
					group("F · F · V · V", 75, two, { sub: "errou a 1" }),
					group("V · V · V · V", 75, three, { sub: "errou a 2" }),
					{
						...group("Outros (5 padrões)", null, rest),
						members: rest.map((s, k) => ({
							student: s,
							auto: [50, 50, 50, 25, 50][k] ?? 0,
							detail: [
								"V · V · F · V",
								"F · V · V · F",
								"V · F · F · V",
								"F · F · F · V",
								"V · V · F · F",
							][k],
						})),
					},
				],
			},
		],
		overrides: [],
		statement: "Julgue cada afirmação como verdadeira ou falsa.",
		key: statements.map((text, i) => ({ text, ok: i !== 1 })),
	});
}

export function numeric(): Fixture {
	const [exact, loose, rounding, noRoot, unit, noUnit, wrong] = split([
		{ count: 12, bias: "any" },
		{ count: 6, bias: "any" },
		{ count: 4, bias: "any" },
		{ count: 3, bias: "low" },
		{ count: 2, bias: "any" },
		{ count: 1, bias: "any" },
		{ count: 5, bias: "low" },
	]) as [
		Student[],
		Student[],
		Student[],
		Student[],
		Student[],
		Student[],
		Student[],
	];
	const [p1, p2] = [student(9), student(21)];
	return finish({
		slug: "queda-livre",
		title: "Tempo de queda livre",
		position: 2,
		points: "20",
		typeLabel: "Numérica",
		discrimination: null,
		pending: 2,
		attention: [
			{
				student: p1,
				kind: "pending",
				detail: 'Resposta "dois segundos": não é um número.',
			},
			{
				student: p2,
				kind: "pending",
				detail: 'Resposta "2,02 s^-1": unidade desconhecida.',
			},
		],
		blocks: [
			{
				responseHeader: "Resposta",
				groups: [
					group("2,02 s", 100, exact),
					group("2,0 s", 100, loose, { sub: "dentro da tolerância de ±0,02" }),
					group("2,1 s", 0, rounding, { tag: "Arredondou demais" }),
					group("4,08 s", 0, noRoot, { tag: "Esqueceu a raiz" }),
					group("2,02 m", 50, unit, {
						tag: "Unidade errada",
						sub: "valor certo, 50% pela unidade",
					}),
					group("2,02", 100, noUnit, { sub: "sem unidade, aceita" }),
					group("Outros valores", 0, wrong),
				],
			},
		],
		overrides: [],
		statement:
			"Um objeto cai de 20 m de altura a partir do repouso. Calcule o tempo de queda, com g = 9,8 m/s².",
		key: [
			{ text: "t = 2,02 s, tolerância de ±0,02", ok: true },
			{ text: "Unidade esperada: s" },
		],
	});
}

export function shortAnswer(): Fixture {
	const [exact, pd, dp, divide, rec, memo, other] = split([
		{ count: 17, bias: "any" },
		{ count: 4, bias: "any" },
		{ count: 2, bias: "any" },
		{ count: 5, bias: "low" },
		{ count: 3, bias: "low" },
		{ count: 2, bias: "high" },
		{ count: 2, bias: "low" },
	]) as [
		Student[],
		Student[],
		Student[],
		Student[],
		Student[],
		Student[],
		Student[],
	];
	const withDetail = (g: Group, raw: string[]): Group => ({
		...g,
		members: g.members.map((m, i) => ({ ...m, detail: raw[i % raw.length] })),
	});
	const copied = divide[0] as Student;
	return finish({
		slug: "tecnica-memoizacao",
		title: "Nome da técnica",
		position: 1,
		points: "20",
		typeLabel: "Resposta curta",
		discrimination: null,
		pending: 0,
		attention: [
			{
				student: copied,
				kind: "suspicious",
				detail: "Texto idêntico ao de outro aluno, incluindo o erro de grafia.",
			},
		],
		blocks: [
			{
				responseHeader: "Texto normalizado",
				mode: "accepted",
				groups: [
					withDetail(group("programação dinâmica", 100, exact), [
						"Programação dinâmica",
						"programação dinamica",
						"programacao dinâmica ",
					]),
					withDetail(group("pd", 100, pd, { sub: "variante aceita" }), [
						"PD",
						"pd",
					]),
					withDetail(group("dp", 100, dp, { sub: "variante aceita" }), ["DP"]),
					withDetail(group("divisão e conquista", 0, divide), [
						"Divisão e conquista",
						"divisao e conquista",
					]),
					withDetail(group("recursão", 0, rec), ["Recursão", "recursao"]),
					withDetail(group("memoização", 0, memo, { sub: "talvez aceitar" }), [
						"Memoização",
						"memoizacao",
					]),
					withDetail(group("outros (2 textos)", 0, other), [
						"dinâmica",
						"tabulação",
					]),
				],
			},
		],
		overrides: [],
		statement:
			"Como se chama a técnica que resolve um problema combinando subproblemas sobrepostos e guarda resultados já calculados?",
		key: [
			{ text: "programação dinâmica", ok: true },
			{ text: "pd, dp (variantes aceitas)", ok: true },
		],
	});
}

export function fillIn(): Fixture {
	const blank = (
		counts: [string, boolean, number, "high" | "low" | "any"][],
	): Group[] => {
		const parts = split(counts.map(([, , count, bias]) => ({ count, bias })));
		return counts.map(([label, ok], i) =>
			group(label, ok ? 100 : 0, parts[i] as Student[]),
		);
	};
	const fixture = finish({
		slug: "soma-lacunas",
		title: "Complete a função soma",
		position: 6,
		points: "20",
		typeLabel: "Lacunas",
		discrimination: null,
		pending: 0,
		attention: [],
		changeNote:
			"A nota é da questão inteira, não de cada lacuna: alterar a nota de um aluno vale para as três.",
		blocks: [
			{
				title: "Lacuna 1: total = ___",
				mode: "accepted",
				showMean: false,
				responseHeader: "Valor",
				groups: blank([
					["0", true, 29, "any"],
					["None", false, 3, "low"],
					["1", false, 2, "low"],
					["(em branco)", false, 1, "low"],
				]),
			},
			{
				title: "Lacuna 2: for x in ___",
				mode: "accepted",
				showMean: false,
				responseHeader: "Valor",
				groups: blank([
					["xs", true, 31, "any"],
					["range(xs)", false, 3, "low"],
					["len(xs)", false, 1, "low"],
				]),
			},
			{
				title: "Lacuna 3: total ___ x",
				mode: "accepted",
				showMean: false,
				responseHeader: "Valor",
				groups: blank([
					["+=", true, 26, "any"],
					["=+", false, 4, "low"],
					["=", false, 4, "low"],
					["+", false, 1, "low"],
				]),
			},
		],
		overrides: [],
		statement: "Complete as lacunas para que a função some os elementos de xs.",
		key: [
			{ text: "def soma(xs):" },
			{ text: "    total = 0", ok: true },
			{ text: "    for x in xs:", ok: true },
			{ text: "        total += x", ok: true },
			{ text: "    return total" },
		],
	});
	// Right only when every blank is right.
	const wrong = new Set(
		fixture.blocks.flatMap((b) =>
			b.groups
				.filter((g) => g.score !== 100)
				.flatMap((g) => g.members.map((m) => m.student.id)),
		),
	);
	return {
		...fixture,
		correctPct: Math.round(
			((fixture.answers - wrong.size) / fixture.answers) * 100,
		),
	};
}

export function ordering(): Fixture {
	const steps = ["DNS", "TCP", "TLS", "Requisição", "Resposta"];
	const chips = (order: number[]): Chip[] =>
		order.map((n, i) => ({ text: steps[n] as string, ok: n === i }));
	const [ok, swap, swap2, rest] = split([
		{ count: 15, bias: "any" },
		{ count: 9, bias: "any" },
		{ count: 6, bias: "low" },
		{ count: 5, bias: "low" },
	]) as [Student[], Student[], Student[], Student[]];
	const make = (
		order: number[],
		score: number | null,
		students: Student[],
		sub?: string,
	): Group => ({
		...group(order.map((n) => steps[n]).join(" → "), score, students, { sub }),
		chips: chips(order),
	});
	return finish({
		slug: "ciclo-requisicao",
		title: "Ordene o ciclo de uma requisição HTTPS",
		position: 7,
		points: "20",
		typeLabel: "Ordenação",
		discrimination: null,
		pending: 0,
		attention: [],
		blocks: [
			{
				responseHeader: "Ordem enviada",
				groups: [
					make([0, 1, 2, 3, 4], 100, ok),
					make([0, 2, 1, 3, 4], 60, swap, "TLS antes de TCP"),
					make([1, 0, 2, 3, 4], 60, swap2, "TCP antes de DNS"),
					{
						...make(
							[0, 1, 3, 2, 4],
							60,
							rest.slice(0, 3),
							"Requisição antes de TLS",
						),
					},
					{ ...make([4, 3, 2, 1, 0], 0, rest.slice(3), "ordem inversa") },
				],
			},
		],
		overrides: [],
		statement:
			"Ordene as etapas de uma requisição HTTPS, da primeira à última.",
		key: steps.map((text, i) => ({ text: `${i + 1}. ${text}`, ok: true })),
	});
}

/// The student of the attempt mockups.
export const ATTEMPT_STUDENT = student(5);

export interface AttemptQuestion {
	number: number;
	title: string;
	points: string;
	stem: string;
	choices?: { text: string; chosen: boolean; key: boolean }[];
	text?: string;
	/// Auto score as a percentage; null when the student left it blank.
	auto: number | null;
	/// Score in the override variant, when changed.
	override?: { score: number; comment: string };
	/// Opens the change form in the override variant.
	openForm?: boolean;
}

export const ATTEMPT_QUESTIONS: AttemptQuestion[] = [
	{
		number: 1,
		title: "Busca binária",
		points: "20",
		stem: "Qual a complexidade da busca binária em um vetor ordenado?",
		choices: [
			{ text: "O(n)", chosen: false, key: false },
			{ text: "O(log n)", chosen: true, key: true },
			{ text: "O(n log n)", chosen: false, key: false },
		],
		auto: 100,
	},
	{
		number: 2,
		title: "Quicksort no pior caso",
		points: "20",
		stem: "Qual a complexidade do quicksort no pior caso, com o primeiro elemento como pivô?",
		choices: [
			{ text: "O(n)", chosen: false, key: false },
			{ text: "O(n log n)", chosen: true, key: false },
			{ text: "O(n²)", chosen: false, key: true },
		],
		auto: 0,
		override: {
			score: 100,
			comment: "Resolveu o desafio de ordenação em aula.",
		},
	},
	{
		number: 3,
		title: "Nome da técnica",
		points: "20",
		stem: "Como se chama a técnica que guarda resultados de subproblemas já calculados?",
		text: "memoização",
		auto: 0,
		openForm: true,
	},
	{
		number: 4,
		title: "Propriedades de uma BST",
		points: "20",
		stem: "Marque todas as afirmações verdadeiras sobre árvores binárias de busca.",
		auto: null,
		override: { score: 100, comment: "Mostrou a solução no quadro." },
	},
	{
		number: 5,
		title: "Tempo de queda livre",
		points: "20",
		stem: "Calcule o tempo de queda de 20 m a partir do repouso, com g = 9,8 m/s².",
		auto: null,
	},
];

/// How a student shows up in the mockups: the name only when the switch is on.
export function studentLabel(s: Student, names: boolean): string {
	return names ? s.name : `Aluno ${String(s.id).padStart(2, "0")}`;
}
