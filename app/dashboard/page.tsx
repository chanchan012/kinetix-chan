import { RigLibrary } from "@/components/rig-library";
import { clerkEnabled } from "@/lib/config";
import "./library.css";
export const dynamic = "force-dynamic";
export default function Dashboard() {
  return <RigLibrary accounts={clerkEnabled()}/>;
}
