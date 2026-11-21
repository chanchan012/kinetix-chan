import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { rigs, rigTokens } from "./schema";

const identity = {id:rigTokens.id,label:rigTokens.label,createdAt:rigTokens.createdAt,expiresAt:rigTokens.expiresAt,
  allowArchiveReopen:rigTokens.allowArchiveReopen};
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const tokenPattern = /^kinetix_[A-Za-z0-9_-]{43}$/;

export class RigTokens {
  constructor(private db: Pick<PgDatabase<PgQueryResultHKT>,"select"|"insert"|"delete">) {}

  private ownerId(owner: string, rigId: string) {
    return this.db.select({id:rigs.id}).from(rigs).where(and(eq(rigs.id,rigId),eq(rigs.ownerId,owner)));
  }

  async list(owner: string, rigId: string) {
    if (!(await this.ownerId(owner,rigId))[0]) return null;
    return this.db.select(identity).from(rigTokens)
      .where(and(eq(rigTokens.rigId,rigId),gt(rigTokens.expiresAt,new Date())))
      .orderBy(desc(rigTokens.createdAt));
  }

  async create(owner: string, rigId: string, label: string, allowArchiveReopen=false) {
    if (!(await this.ownerId(owner,rigId))[0]) return;
    const token = "kinetix_" + randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now()+30*24*60*60*1000);
    const [credential] = await this.db.insert(rigTokens)
      .values({rigId,label,digest:hash(token),expiresAt,allowArchiveReopen}).returning(identity);
    return {...credential,token};
  }

  async verify(token: string) {
    if (!tokenPattern.test(token)) return;
    return (await this.db.select({id:rigTokens.id,rigId:rigs.id,userId:rigs.ownerId,label:rigTokens.label,
      allowArchiveReopen:rigTokens.allowArchiveReopen})
      .from(rigTokens).innerJoin(rigs,eq(rigs.id,rigTokens.rigId))
      .where(and(eq(rigTokens.digest,hash(token)),gt(rigTokens.expiresAt,new Date()))))[0];
  }

  async revoke(owner: string, rigId: string, id: string) {
    return (await this.db.delete(rigTokens)
      .where(and(eq(rigTokens.id,id),inArray(rigTokens.rigId,this.ownerId(owner,rigId))))
      .returning({id:rigTokens.id}))[0];
  }
}
