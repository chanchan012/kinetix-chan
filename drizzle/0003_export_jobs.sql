CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rig_id" uuid NOT NULL,
	"format" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"lease_id" uuid,
	"lease_until" timestamp with time zone,
	"artifact" text,
	"byte_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "export_format_valid" CHECK ("export_jobs"."format" in ('lottie','spritesheet','png-sequence','mp4','webm')),
	CONSTRAINT "export_status_valid" CHECK ("export_jobs"."status" in ('queued','running','ready','failed'))
);
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_rig_id_rigs_id_fk" FOREIGN KEY ("rig_id") REFERENCES "public"."rigs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_rig_created_idx" ON "export_jobs" USING btree ("rig_id","created_at");--> statement-breakpoint
CREATE INDEX "export_status_created_idx" ON "export_jobs" USING btree ("status","created_at");