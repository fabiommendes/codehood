import { hash, verify } from "@node-rs/argon2";
import COMMON_PASSWORDS from "./common-passwords.json" with { type: "json" };

export type PasswordErrorCode = "too-short" | "too-common" | "compromised";
export type PasswordError = {
	message: string;
	code: PasswordErrorCode;
};

// OWASP baseline for Argon2id: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
// `algorithm: 2` is Argon2id (@node-rs/argon2's `Algorithm` is an ambient const enum,
// which verbatimModuleSyntax forbids importing just to reference its value).
const HASHING_OPTIONS = {
	algorithm: 2,
	memoryCost: 19456,
	timeCost: 2,
	parallelism: 1,
};

const PASSWORD_MINIMUM_LENGTH = 8;
const PASSWORD_COMMON_WORDS = buildCommonWordsSet(COMMON_PASSWORDS);

/**
 * Verify if password meets minimum strength requirements.
 *
 * Returns "ok" if it does, or an array of error messages if it doesn't.
 */
export async function passwordStrengthIssues(
	password: string,
): Promise<PasswordError[] | undefined> {
	const errors: PasswordError[] = [];

	if (password.length < PASSWORD_MINIMUM_LENGTH) {
		errors.push({
			code: "too-short",
			message: `Password must be at least ${PASSWORD_MINIMUM_LENGTH} characters long`,
		});
	}

	if (PASSWORD_COMMON_WORDS.has(password)) {
		errors.push({
			code: "too-common",
			message: `Password is too common`,
		});
	}

	if (await passwordInTheWild(password)) {
		errors.push({
			code: "compromised",
			message: `Password has been compromised in a data breach`,
		});
	}

	// TODO: Add more checks for strength, e.g. uppercase, lowercase, numbers, symbols, etc.
	// We must design a good balance between security and usability.
	// Probably it should be configurable via env vars.

	return errors.length === 0 ? undefined : errors;
}

/**
 * Hashes a plaintext password.
 *
 * The returned PHC string embeds its own parameters and salt.
 */
export function hashPassword(password: string): Promise<string> {
	return hash(password, HASHING_OPTIONS);
}

/**
 * Verifies a plaintext password against a stored hash produced by {@link hashPassword}.
 */
export function verifyPassword(
	hashed: string,
	password: string,
): Promise<boolean> {
	return verify(hashed, password);
}

//
// Auxiliary functions
//
function buildCommonWordsSet(words: string[]): Set<string> {
	const set = new Set<string>();
	for (let word of words) {
		if (word.endsWith("[]")) {
			// add all substrings of the word, e.g. "password" -> "pass", "passw", "password"
			word = word.slice(0, -2);
			for (let i = PASSWORD_MINIMUM_LENGTH; i <= word.length - 2; i++) {
				set.add(word.slice(0, i));
			}
		} else {
			set.add(word);
		}
	}
	return set;
}

// Import an old CommonJS module.
type WildLeek = (password: string) => Promise<boolean>;
let WILDLEEK: WildLeek | undefined;

async function passwordInTheWild(password: string): Promise<boolean> {
	if (!WILDLEEK) {
		const module = (await import("wildleek" as unknown as "wildleek")) as { default: WildLeek };
		WILDLEEK = module.default;
	}
	return WILDLEEK(password);
}
