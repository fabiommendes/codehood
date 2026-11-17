import {
	createMemo,
	createSignal,
	For,
	type JSX,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import Dialog from "./_Dialog";
import { ATTEMPT_LIST, type AttemptStatus, fmt } from "./_data";
import Icon from "./_Icon";
import SortTable from "./_SortTable";

type DialogName = "sanction" | "bonus" | "students";
type BonusOp = "OFFSET" | "FACTOR" | "SET";

interface Props {
	/// Page of the mockup the student rows link to, without the query.
	base: string;
	/// Username of the student on display.
	current: string;
	/// Total of the student before any adjustment, out of 100.
	autoTotal: number;
	/// Number of questions of the exam.
	questions: number;
}

const STATUS_BADGE: Record<AttemptStatus, string> = {
	entregue: "badge-success",
	pendente: "badge-warning",
	"sem tentativa": "badge-neutral",
	ajustada: "badge-info",
};

/// Order of the Situação column when sorted ascending.
const STATUS_ORDER: AttemptStatus[] = [
	"pendente",
	"sem tentativa",
	"ajustada",
	"entregue",
];

const field = "flex flex-col gap-1 text-xs text-muted";

/// The three actions beside the student's name and the dialogs they open.
export default function AttemptActions(props: Props): JSX.Element {
	const [open, setOpen] = createSignal<DialogName | null>(null);
	const [query, setQuery] = createSignal("");
	const [op, setOp] = createSignal<BonusOp>("OFFSET");
	const [value, setValue] = createSignal(15);
	const [scope, setScope] = createSignal("exam");
	const [zero, setZero] = createSignal(false);
	const [factor, setFactor] = createSignal(50);

	const onOpen = (e: Event) => setOpen((e as CustomEvent<DialogName>).detail);
	onMount(() => {
		window.addEventListener("open-attempt-dialog", onOpen);
		onCleanup(() => window.removeEventListener("open-attempt-dialog", onOpen));
	});

	const rows = createMemo(() => {
		const q = query().trim().toLowerCase();
		return ATTEMPT_LIST.filter(
			(r) =>
				!q ||
				r.student.name.toLowerCase().includes(q) ||
				r.student.username.includes(q) ||
				(r.schoolId?.includes(q) ?? false),
		);
	});

	const bonusResult = createMemo(() => {
		const v = value();
		const base = props.autoTotal;
		const result =
			op() === "OFFSET" ? base + v : op() === "FACTOR" ? (base * v) / 100 : v;
		return Math.max(0, Math.min(100, result));
	});
	const bonusHint = () =>
		op() === "OFFSET"
			? "Pontos somados ao total, em pontos percentuais da prova. Use um valor negativo para descontar."
			: op() === "FACTOR"
				? "Porcentagem da nota que fica: 110 = ×1,1, 100 = sem mudança."
				: "Nova nota da prova, de 0 a 100. Vale mesmo sem tentativa.";

	const iconBtn = "btn btn-ghost btn-sm btn-square";
	return (
		<>
			<div class="flex items-center gap-1">
				<button
					type="button"
					class={`${iconBtn} text-error`}
					aria-label="Sancionar"
					title="Sancionar"
					onClick={() => setOpen("sanction")}
				>
					<Icon name="gavel" />
				</button>
				<button
					type="button"
					class={`${iconBtn} text-success`}
					aria-label="Adicionar bônus"
					title="Adicionar bônus"
					onClick={() => setOpen("bonus")}
				>
					<Icon name="badgePlus" />
				</button>
				<button
					type="button"
					class={iconBtn}
					aria-label="Lista de alunos"
					title="Lista de alunos"
					onClick={() => setOpen("students")}
				>
					<Icon name="users" />
				</button>
			</div>

			<Dialog
				id="students-dialog"
				title="Alunos da prova"
				open={open() === "students"}
				onClose={() => setOpen(null)}
			>
				<label class="input input-sm w-full">
					<input
						type="search"
						placeholder="Buscar por nome, matrícula ou usuário"
						aria-label="Buscar aluno"
						value={query()}
						onInput={(e) => setQuery(e.currentTarget.value)}
					/>
				</label>
				<p class="mt-2 text-xs text-muted">
					{rows().length} de {ATTEMPT_LIST.length} alunos
				</p>
				<div class="mt-2 max-h-96 overflow-y-auto rounded-box border border-edge">
					<SortTable
						label="Alunos da prova"
						data={rows()}
						rowClass={(r) =>
							r.student.username === props.current ? "bg-base-200" : undefined
						}
						columns={[
							{
								title: "Aluno",
								sortKey: "name",
								sortValue: (r) => r.student.name,
								render: (r) => (
									<a
										class="link link-hover font-medium"
										href={`${props.base}?u=${r.student.username}`}
									>
										{r.student.name}
									</a>
								),
							},
							{
								title: "Matrícula",
								sortKey: "schoolId",
								sortValue: (r) => r.schoolId,
								render: (r) => (
									<span class="font-mono text-xs tabular-nums">
										{r.schoolId ?? "—"}
									</span>
								),
							},
							{
								title: "Usuário",
								sortKey: "username",
								sortValue: (r) => r.student.username,
								render: (r) => (
									<span class="font-mono text-xs text-muted">
										{r.student.username}
									</span>
								),
							},
							{
								title: "Total",
								sortKey: "total",
								sortValue: (r) => r.total,
								render: (r) => (
									<span class="tabular-nums">
										{r.total === null ? "—" : fmt(r.total, 1)}
									</span>
								),
							},
							{
								title: "Situação",
								sortKey: "status",
								sortValue: (r) => STATUS_ORDER.indexOf(r.status),
								render: (r) => (
									<span
										class={`badge badge-soft badge-sm ${STATUS_BADGE[r.status]}`}
									>
										{r.status}
									</span>
								),
							},
						]}
					/>
				</div>
			</Dialog>

			<Dialog
				id="bonus-dialog"
				title="Adicionar bônus"
				open={open() === "bonus"}
				onClose={() => setOpen(null)}
			>
				<form class="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
					<fieldset class="flex flex-wrap gap-2">
						<legend class="mb-1 text-xs text-muted">Operação</legend>
						<For
							each={
								[
									["OFFSET", "Somar pontos", 15],
									["FACTOR", "Multiplicar", 110],
									["SET", "Substituir nota", 100],
								] as const
							}
						>
							{([key, label, initial]) => (
								<label
									class={`btn btn-sm ${op() === key ? "btn-success" : "btn-outline"}`}
								>
									<input
										type="radio"
										name="bonus-op"
										class="sr-only"
										checked={op() === key}
										onChange={() => {
											setOp(key);
											setValue(initial);
										}}
									/>
									{label}
								</label>
							)}
						</For>
					</fieldset>
					<label class={field}>
						{op() === "OFFSET"
							? "Pontos (% da prova)"
							: op() === "FACTOR"
								? "Nota que fica (%)"
								: "Nota (%)"}
						<input
							type="number"
							class="input input-sm w-32 text-base-content"
							value={value()}
							step={op() === "OFFSET" ? 0.5 : 1}
							onInput={(e) => setValue(e.currentTarget.valueAsNumber || 0)}
						/>
						<span>{bonusHint()}</span>
					</label>
					<label class={field}>
						Motivo (visível ao aluno)
						<input
							type="text"
							class="input input-sm w-full text-base-content"
							value="Resolveu o desafio de ordenação em aula."
						/>
					</label>
					<p
						class="rounded-field bg-base-200/60 px-3 py-2 text-sm tabular-nums"
						data-testid="bonus-preview"
					>
						Total <span class="text-muted">{fmt(props.autoTotal, 1)}</span> →{" "}
						<strong class="text-success">{fmt(bonusResult(), 1)}</strong>
						<span class="text-muted"> de 100</span>
					</p>
					<div>
						<button
							type="button"
							class="btn btn-success btn-sm"
							onClick={() => setOpen(null)}
						>
							Adicionar bônus
						</button>
					</div>
				</form>
			</Dialog>

			<Dialog
				id="sanction-dialog"
				title="Sancionar"
				open={open() === "sanction"}
				onClose={() => setOpen(null)}
			>
				<form class="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
					<label class={field}>
						Alvo
						<select
							class="select select-sm w-64 text-base-content"
							value={scope()}
							onChange={(e) => setScope(e.currentTarget.value)}
						>
							<option value="exam">A prova inteira</option>
							<For
								each={Array.from({ length: props.questions }, (_, i) => i + 1)}
							>
								{(n) => <option value={String(n)}>Questão Q{n}</option>}
							</For>
						</select>
					</label>
					<label class="flex cursor-pointer items-center gap-2 text-sm">
						<input
							type="checkbox"
							class="checkbox checkbox-sm"
							checked={zero()}
							onChange={(e) => setZero(e.currentTarget.checked)}
						/>
						Zerar (fator 0)
					</label>
					<label class={field}>
						Nota que fica (%)
						<input
							type="number"
							min="0"
							max="99"
							class="input input-sm w-32 text-base-content"
							disabled={zero()}
							value={zero() ? 0 : factor()}
							onInput={(e) => setFactor(e.currentTarget.valueAsNumber || 0)}
						/>
						<span>
							Menor que 100: 50 = ×0,5.
							{scope() === "exam" ? "" : " Na questão só é possível reduzir."}
						</span>
					</label>
					<label class={field}>
						Motivo (visível ao aluno)
						<input
							type="text"
							class="input input-sm w-full text-base-content"
							placeholder="Ex.: consulta a material não permitido"
						/>
					</label>
					<Show when={scope() === "exam"}>
						<p class="rounded-field bg-base-200/60 px-3 py-2 text-sm tabular-nums">
							Total <span class="text-muted">{fmt(props.autoTotal, 1)}</span> →{" "}
							<strong class="text-error">
								{fmt(zero() ? 0 : (props.autoTotal * factor()) / 100, 1)}
							</strong>
						</p>
					</Show>
					<div>
						<button
							type="button"
							class="btn btn-error btn-sm"
							onClick={() => setOpen(null)}
						>
							Sancionar
						</button>
					</div>
				</form>
			</Dialog>
		</>
	);
}
