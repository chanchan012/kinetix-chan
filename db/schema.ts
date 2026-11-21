import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

export const rigCollaborators = pgTable("rig_collaborators", {
  rigId: uuid("rig_id").notNull().references(() => rigs.id, { onDelete:"cascade" }),
  userId: text("user_id").notNull(),
  email: text().notNull(),
}, t => [
  primaryKey({columns:[t.rigId,t.userId]}),
  index("rig_collaborators_user_idx").on(t.userId,t.rigId),
]);

export const rigTokens = pgTable("rig_tokens", {
  id: uuid().defaultRandom().primaryKey(),
  rigId: uuid("rig_id").notNull().references(() => rigs.id, { onDelete:"cascade" }),
  label: text().notNull(),
  allowArchiveReopen:boolean("allow_archive_reopen").notNull().default(false),
  digest: text().notNull().unique(),
  createdAt: timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
  expiresAt: timestamp("expires_at",{withTimezone:true}).notNull(),
}, t => [index("rig_tokens_rig_idx").on(t.rigId,t.createdAt)]);

export const exportJobs = pgTable("export_jobs", {
  id: uuid().primaryKey(),
  rigId: uuid("rig_id").notNull().references(() => rigs.id, { onDelete: "cascade" }),
  format: text({enum:["lottie","spritesheet","png-sequence","mp4","webm"]}).notNull(),
  status: text({enum:["queued","running","ready","failed"]}).notNull().default("queued"),
  snapshot: jsonb().$type<Record<string, unknown>>().notNull(),
  leaseId: uuid("lease_id"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  artifact: text(),
  byteCount: integer("byte_count"),
  createdAt: timestamp("created_at", {withTimezone:true}).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", {withTimezone:true}).defaultNow().notNull(),
}, t => [
  index("export_rig_created_idx").on(t.rigId,t.createdAt),
  index("export_status_created_idx").on(t.status,t.createdAt),
  check("export_format_valid", sql`${t.format} in ('lottie','spritesheet','png-sequence','mp4','webm')`),
  check("export_status_valid", sql`${t.status} in ('queued','running','ready','failed')`),
]);
