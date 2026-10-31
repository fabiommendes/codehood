/// The Codehood colors offered as swatches by the Tuner, per theme. Mirrors the
/// tables in docs/ui/identity.md and the themes in src/styles/global.css.
export const PALETTE: Record<
	"codehood" | "codehood-dark",
	{ group: string; colors: Record<string, string> }[]
> = {
	codehood: [
		{
			group: "Logo",
			colors: {
				"logo blue": "#1b4b9b",
				"logo red": "#b5452a",
				"logo yellow": "#f2b800",
				"logo green": "#3c8d2f",
				"logo pixel": "#ddd6c6",
			},
		},
		{
			group: "Tema",
			colors: {
				"base-100": "#fffdf8",
				"base-200": "#f7f3ea",
				"base-300": "#e6dfd0",
				content: "#1f2a24",
				muted: "#575f5a",
				"field-border": "#858c87",
				primary: "#1b4b9b",
				secondary: "#f2b800",
				accent: "#a8309a",
				info: "#2670c0",
				success: "#337a27",
				warning: "#e0731f",
				error: "#b5452a",
			},
		},
	],
	"codehood-dark": [
		{
			group: "Logo",
			colors: {
				"logo blue": "#3d7fe6",
				"logo red": "#e2603f",
				"logo yellow": "#f2b800",
				"logo green": "#4fae3f",
				"logo pixel": "#2c5244",
			},
		},
		{
			group: "Tema",
			colors: {
				"base-100": "#15302a",
				"base-200": "#0d211a",
				"base-300": "#1f4034",
				content: "#e6f0ea",
				muted: "#8fb3a4",
				"field-border": "#5f8a78",
				neutral: "#081510",
				primary: "#4aa0ff",
				secondary: "#ffc400",
				accent: "#ff4d97",
				info: "#00d2e6",
				success: "#4cd08a",
				warning: "#ff6f1a",
				error: "#ff5c5c",
				firefly: "#b5f000",
			},
		},
	],
};
