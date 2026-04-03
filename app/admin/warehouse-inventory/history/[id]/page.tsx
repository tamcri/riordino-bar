import WarehouseInventoryHistoryDetailClient from "./WarehouseInventoryHistoryDetailClient";

type PageProps = {
  params: {
    id: string;
  };
};

export default function WarehouseInventoryHistoryDetailPage({ params }: PageProps) {
  const headerId = params.id;

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Dettaglio Inventario Magazzino</h1>
          <p className="mt-1 text-sm text-gray-600">
            Dettaglio righe dell&apos;inventario confermato del deposito centrale.
          </p>
        </div>

        <WarehouseInventoryHistoryDetailClient headerId={headerId} />
      </div>
    </main>
  );
}