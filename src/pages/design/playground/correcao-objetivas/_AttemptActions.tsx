import {
	createMemo,
	createSignal,
	For,
	type JSX,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import Dialog from "@/components/grading/Dialog";
import Icon from "@/components/grading/Icon";
import SortTable from "@/components/grading/SortTable";
import {
	ATTEMPT_LIST,
	ATTEMPT_QUESTIONS,
	type AttemptStatus,
	fmt,
} from "./_data";

type DialogName =
	| "sanction"
	| "bonus"
	| "students"
	| "question-sanction"
	| "grade";
type BonusOp = "OFFSET" | "FACTOR" | "SET";

interface Props {
	/// Page of the mockup the student rows link to, without the query.
	base: string;
	/// Username of the student on display.
	current: string;
	/// Total of the student before any adjustment, out of 100.
	autoTotal: number;
}

const STATUS_BADGE: Record<AttemptStatus, string> = {
	entregue: "badge-success",
	pendente: "badge-warning",
	"sem tentativa": "badge-neutral",
	ajustada: "border-yellow-200 bg-yellow-50 text-yellow-800",
};

/// Order of the Situação column when sorted ascending.
const STATUS_ORDER: AttemptStatus[] = [
	"pendente",
	"sem tentativa",
	"ajustada",
	"entregue",
];

/// "from → to" with the unit after both numbers.
function Preview(props: {
	from: number;
	to: number;
	tone: string;
	unit?: string;
	testId?: string;
}): JSX.Element {
	return (
		<p
			class="whitespace-nowrap text-sm tabular-nums"
			data-testid={props.testId}
		>
			<span class="text-muted">
				{fmt(props.from, props.unit ? 0 : 1)}
				{props.unit}
			</span>{" "}
			→{" "}
			<strong class={props.tone}>
				{fmt(props.to, props.unit ? 0 : 1)}
				{props.unit}
			</strong>
		</p>
	);
}

/// "Zerar" or the percentage that stays, with the preview and a hint.
function PercentRow(props: {
	base: number;
	hint: string;
	unit?: string;
}): JSX.Element {
	const [zero, setZero] = createSignal(false);
	const [factor, setFactor] = createSignal(50);
	return (
		<fieldset class="fieldset py-0">
			<div class="flex items-center gap-3">
				<label class="input input-sm w-40">
					<input
						type="number"
						aria-label="Nota que fica"
						min="0"
						max="99"
						disabled={zero()}
						value={zero() ? 0 : factor()}
						onInput={(e) => setFactor(e.currentTarget.valueAsNumber || 0)}
					/>
					<span class="label">%</span>
				</label>
				<Preview
					from={props.base}
					to={zero() ? 0 : (props.base * factor()) / 100}
					tone="text-error"
					unit={props.unit}
				/>
				<label class="label ml-auto cursor-pointer gap-2 text-sm">
					<input
						type="checkbox"
						class="checkbox checkbox-xs"
						checked={zero()}
						onChange={(e) => setZero(e.currentTarget.checked)}
					/>
					Zerar
				</label>
			</div>
			<p class="label whitespace-normal">{props.hint}</p>
		</fieldset>
	);
}

/// Reason shown to the student, plus an optional internal note behind a link.
function ReasonField(props: { placeholder: string }): JSX.Element {
	const [note, setNote] = createSignal(false);
	return (
		<>
			<fieldset class="fieldset py-0">
				<legend class="fieldset-legend py-0.5">
					Motivo (visível ao aluno)
				</legend>
				<textarea
					class="textarea textarea-sm w-full"
					rows={2}
					placeholder={props.placeholder}
				/>
			</fieldset>
			<Show
				when={note()}
				fallback={
					<button
						type="button"
						class="link link-hover self-start text-xs text-muted"
						onClick={() => setNote(true)}
					>
						Adicionar nota interna
					</button>
				}
			>
				<fieldset class="fieldset py-0">
					<legend class="fieldset-legend py-0.5">Nota interna</legend>
					<textarea
						class="textarea textarea-sm w-full"
						rows={2}
						placeholder="Só os instrutores veem"
					/>
				</fieldset>
			</Show>
		</>
	);
}

/// The three actions beside the student's name and the dialogs they open.
export default function AttemptActions(props: Props): JSX.Element {
	const [open, setOpen] = createSignal<DialogName | null>(null);
	const [query, setQuery] = createSignal("");
	const [op, setOp] = createSignal<BonusOp>("OFFSET");
	const [value, setValue] = createSignal(15);
	const [target, setTarget] = createSignal(1);
	const [grade, setGrade] = createSignal(0);
	const question = () => ATTEMPT_QUESTIONS.find((q) => q.number === target());

	const onOpen = (e: Event) => {
		const { name, q } = (e as CustomEvent<{ name: DialogName; q?: number }>)
			.detail;
		if (q !== undefined) {
			setTarget(q);
			const found = ATTEMPT_QUESTIONS.find((x) => x.number === q);
			setGrade(found?.override?.score ?? found?.auto ?? 0);
		}
		setOpen(name);
	};
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
				size="max-w-md"
				open={open() === "bonus"}
				onClose={() => setOpen(null)}
				action={{
					label: "Adicionar bônus",
					tone: "btn-primary",
					onClick: () => undefined,
				}}
			>
				<div class="flex flex-col gap-3">
					<div class="join w-full" role="radiogroup" aria-label="Operação">
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
								<input
									type="radio"
									name="bonus-op"
									class="btn btn-sm join-item flex-1"
									aria-label={label}
									checked={op() === key}
									onChange={() => {
										setOp(key);
										setValue(initial);
									}}
								/>
							)}
						</For>
					</div>
					<fieldset class="fieldset py-0">
						<div class="flex items-center gap-3">
							<label class="input input-sm w-40">
								<input
									type="number"
									aria-label="Valor"
									value={value()}
									step={op() === "OFFSET" ? 0.5 : 1}
									onInput={(e) => setValue(e.currentTarget.valueAsNumber || 0)}
								/>
								<span class="label">{op() === "OFFSET" ? "pontos" : "%"}</span>
							</label>
							<Preview
								from={props.autoTotal}
								to={bonusResult()}
								tone="text-success"
								testId="bonus-preview"
							/>
						</div>
						<p class="label whitespace-normal">{bonusHint()}</p>
					</fieldset>
					<ReasonField placeholder="Ex.: resolveu o desafio em aula" />
				</div>
			</Dialog>

			<Dialog
				id="sanction-dialog"
				title="Sancionar"
				size="max-w-md"
				open={open() === "sanction"}
				onClose={() => setOpen(null)}
				action={{
					label: "Sancionar",
					tone: "btn-error",
					onClick: () => undefined,
				}}
			>
				<div class="flex flex-col gap-3">
					<PercentRow
						base={props.autoTotal}
						hint="Nota que fica, abaixo de 100: 50 = ×0,5."
					/>
					<ReasonField placeholder="Ex.: consulta a material não permitido" />
				</div>
			</Dialog>

			<Dialog
				id="question-sanction-dialog"
				title={`Sancionar questão Q${target()}`}
				size="max-w-md"
				open={open() === "question-sanction"}
				onClose={() => setOpen(null)}
				action={{
					label: "Sancionar questão",
					tone: "btn-error",
					onClick: () => undefined,
				}}
			>
				<div class="flex flex-col gap-3">
					<PercentRow
						base={question()?.auto ?? 0}
						unit="%"
						hint="Nota que fica na questão, abaixo de 100: 50 = ×0,5."
					/>
					<ReasonField placeholder="Ex.: respostas copiadas de um colega" />
				</div>
			</Dialog>

			<Dialog
				id="grade-dialog"
				title={`Alterar nota da questão Q${target()}`}
				size="max-w-md"
				open={open() === "grade"}
				onClose={() => setOpen(null)}
				action={{
					label: "Salvar nota",
					tone: "btn-primary",
					onClick: () => undefined,
				}}
			>
				<div class="flex flex-col gap-3">
					<fieldset class="fieldset py-0">
						<div class="flex items-center gap-3">
							<label class="input input-sm w-40">
								<input
									type="number"
									aria-label="Nota"
									min="0"
									max="100"
									value={grade()}
									onInput={(e) => setGrade(e.currentTarget.valueAsNumber || 0)}
								/>
								<span class="label">%</span>
							</label>
							<Preview
								from={question()?.auto ?? 0}
								to={Math.max(0, Math.min(100, grade()))}
								tone="text-success"
								unit="%"
							/>
							<button
								type="button"
								class="btn btn-success btn-soft btn-xs ml-auto"
								onClick={() => setGrade(100)}
							>
								Marcar como certa
							</button>
						</div>
						<p class="label whitespace-normal">Nota da questão, de 0 a 100.</p>
					</fieldset>
					<fieldset class="fieldset py-0">
						<legend class="fieldset-legend py-0.5">
							Comentário (opcional)
						</legend>
						<textarea
							class="textarea textarea-sm w-full"
							rows={2}
							value={question()?.override?.comment ?? ""}
						/>
					</fieldset>
				</div>
			</Dialog>
		</>
	);
}
