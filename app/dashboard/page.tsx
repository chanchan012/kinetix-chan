import { auth } from "@clerk/nextjs/server";
import { RigLibrary } from "@/components/rig-library";
import "./library.css";

export default async function Dashboard() {
  await auth.protect();
  return <RigLibrary/>;
}
