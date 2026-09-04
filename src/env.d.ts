declare namespace App {
	interface Locals {
		actor?: import("@/core/actor").UserActor;
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
