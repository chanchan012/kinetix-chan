CREATE TABLE "clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rig_id" uuid NOT NULL,
	"name" text NOT NULL,
	"fps" integer DEFAULT 24 NOT NULL,
	"frame_count" integer DEFAULT 24 NOT NULL,
	"tracks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "clip_time_valid" CHECK ("clips"."fps" between 1 and 120 and "clips"."frame_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "rigs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rig_name_valid" CHECK (length(trim("rigs"."name")) between 1 and 120),
	CONSTRAINT "rig_revision_nonnegative" CHECK ("rigs"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_rig_id_rigs_id_fk" FOREIGN KEY ("rig_id") REFERENCES "public"."rigs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clip_rig_idx" ON "clips" USING btree ("rig_id");--> statement-breakpoint
CREATE INDEX "rig_owner_updated_idx" ON "rigs" USING btree ("owner_id","updated_at");