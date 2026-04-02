import OrdinePvDetailClient from "./OrdinePvDetailClient";

type PageProps = {
  params: {
    id: string;
  };
};

export default function Page({ params }: PageProps) {
  return <OrdinePvDetailClient orderId={params.id} />;
}