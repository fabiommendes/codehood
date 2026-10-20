/// Form metadata that a schema carries in `.meta({ form })`.
export type FieldMeta = {
	/// Text of the field's label. Falls back to `title`, then the humanized name.
	label?: string;
	/// Help text under the field. Falls back to `description`.
	hint?: string;
	placeholder?: string;
	/// Overrides the control the field type would otherwise pick.
	widget?: "textarea" | "select" | "radio" | "toggle" | "password";
};

// Augmenting "zod/v4/core" (not "zod") is what makes `.meta({ form })` typed.
declare module "zod/v4/core" {
	interface GlobalMeta {
		form?: FieldMeta;
	}
}
