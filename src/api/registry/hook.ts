
// We must update the resource names to match the API routes.
// We cannot import the modules to get the real paths since they use internal
// astro APIs that break during configuration.
const RESOURCES = ["auth",
    "api-key",
    "calendar-event",
    "course",
    "discipline",
    "edition",
    "file",
    "invite",
    "resource",
    "session",
    "time-slot",
    "user",
    "health",
    "courses",
    "users",
    "sessions"
] as const;
export const APIS: string[] = [];

// We extend with some special cases and actions that break the RESTful CRUD pattern.
APIS.push("/api/auth/login", "/api/auth/logout");
APIS.push(...RESOURCES.flatMap((resource) => [`/api/${resource}`, `/api/${resource}/[id]`]));

export type InjectRoute = (route: { pattern: string; entrypoint: string }) => void;

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
