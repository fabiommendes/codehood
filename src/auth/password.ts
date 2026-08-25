import { hash, verify } from "@node-rs/argon2";

// OWASP baseline for Argon2id: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
// `algorithm: 2` is Argon2id (@node-rs/argon2's `Algorithm` is an ambient const enum,
// which verbatimModuleSyntax forbids importing just to reference its value).
const OPTIONS = {
	algorithm: 2,
	memoryCost: 19456,
	timeCost: 2,
	parallelism: 1,
};

/**
 * Hashes a plaintext password. The returned PHC string embeds its own parameters and salt.
 */
export function hashPassword(password: string): Promise<string> {
	return hash(password, OPTIONS);
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
