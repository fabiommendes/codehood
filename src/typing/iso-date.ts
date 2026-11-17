import type { z } from "zod";

/// A calendar date as `YYYY-MM-DD`, with no time zone. Built by `isoDate` (`@/core/schemas/base`).
export type IsoDate = string & z.$brand<"IsoDate">;
