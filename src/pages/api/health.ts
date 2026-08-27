export const prerender = false;

import type { APIRoute } from "astro";
import { health } from "@/api/health";

export const GET: APIRoute = (context) => health(context);
