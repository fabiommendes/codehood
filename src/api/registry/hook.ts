import routePatterns from "./route-patterns.json" with { type: "json" };

// The patterns come from a generated file rather than from the route modules
// themselves, because this runs during `astro:config:setup`, where importing
// them pulls in internal Astro APIs that are not ready yet. Run
// `pnpm run route-patterns` to regenerate it from the live registry — `dev` and
// `build` already do.
export const APIS: string[] = routePatterns.map((route) => route.pattern);

export type InjectRoute = (route: {
	pattern: string;
	entrypoint: string;
}) => void;

/**
 * This function is used in the Astro config to register API routes bypassing
 * the tedious path based routing for the API.
 *
 * Use in the config like this:
 *
 * import { dynamicRouterHook } from './src/api/registry/hook';
 *
 * export default defineConfig({
 *     output: 'server',
 *     // ...
 *     integrations: [dynamicRouterHook()],
 * });
 */
export function dynamicRouterHook() {
	return {
		name: "dynamic-api-router",
		hooks: {
			"astro:config:setup": ({ injectRoute }: { injectRoute: InjectRoute }) => {
				for (const pattern of APIS) {
					injectRoute({
						pattern,
						// Path is relative to the config file.
						entrypoint: "./src/api/registry/dynamicHandler.ts",
					});
				}
			},
		},
	};
}
