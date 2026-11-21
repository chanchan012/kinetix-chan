import type { Metadata } from "next";
import Link from "next/link";
import { SpritePlayer } from "./sprite-player";
import "./sprite-player.css";

export const metadata:Metadata={title:"Sprite player · Kinetix"};

export default function SpritePlayerPage() {
  return <main className="sprite-player-shell">
    <header>
      <Link href="/">Kinetix</Link><h1>Sprite player</h1>
      <nav className="sprite-player-importers" aria-label="Engine importers">
        <a href="/sprite-player/godot" download>Godot importer</a>
        <a href="/sprite-player/phaser" download>Phaser starter</a>
        <a href="/sprite-player/pixi" download>PixiJS starter</a>
      </nav>
    </header>
    <SpritePlayer/>
  </main>;
}
