import Link from "next/link";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowUpRight";
import { StackIcon } from "@phosphor-icons/react/dist/ssr/Stack";
import { studies } from "@/lib/studies";
import { ArtCanvas } from "./art-canvas";

export function StudyLinks({active}: {active?:string}) {
  return <section className="library" aria-label="Motion studies">
    <div className="library-head"><h2><StackIcon size={22}/> Motion studies</h2>
      <Link className="guide-link" href="/dashboard" prefetch={false}>Rig library <ArrowUpRightIcon/></Link></div>
    <div className="study-list">{studies.map(item =>
      <Link key={item.id} href={"/studio/studies/"+item.id} prefetch={false}
        className={"study"+(item.id===active ? " selected" : "")} aria-current={item.id===active ? "page" : undefined}>
        <span className="thumb" style={{backgroundColor:item.wash}}><ArtCanvas study={item} mini/></span>
        <span className="study-text"><strong>{item.name}</strong><small>{item.clip}</small></span>
        <span className="study-arrow"><ArrowUpRightIcon size={17}/></span>
      </Link>)}</div>
  </section>;
}
