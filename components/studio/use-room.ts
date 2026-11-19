"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { presenceSchema, roomEventSchema, type RoomPresence } from "@/lib/realtime/protocol";
import type { Selection } from "./viewport";

const snapshot = z.object({revision:z.int().min(0),presence:z.array(presenceSchema)});

export function useRoom(rigId: string, selected: Selection) {
  const [clientId,setClientId] = useState<string>();
  const [connected,setConnected] = useState(false);
  const [presence,setPresence] = useState<RoomPresence[]>([]);
  const [revision,setRevision] = useState(0);
  const path = "/api/rigs/" + rigId;
  useEffect(() => { setClientId(id => id ?? crypto.randomUUID()); }, []);

  useEffect(() => {
    if (!clientId) return;
    const source = new EventSource(path+"/events");
    const updateRevision = (next: number) => setRevision(previous => Math.max(next,previous));
    const onSnapshot = (message: MessageEvent<string>) => {
      try {
        const data = snapshot.parse(JSON.parse(message.data));
        setPresence(data.presence);
        updateRevision(data.revision);
        setConnected(true);
      } catch {}
    };
    const onRoomEvent = (message: MessageEvent<string>) => {
      try {
        const event = roomEventSchema.parse(JSON.parse(message.data));
        if (event.type === "revision") {
          if (event.clientId !== clientId) updateRevision(event.revision);
        } else if (event.type === "presence") {
          const entry = event.entry;
          setPresence(items => [...items.filter(item => item.userId !== entry.userId || item.clientId !== entry.clientId),entry]);
        } else {
          setPresence(items => items.filter(item=>item.userId!==event.userId));
        }
      } catch {}
    };
    source.addEventListener("snapshot",onSnapshot);
    source.addEventListener("presence",onRoomEvent);
    source.addEventListener("revision",onRoomEvent);
    source.addEventListener("revoke",onRoomEvent);
    source.onerror = () => setConnected(false);
    const pruning = setInterval(() => {
      setPresence(items => items.filter(item => item.expiresAt > Date.now()));
    },6000);
    return () => { source.close(); clearInterval(pruning); };
  }, [clientId,path]);

  const kind = selected?.kind;
  const id = selected?.id;
  useEffect(() => {
    if (!clientId) return;
    const controller = new AbortController();
    const publish = () => void fetch(path+"/presence",{
      method:"POST",headers:{"Content-Type":"application/json"},signal:controller.signal,
      body:JSON.stringify({clientId,selection:id && kind ? {kind,id} : null}),
    }).catch(() => {});
    const first = setTimeout(publish,160);
    const heartbeat = setInterval(publish,18_000);
    return () => { controller.abort(); clearTimeout(first); clearInterval(heartbeat); };
  }, [clientId,path,kind,id]);

  return {clientId,connected,revision,presence:presence.filter(entry => entry.clientId !== clientId)};
}
