import { and, asc, desc, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { clips, rigCollaborators, rigs } from "./schema";
import type { Study } from "../lib/studies";
import { createBlankRig, createRigState, type Artboard, type KinetixRigState } from "../lib/rig/model";
import type { Track } from "../lib/rig/animation";
import { ExportQueue } from "./exports";
import { RigTokens } from "./tokens";

type ClipInput = Pick<typeof clips.$inferInsert, "name" | "fps" | "frameCount">;
const rigFields = {id:rigs.id,name:rigs.name,state:rigs.state,revision:rigs.revision,updatedAt:rigs.updatedAt};
const clipFields = {id:clips.id,name:clips.name,fps:clips.fps,frameCount:clips.frameCount,thumbnail:clips.thumbnail};
const clipAnimationFields = {
  id:clips.id, name:clips.name, fps:clips.fps, frameCount:clips.frameCount,
  tracks:clips.tracks, trackRevision:clips.trackRevision,
};

export class Library {
  readonly exports: ExportQueue;
  readonly tokens: RigTokens;
  constructor(private db: Pick<PgDatabase<PgQueryResultHKT>, "select" | "insert" | "update" | "delete" | "execute">) {
    this.exports = new ExportQueue(db);
    this.tokens = new RigTokens(db);
  }

  private owned(owner:string,id:string) {
    return and(eq(rigs.ownerId,owner),eq(rigs.id,id));
  }
  private canEdit(user:string) {
    const grant = this.db.select({userId:rigCollaborators.userId}).from(rigCollaborators)
      .where(and(eq(rigCollaborators.rigId,rigs.id),eq(rigCollaborators.userId,user)));
    return or(eq(rigs.ownerId,user),exists(grant));
  }
  list(user:string) {
    return this.db.select({...rigFields,owned:sql<boolean>`${rigs.ownerId} = ${user}`})
      .from(rigs).where(this.canEdit(user)).orderBy(desc(rigs.updatedAt),asc(rigs.id));
  }
  async get(owner:string,id:string) {
    return (await this.db.select(rigFields).from(rigs).where(this.owned(owner,id)))[0];
  }
  async open(user:string,id:string) {
    return (await this.db.select({...rigFields,owned:sql<boolean>`${rigs.ownerId} = ${user}`})
      .from(rigs).where(and(eq(rigs.id,id),this.canEdit(user))))[0];
  }
  async rigRevision(user:string,id:string) {
    return (await this.db.select({revision:rigs.revision}).from(rigs)
      .where(and(eq(rigs.id,id),this.canEdit(user))))[0]?.revision;
  }
  async collaborators(owner:string,id:string) {
    if (!await this.get(owner,id)) return null;
    return this.db.select({userId:rigCollaborators.userId,email:rigCollaborators.email}).from(rigCollaborators)
      .where(eq(rigCollaborators.rigId,id)).orderBy(asc(rigCollaborators.email));
  }
  async addCollaborator(owner:string,id:string,user:string,email:string) {
    if (owner === user || !await this.get(owner,id)) return;
    return (await this.db.insert(rigCollaborators).values({rigId:id,userId:user,email})
      .onConflictDoUpdate({target:[rigCollaborators.rigId,rigCollaborators.userId],set:{email}})
      .returning({userId:rigCollaborators.userId,email:rigCollaborators.email}))[0];
  }
  async removeCollaborator(owner:string,id:string,user:string) {
    const owned = this.db.select({id:rigs.id}).from(rigs).where(this.owned(owner,id));
    return (await this.db.delete(rigCollaborators)
      .where(and(inArray(rigCollaborators.rigId,owned),eq(rigCollaborators.userId,user)))
      .returning({userId:rigCollaborators.userId}))[0];
  }
  async create(owner:string,name:string,source:Study["id"] | Artboard) {
    const state = typeof source === "string" ? createRigState(source) : createBlankRig(source);
    return (await this.db.insert(rigs).values({ownerId:owner,name,state}).returning(rigFields))[0];
  }
  async saveRigState(owner:string,id:string,revision:number,state:KinetixRigState) {
    const study = sql`case when ${rigs.state}->>'version' = '2' then 'blank'
      when ${rigs.state}->>'study' in ('fox','heron','fish')
      then ${rigs.state}->>'study' else 'fox' end`;
    const [saved] = await this.db.update(rigs).set({
      state, updatedAt:new Date(), revision:sql`${rigs.revision} + 1`,
    }).where(and(eq(rigs.id,id),this.canEdit(owner),eq(rigs.revision,revision),sql`${study} = ${state.study ?? "blank"}`))
      .returning(rigFields);
    return saved;
  }
  async saveSequenceImport(user:string,id:string,revision:number,state:KinetixRigState,clip:ClipInput & {id:string}) {
    // Neon HTTP executes this as one statement, so both writes roll back if clip creation fails.
    const result=await this.db.execute<{revision:number}>(sql`
      with saved as (
        update rigs set state = ${JSON.stringify(state)}::jsonb, revision = ${rigs.revision} + 1, updated_at = now()
        where ${and(eq(rigs.id,id),this.canEdit(user),eq(rigs.revision,revision))}
          and not exists (select 1 from clips where id = ${clip.id}::uuid)
        returning id, revision
      ), added as (
        insert into clips (id, rig_id, name, fps, frame_count)
        select ${clip.id}::uuid, saved.id, ${clip.name}, ${clip.fps}, ${clip.frameCount} from saved returning id
      )
      select saved.revision from saved cross join added`);
    return (result as {rows:{revision:number}[]}).rows[0];
  }
  async rename(owner:string,id:string,name:string) {
    return (await this.db.update(rigs).set({name,updatedAt:new Date(),revision:sql`${rigs.revision} + 1`}).where(this.owned(owner,id)).returning(rigFields))[0];
  }
  async remove(owner:string,id:string) {
    return (await this.db.delete(rigs).where(this.owned(owner,id)).returning({id:rigs.id}))[0];
  }
  private parent(owner:string,id:string) {
    return this.db.select({id:rigs.id}).from(rigs).where(and(eq(rigs.id,id),this.canEdit(owner)));
  }
  async listClips(owner:string,id:string) {
    if (!await this.open(owner,id)) return null;
    return this.db.select(clipFields).from(clips).where(inArray(clips.rigId,this.parent(owner,id))).orderBy(asc(clips.name),asc(clips.id));
  }
  listClipAnimation(owner:string,id:string) {
    return this.db.select(clipAnimationFields).from(clips).where(inArray(clips.rigId,this.parent(owner,id)))
      .orderBy(asc(clips.name),asc(clips.id));
  }
  listClipVersions(user:string,id:string) {
    return this.db.select({id:clips.id,revision:clips.trackRevision}).from(clips)
      .where(inArray(clips.rigId,this.parent(user,id))).orderBy(asc(clips.id));
  }
  async getClipAnimation(owner:string,id:string,clipId:string) {
    return (await this.db.select(clipAnimationFields).from(clips)
      .where(and(eq(clips.id,clipId),inArray(clips.rigId,this.parent(owner,id)))))[0];
  }
  async saveClipTracks(owner:string,id:string,clipId:string,trackRevision:number,tracks:Track[]) {
    return (await this.db.update(clips).set({tracks,trackRevision:sql`${clips.trackRevision} + 1`})
      .where(and(eq(clips.id,clipId),inArray(clips.rigId,this.parent(owner,id)),eq(clips.trackRevision,trackRevision)))
      .returning(clipAnimationFields))[0];
  }
  async addClip(owner:string,id:string,input:ClipInput) {
    // INSERT ... SELECT keeps the ownership check and write in a single statement.
    const rows = await this.db.execute(sql`
      insert into clips (rig_id,name,fps,frame_count)
      select ${rigs.id}, ${input.name}, ${input.fps}, ${input.frameCount} from ${rigs} where ${and(eq(rigs.id,id),this.canEdit(owner))}
      returning id,name,fps,frame_count as "frameCount",thumbnail`);
    return (rows as {rows:Record<string,unknown>[]}).rows[0];
  }
  async editClip(owner:string,id:string,clipId:string,input:ClipInput) {
    // Trim keys outside a shortened clip in the same update that changes its duration.
    const tracks = sql`case when ${clips.frameCount} <= ${input.frameCount} then ${clips.tracks} else
      coalesce((select jsonb_agg(jsonb_set(track, '{keys}', kept.keys) order by track_index)
        from jsonb_array_elements(${clips.tracks}) with ordinality as source(track, track_index)
        cross join lateral (select jsonb_agg(key order by key_index) as keys
          from jsonb_array_elements(track->'keys') with ordinality as entries(key, key_index)
          where (key->>'frame')::int < ${input.frameCount}) as kept
        where kept.keys is not null), '[]'::jsonb) end`;
    return (await this.db.update(clips).set({...input,tracks,trackRevision:sql`${clips.trackRevision} + 1`,thumbnail:null})
      .where(and(eq(clips.id,clipId),inArray(clips.rigId,this.parent(owner,id)))).returning(clipFields))[0];
  }
  async removeClip(owner:string,id:string,clipId:string) {
    return (await this.db.delete(clips).where(and(eq(clips.id,clipId),inArray(clips.rigId,this.parent(owner,id))))
      .returning({id:clips.id}))[0];
  }
  pending() {
    return this.db.select({id:clips.id,state:rigs.state,fps:clips.fps,frames:clips.frameCount})
      .from(clips).innerJoin(rigs,eq(rigs.id,clips.rigId)).where(isNull(clips.thumbnail)).orderBy(asc(clips.id)).limit(50);
  }
  saveThumbnail(id:string,fps:number,frames:number,thumbnail:string) {
    return this.db.update(clips).set({thumbnail}).where(and(eq(clips.id,id),eq(clips.fps,fps),
      eq(clips.frameCount,frames),isNull(clips.thumbnail))).returning({id:clips.id});
  }
}
