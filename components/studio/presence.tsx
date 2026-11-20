"use client";

import { Robot, User, Users } from "@phosphor-icons/react";
import type { KinetixRigState } from "@/lib/rig/model";
import type { RoomPresence } from "@/lib/realtime/protocol";

export function Presence({connected, entries, rig}: {
  connected: boolean; entries: RoomPresence[]; rig: KinetixRigState;
}) {
  return <div className="studio-presence" role="group" aria-label="Collaborators">
    <span className="studio-connection" role="status" data-connected={connected}
      aria-label={connected ? "Collaboration connected" : "Connecting collaboration"}
      title={connected ? "Collaboration connected" : "Connecting collaboration"}><span/></span>
    <span className="studio-avatar studio-avatar-self" role="img" aria-label="You" title="You"><User size={15} weight="fill"/></span>
    {entries.slice(0, 3).map(entry => {
      const selection = entry.selection;
      const objects = selection?.kind==="bone" ? rig.bones : selection?.kind==="drawing" ? rig.drawings?.layers : rig.parts;
      const target = selection && objects?.find(item=>item.id===selection.id)?.name;
      const label = (entry.kind === "ai" ? "AI" : "Editor") + " · " + (target || "Viewing");
      const Icon = entry.kind === "ai" ? Robot : User;
      return <span key={entry.userId + ":" + entry.clientId} className="studio-avatar" data-kind={entry.kind}
        role="img" aria-label={label} title={label}><Icon size={15} weight="fill"/></span>;
    })}
    {entries.length > 3 && <span className="studio-avatar" role="img" aria-label={String(entries.length - 3) + " more collaborators"}><Users size={15}/></span>}
  </div>;
}
