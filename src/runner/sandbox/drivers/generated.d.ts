/// Written by the bundle build (`driversModule` in `src/runner/registry.ts`):
/// a loader of the driver of each language in `runner.languages`.
declare module "codehood:runner-drivers" {
	const drivers: Readonly<
		Record<string, () => Promise<import("../driver").Driver>>
	>;
	export default drivers;
}
