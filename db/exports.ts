import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ExportFormat, ExportSnapshot } from "../lib/export/frames";
import { clips, exportJobs, rigs } from "./schema";

const publicFields = {
  id: exportJobs.id, rigId: exportJobs.rigId, status: exportJobs.status, format: exportJobs.format,
  byteCount: exportJobs.byteCount, createdAt: exportJobs.createdAt, updatedAt: exportJobs.updatedAt,
};

export class ExportQueue {
  constructor(private db: Pick<PgDatabase<PgQueryResultHKT>,"select"|"insert"|"update"|"delete">) {}

  private owned(owner: string, rigId: string) {
    const permitted = this.db.select({id:rigs.id}).from(rigs).where(and(eq(rigs.ownerId,owner),eq(rigs.id,rigId)));
    return inArray(exportJobs.rigId,permitted);
  }

  async inputs(owner: string, rigId: string, clipId?: string) {
    const rows = await this.db.select({
      rigId:rigs.id, name:rigs.name, state:rigs.state,
      clip:{ id:clips.id, name:clips.name, fps:clips.fps, frameCount:clips.frameCount, tracks:clips.tracks },
    }).from(rigs)
      .leftJoin(clips, clipId ? and(eq(clips.rigId,rigs.id),eq(clips.id,clipId)) : sql`false`)
      .where(and(eq(rigs.ownerId,owner),eq(rigs.id,rigId)));
    const row = rows[0];
    return clipId && !row?.clip ? undefined : row;
  }

  async enqueue(owner: string, rigId: string, id: string, format: ExportFormat, snapshot: ExportSnapshot) {
    const [job] = await this.db.insert(exportJobs).values({rigId,id,format,snapshot})
      .onConflictDoNothing({target:exportJobs.id}).returning(publicFields);
    if (job) return job;
    return (await this.db.select(publicFields).from(exportJobs)
      .where(and(this.owned(owner,rigId),eq(exportJobs.id,id),eq(exportJobs.format,format))))[0];
  }

  list(owner: string, rigId: string) {
    return this.db.select(publicFields).from(exportJobs).where(this.owned(owner,rigId))
      .orderBy(desc(exportJobs.createdAt),desc(exportJobs.id)).limit(30);
  }

  async download(owner: string, rigId: string, id: string) {
    return (await this.db.select({ format:exportJobs.format, artifact:exportJobs.artifact })
      .from(exportJobs).where(and(this.owned(owner,rigId),eq(exportJobs.id,id),eq(exportJobs.status,"ready"))))[0];
  }

  private available(now: Date) {
    return or(eq(exportJobs.status,"queued"),and(eq(exportJobs.status,"running"),lte(exportJobs.leaseUntil,now)));
  }

  async claim(id?: string, now = new Date()) {
    const available = this.available(now);
    const candidate = id ?? (await this.db.select({id:exportJobs.id}).from(exportJobs).where(available)
      .orderBy(asc(exportJobs.createdAt),asc(exportJobs.id)).limit(1))[0]?.id;
    if (!candidate) return;
    const leaseId = crypto.randomUUID();
    return (await this.db.update(exportJobs).set({
      status:"running",leaseId,leaseUntil:new Date(now.getTime()+180_000),updatedAt:now,
    }).where(and(eq(exportJobs.id,candidate),available))
      .returning({id:exportJobs.id,format:exportJobs.format,snapshot:exportJobs.snapshot,leaseId:exportJobs.leaseId}))[0];
  }

  finish(id: string, leaseId: string, artifact: Buffer | null) {
    return this.db.update(exportJobs).set({
      status:artifact ? "ready" : "failed", leaseId:null, leaseUntil:null, updatedAt:new Date(),
      artifact:artifact?.toString("base64") ?? null, byteCount:artifact?.length ?? null,
    }).where(and(eq(exportJobs.id,id),eq(exportJobs.leaseId,leaseId),eq(exportJobs.status,"running")))
      .returning({id:exportJobs.id,status:exportJobs.status});
  }
}
