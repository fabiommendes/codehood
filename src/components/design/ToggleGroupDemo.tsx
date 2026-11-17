import type { JSX } from "solid-js";
import { createSignal } from "solid-js";
import ToggleGroup from "@/components/ui/ToggleGroup";

const STATUSES = [
	{ value: "open", label: "Open" },
	{ value: "triage", label: "Triage" },
	{ value: "resolved", label: "Resolved" },
] as const;

/// Both modes of `ToggleGroup`, live, for the design catalogue.
export default function ToggleGroupDemo(): JSX.Element {
	const [one, setOne] =
		createSignal<(typeof STATUSES)[number]["value"]>("open");
	const [many, setMany] = createSignal<string[]>(["open", "triage"]);

	return (
		<div class="flex flex-col gap-4">
			<ToggleGroup
				label="Single choice"
				options={STATUSES}
				value={one()}
				onChange={setOne}
			/>
			<ToggleGroup
				mode="multiple"
				label="Several choices"
				options={STATUSES}
				value={many()}
				onChange={setMany}
			/>
		</div>
	);
}
