"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Collaborator = {userId:string;email:string};

export function ShareDialog({rigId,close}: {rigId:string;close:()=>void}) {
  const element = useRef<HTMLDialogElement>(null);
  const [editors,setEditors] = useState<Collaborator[]>([]);
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const path = "/api/rigs/"+rigId+"/collaborators";
  useEffect(() => {
    const dialog = element.current!;
    const controller = new AbortController();
    dialog.showModal();
    void fetch(path,{ signal:controller.signal,cache:"no-store" }).then(async response => {
      if (!response.ok) throw new Error("Cannot load");
      setEditors(await response.json());
    }).catch(() => { if (!controller.signal.aborted) setMessage("Could not load editors."); });
    return () => { controller.abort(); dialog.close(); };
  },[path]);

  async function add(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = new FormData(form).get("email");
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email}),
      });
      if (response.status === 404) {
        setMessage("Enter the verified email of another Kinetix account.");
        return;
      }
      if (!response.ok) throw new Error("Cannot share");
      const editor: Collaborator = await response.json();
      setEditors(items=>[...items.filter(item=>item.userId!==editor.userId),editor]);
      form.reset();
    } catch {
      setMessage("Could not share the rig. Try again.");
    } finally { setBusy(false); }
  }

  async function remove(editor:Collaborator) {
    if (!window.confirm("Remove editor access for "+editor.email+"?")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path+"/"+encodeURIComponent(editor.userId),{method:"DELETE"});
      if (!response.ok) throw new Error("Cannot remove");
      setEditors(items=>items.filter(item=>item.userId!==editor.userId));
    } catch { setMessage("Could not revoke access. Try again."); }
    finally { setBusy(false); }
  }

  return <dialog className="studio-easing studio-share" ref={element} aria-label="Share rig" onCancel={close}>
    <header><h2>Share rig</h2><button onClick={close}>Close</button></header>
    <form onSubmit={add}>
      <label>Editor email<input type="email" name="email" maxLength={254} required/></label>
      <button className="studio-save" disabled={busy}>Grant editor access</button>
    </form>
    {message && <p role="alert">{message}</p>}
    <ul>{editors.map(editor => <li key={editor.userId}><span>{editor.email}</span>
      <button disabled={busy} onClick={()=>void remove(editor)}>Remove</button></li>)}</ul>
  </dialog>;
}
