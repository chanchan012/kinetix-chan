"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Credential = {id:string;label:string;expiresAt:string;allowArchiveReopen:boolean};

export function McpDialog({rigId,close}:{rigId:string;close:()=>void}) {
  const element = useRef<HTMLDialogElement>(null);
  const [credentials,setCredentials] = useState<Credential[]>([]);
  const [token,setToken] = useState("");
  const [transport,setTransport] = useState<"http"|"stdio">("http");
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [endpoint,setEndpoint] = useState("");
  const path = "/api/rigs/"+rigId+"/mcp-credentials";

  useEffect(() => {
    const dialog = element.current!;
    const controller = new AbortController();
    dialog.showModal();
    setEndpoint(location.origin+"/api/mcp");
    void fetch(path,{cache:"no-store",signal:controller.signal}).then(async response => {
      if (!response.ok) throw new Error("Cannot load");
      const rows = await response.json();
      if (!controller.signal.aborted) setCredentials(rows);
    }).catch(()=> { if (!controller.signal.aborted) setMessage("Could not list credentials."); });
    return () => { controller.abort(); dialog.close(); };
  },[path]);

  async function create(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setMessage("");
    try {
      const fields=new FormData(form);
      const response = await fetch(path,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({label:fields.get("label"),allowArchiveReopen:fields.has("archive-reopen")}),
      });
      if (!response.ok) throw new Error("Cannot issue");
      const { token:secret,...credential }: Credential & {token:string} = await response.json();
      setToken(secret);
      setCredentials(items=>[credential,...items]);
      form.reset();
    } catch {setMessage("Could not create a rig credential.");}
    finally {setBusy(false);}
  }

  async function revoke(credential:Credential) {
    if (!window.confirm("Revoke the credential "+credential.label+"?")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path+"/"+credential.id,{method:"DELETE"});
      if (!response.ok) throw new Error("Cannot revoke");
      setCredentials(items=>items.filter(item=>item.id!==credential.id));
      setToken("");
    } catch {setMessage("Could not revoke the rig credential.");}
    finally {setBusy(false);}
  }

  const placeholder = token || "<rig-credential>";
  const config = transport==="http" ?
    {type:"streamable-http",url:endpoint,headers:{Authorization:"Bearer "+placeholder}} :
    {command:"node",args:["/absolute/path/kinetix-chan/scripts/kinetix-mcp.mjs"],env:{KINETIX_MCP_URL:endpoint,KINETIX_MCP_TOKEN:placeholder}};

  return <dialog ref={element} className="studio-easing studio-share studio-mcp" aria-label="MCP setup" onCancel={close}>
    <header><h2>MCP setup</h2><button onClick={close}>Close</button></header>
    <form onSubmit={create}>
      <label>Credential name<input name="label" maxLength={80} placeholder="Animator" required/></label>
      <label className="studio-check"><input name="archive-reopen" type="checkbox"/>Allow reopening archives as new private projects</label>
      <button className="studio-save" disabled={busy}>Create credential</button>
    </form>
    <div className="studio-tool-group" aria-label="Connection type">
      <button aria-pressed={transport==="http"} onClick={()=>setTransport("http")}>HTTP</button>
      <button aria-pressed={transport==="stdio"} onClick={()=>setTransport("stdio")}>stdio</button>
    </div>
    {token && <p className="studio-export-note">Copy this credential before closing. It expires in 30 days.</p>}
    <pre>{JSON.stringify(config,null,2)}</pre>
    <button onClick={()=>void navigator.clipboard.writeText(JSON.stringify(config,null,2))
      .then(()=>setMessage("Configuration copied.")).catch(()=>setMessage("Select and copy the configuration above."))}>Copy configuration</button>
    {message && <p role="status">{message}</p>}
    {credentials.length > 0 && <ul aria-label="Rig credentials">{credentials.map(credential => <li key={credential.id}>
      <span>{credential.label} · {new Date(credential.expiresAt).toLocaleDateString()}{credential.allowArchiveReopen && " · Archive reopening"}</span>
      <button disabled={busy} onClick={()=>void revoke(credential)}>Revoke</button>
    </li>)}</ul>}
  </dialog>;
}
