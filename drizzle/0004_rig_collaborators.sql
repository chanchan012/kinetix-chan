CREATE TABLE "rig_collaborators" (
	"rig_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	CONSTRAINT "rig_collaborators_rig_id_user_id_pk" PRIMARY KEY("rig_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "rig_collaborators" ADD CONSTRAINT "rig_collaborators_rig_id_rigs_id_fk" FOREIGN KEY ("rig_id") REFERENCES "public"."rigs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rig_collaborators_user_idx" ON "rig_collaborators" USING btree ("user_id","rig_id");