declare namespace App {
	interface Locals {
		user?: import("@/db/user.service").user;
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
