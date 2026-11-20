import type { Metadata } from "next";
import Link from "next/link";
import { SpritePlayer } from "./sprite-player";
import "./sprite-player.css";

export const metadata:Metadata={title:"Sprite player · Kinetix"};

export default function SpritePlayerPage() {
  return <main className="sprite-player-shell">
    <header><Link href="/">Kinetix</Link><h1>Sprite player</h1></header>
    <SpritePlayer/>
  </main>;
}
