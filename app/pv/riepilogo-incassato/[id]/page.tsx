import RiepilogoIncassatoDetailClient from "./RiepilogoIncassatoDetailClient";

export default function RiepilogoIncassatoDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <RiepilogoIncassatoDetailClient id={params.id} />;
}