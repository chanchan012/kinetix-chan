import { handle } from "hono/vercel";
import { createApi } from "@/lib/api";
import { services } from "@/lib/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handle(createApi(services));
