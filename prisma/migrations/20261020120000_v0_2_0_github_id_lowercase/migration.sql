-- GitHub usernames are stored lowercase and without a leading "@".
-- Fails if two users differ only in case: resolve those by hand first.
UPDATE "User"
SET "githubId" = lower(ltrim("githubId", '@'))
WHERE "githubId" NOT LIKE '!%';
