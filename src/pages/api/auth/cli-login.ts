export const prerender = false;

import type { APIRoute } from "astro";
import { cliLogin } from "@/api/auth";

export const POST: APIRoute = (context) => cliLogin(context);
