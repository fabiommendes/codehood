import type { APIRoute } from "astro";
import { db } from "@/db";

export const prerender = false;

export const GET: APIRoute = ({ params }) =>
	db.blob.serve(params.hash, undefined);
