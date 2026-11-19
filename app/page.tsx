import Link from "next/link";
import { Show, UserButton } from "@clerk/nextjs";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { Brand } from "@/components/brand";
import { StudyLinks } from "@/components/study-links";
import { ArtCanvas } from "@/components/art-canvas";
import { studies } from "@/lib/studies";

export default function Home() {
  const fox = studies[0];
  return <div className="app-shell">
    <header className="topbar"><Brand/><span className="brand-divider"/><span className="studio-name">Motion Studio</span>
      <nav aria-label="Account"><Show when="signed-out"><Link className="signin" href="/sign-in">Sign in</Link></Show>
        <Show when="signed-in"><UserButton/></Show></nav></header>
    <main className="landing"><div className="hero">
      <section className="intro"><p className="eyebrow"><span className="signal"/> 2D ANIMATION STUDIO</p>
        <h1>Make it<br/><em>move.</em></h1>
        <p className="lede">Build a library of character rigs and animation clips. Study how each joint moves, one frame at a time.</p>
        <Link href="/dashboard" prefetch={false} className="primary">Open workspace <ArrowRightIcon size={19}/></Link></section>
      <figure className="viewer"><figcaption className="viewer-head"><span className="viewer-title">Red fox</span>
        <span className="fps">RUN CYCLE · 32 FRAMES</span></figcaption>
        <div className="stage" role="img" aria-label="Red fox character with its articulated joints">
          <i className="cross tr"/><i className="cross bl"/><i className="cross br"/><ArtCanvas study={fox} frame={5} rig/>
        </div></figure></div><StudyLinks/></main>
  </div>;
}
