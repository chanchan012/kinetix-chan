import { Playground } from "@/components/playground";
export default async function Home({searchParams}: {searchParams: Promise<{demo?:string;study?:string}>}) {
  const query = await searchParams;
  return <Playground initialDemo={query.demo === "1"} initialStudy={query.study}/>;
}
