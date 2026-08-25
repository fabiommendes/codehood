declare namespace App {
	interface Locals {
		user?: {
			id: number;
			role: import("@/db/client").Role;
		};
		apiKey?: {
			id: number;
			kind: import("@/db/client").ApiKeyKind;
		};
	}
}

declare global {
	var prisma: {
		prisma?: import("./generated/prisma/client").PrismaClient;
	};
}
