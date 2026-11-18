import Link from "next/link";
import { SignIn, SignUp } from "@clerk/nextjs";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { Brand } from "./brand";
import { clerkEnabled } from "@/lib/config";
import { ArtCanvas } from "./art-canvas";
import { studies } from "@/lib/studies";

export function Access({signup = false}: {signup?: boolean}) {
  const accounts = clerkEnabled();
  return <div className="app-shell"><header className="topbar"><Brand/><nav><Link className="guide-link" href="/"><ArrowLeftIcon/> Playground</Link></nav></header>
    <main className="access-main"><section className="access-panel">
    {accounts ? <>{signup ? <SignUp routing="path" path="/sign-up"/> : <SignIn routing="path" path="/sign-in"/>}<Link className="guest-link" href="/?demo=1">Continue as guest <ArrowRightIcon/></Link></> :
      <><div className="auth-art"><ArtCanvas study={studies[0]} mini rig/></div><p className="eyebrow">GUEST ACCESS</p><h1>{signup ? "Join the playground." : "Welcome to Kinetix."}</h1>
      <p>This workspace is open in guest mode. Explore the motion studies and inspect every frame without an account.</p>
      <Link className="primary" href="/?demo=1">Continue as guest <ArrowRightIcon size={18}/></Link></>}
    </section></main>
  </div>;
}
