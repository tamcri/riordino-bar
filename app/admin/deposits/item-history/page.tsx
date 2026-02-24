import { Suspense } from "react";
import ItemHistoryClient from "./ItemHistoryClient";

export default function DepositItemHistoryPage() {
  return (
    <Suspense fallback={<div className="p-6">Caricamento...</div>}>
      <ItemHistoryClient />
    </Suspense>
  );
}
