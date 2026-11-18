import Link from "next/link";
import { CaretDoubleRightIcon } from "@phosphor-icons/react/dist/ssr/CaretDoubleRight";
export function Brand() {
  return <Link href="/" aria-label="Kinetix home" className="brand"><span className="mark"><CaretDoubleRightIcon size={32} weight="bold"/></span>Kinetix</Link>;
}
