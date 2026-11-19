import Link from "next/link";
import { SignIn, SignUp } from "@clerk/nextjs";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { Brand } from "./brand";

const appearance = {
  elements: {
    rootBox: { width: "100%", maxWidth: "100%" },
    cardBox: { width: "100%", maxWidth: "100%" }
  }
};

export function Access({signup = false}: {signup?: boolean}) {
  return <div className="app-shell">
    <header className="topbar"><Brand/><nav><Link className="guide-link" href="/"><ArrowLeftIcon/> Home</Link></nav></header>
    <main className="access-main"><section className="access-panel" aria-label={signup ? "Create your account" : "Sign in"}>
      {signup ? <SignUp routing="path" path="/sign-up" appearance={appearance} fallback={<p role="status">Loading sign-up…</p>}/> :
        <SignIn routing="path" path="/sign-in" appearance={appearance} fallback={<p role="status">Loading sign-in…</p>}/>}
    </section></main>
  </div>;
}
