import { notFound } from "next/navigation";
import { SongEditScreen } from "@/components/master/song-edit-screen";

export default async function SongEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const songId = Number(id);
  if (!Number.isInteger(songId) || songId <= 0) notFound();
  return <SongEditScreen songId={songId} />;
}
