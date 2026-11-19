CREATE TABLE "rig_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rig_id" uuid NOT NULL,
	"label" text NOT NULL,
	"digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rig_tokens_digest_unique" UNIQUE("digest")
);
--> statement-breakpoint
ALTER TABLE "rig_tokens" ADD CONSTRAINT "rig_tokens_rig_id_rigs_id_fk" FOREIGN KEY ("rig_id") REFERENCES "public"."rigs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rig_tokens_rig_idx" ON "rig_tokens" USING btree ("rig_id","created_at");