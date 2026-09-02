import { z } from "zod";

// =============================================================================
//                              Branding
// =============================================================================
const userId = z.number().brand("UserId");
export type UserId = z.infer<typeof userId>;


// =============================================================================
//                               Schemas
// =============================================================================

//
// User
//
export const userSchema = z.object({
    id: userId,
    publicId: z.string().min(1),
    email: z.email(),
    name: z.string().min(1),
    username: z.string().min(1),
    role: z.enum(["STUDENT", "INSTRUCTOR", "ADMIN"]),
    githubId: z.string().optional(),
    schoolId: z.string().optional(),
    passwordHash: z.string(),
});

export const userCreate = userSchema.omit({
    id: true,
    githubId: true,
    schoolId: true,
    publicId: true,
    passwordHash: true,
}).extend({
    password: z.string().min(1),
    githubId: z.string().optional(),
    schoolId: z.string().optional(),
});

export const userUpdate = userSchema.pick({
    name: true,
    githubId: true,
    schoolId: true,
}).partial();

export const userPK = z.union([
    z.object({ publicId: z.string() }),
    z.object({ id: userId }),
    z.object({ email: z.email() }),
    z.object({ username: z.string() }),
    z.object({ githubId: z.string() }),
    z.object({ schoolId: z.string() }),
    z.object({ login: z.string() }), // email or username
]);

export const userFilter = z.object({
    usernames: z.array(z.string()).optional(),
    take: z.number().int().min(1).max(100).optional(),
});


//
// Course
//
