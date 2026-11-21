import { z } from "zod";

export const selectionSchema = z.strictObject({
  kind:z.enum(["bone","part","drawing","image"]), id:z.string().min(1).max(64),
}).nullable();

export const presenceInput = z.strictObject({ clientId:z.uuid(), selection:selectionSchema });
export const presenceSchema = presenceInput.extend({
  userId:z.string().min(1).max(128),
  kind:z.enum(["human","ai"]),
  expiresAt:z.number(),
});
export type RoomPresence = z.infer<typeof presenceSchema>;

export const roomEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type:z.literal("presence"), entry:presenceSchema }),
  z.strictObject({ type:z.literal("revoke"), userId:z.string().min(1).max(128) }),
  z.strictObject({ type:z.literal("timeline"), clipId:z.uuid() }),
  z.strictObject({
    type:z.literal("revision"), revision:z.int().min(0), userId:z.string().min(1).max(128),
    kind:z.enum(["human","ai"]), clientId:z.uuid().optional(),
    label:z.string().max(80).optional(),
  }),
]);
export type RoomEvent = z.infer<typeof roomEventSchema>;
export type RevisionEvent = Extract<RoomEvent,{type:"revision"}>;
