import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { StudyPlayer } from "@/components/playground";
import { studies } from "@/lib/studies";

export default async function StudyPage({ params }: PageProps<"/studio/studies/[id]">) {
  await auth.protect();
  const { id } = await params;
  const study = studies.find(item => item.id === id);
  if (!study) notFound();
  return <StudyPlayer key={study.id} study={study}/>;
}
