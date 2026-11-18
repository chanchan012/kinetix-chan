import { Playground } from "@/components/playground";
export default async function Home({searchParams}: {searchParams: Promise<{demo?:string}>}) {
  return <Playground initialDemo={(await searchParams).demo === "1"}/>;
}
