import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const rigs = pgTable("rigs", {
  id: uuid().defaultRandom().primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text().notNull(),
  state: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  revision: integer().notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, t => [
  index("rig_owner_updated_idx").on(t.ownerId, t.updatedAt),
  check("rig_name_valid", sql`length(trim(${t.name})) between 1 and 120`),
  check("rig_revision_nonnegative", sql`${t.revision} >= 0`)
]);

export const clips = pgTable("clips", {
  id: uuid().defaultRandom().primaryKey(),
  rigId: uuid("rig_id").notNull().references(() => rigs.id, { onDelete: "cascade" }),
  name: text().notNull(),
  fps: integer().notNull().default(24),
  frameCount: integer("frame_count").notNull().default(24),
  tracks: jsonb().$type<unknown[]>().notNull().default([]),
  trackRevision: integer("track_revision").notNull().default(0),
  thumbnail: text()
}, t => [
  index("clip_rig_idx").on(t.rigId),
  check("clip_time_valid", sql`${t.fps} between 1 and 120 and ${t.frameCount} > 0`),
  check("clip_track_revision_nonnegative", sql`${t.trackRevision} >= 0`)
]);
