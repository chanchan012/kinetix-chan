import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function connectDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is required for persistent rigs.");
  return drizzle(neon(url), { schema });
}
