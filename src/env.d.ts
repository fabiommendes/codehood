declare namespace App {
	interface Locals {
		actor?: import("@/auth/actor").UserActor;
		apiKey?: {
			id: import("@/core/schemas").ApiKeyId;
			kind: import("@/db/client").ApiKeyKind;
		};
	}
}

declare global {
	var prisma: {
		prisma?: import("./generated/prisma/client").PrismaClient;
	};
}
