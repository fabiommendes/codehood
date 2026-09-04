/**
 * Throw a 404 error if the entity is null, otherwise return the entity.
 * 
 * Useful to put in the return statement of a service method that returns the entity:
 * 
 * ```ts
 * const user = await userService.findOne(filter, opts);
 * return entityOr404(user);
 * ```
 */
export function entityOr404<T>(entity: T | null): T {
    if (!entity) {
        // TODO: define a NotFoundError class and throw that instead of a generic Error
        throw new Error("Entity not found");
    }
    return entity;
}
