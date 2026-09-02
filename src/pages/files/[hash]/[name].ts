import type { APIRoute } from "astro";
import { serveBlob } from "@/utils/serve-blob";

export const prerender = false;

export const GET: APIRoute = ({ params }) =>
	serveBlob(params.hash, params.name);
