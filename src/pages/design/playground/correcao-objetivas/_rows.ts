/// Turns fixtures into the serializable rows the islands take.

import {
	type Block,
	type Group,
	type Member,
	meanOf,
	studentLabel,
} from "./_data";
import type { GroupedRow } from "./_GroupedAnswers";
import type { MemberRow } from "./_Members";

/// The member as an island row, with the student shown by number or by name.
export function memberRow(
	m: Member,
	names: boolean,
	detail?: string,
): MemberRow {
	return {
		id: m.student.id,
		name: studentLabel(m.student, names),
		auto: m.auto,
		avg: m.student.avg,
		manual: m.manual,
		detail: detail ?? m.detail,
	};
}

/// The groups of a block as rows with a text (or chips) response; pages refine `response` per question type.
export function groupRows(
	block: Block,
	names: boolean,
	detail?: (m: Member, g: Group) => string | undefined,
): GroupedRow[] {
	const total = block.groups.reduce((n, g) => n + g.members.length, 0);
	return block.groups.map((g) => ({
		id: g.label,
		response: g.chips
			? { kind: "chips", chips: g.chips, text: g.label }
			: { kind: "text", text: g.label },
		sub: g.sub,
		tag: g.tag,
		score: g.score,
		count: g.members.length,
		percent: Math.round((g.members.length / total) * 100),
		changed: g.members.filter((m) => m.manual !== undefined).length,
		mean: meanOf(g),
		diagnosis: g.flag,
		members: g.members.map((m) => memberRow(m, names, detail?.(m, g))),
	}));
}
