import { NextResponse } from "next/server";

// TODO: sostituisci con la tua funzione/DB call reale
async function getReorderLog(id: string) {
  // esempio: carichi lo storico e ritorni quello che vuoi nel log
  // return await db.reorder_history.findUnique({ where: { id } });
  return { ok: true, id, message: "TODO: implement getReorderLog()" };
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const orderId = params.id;

  const data = await getReorderLog(orderId);

  const filename = `LOG_${orderId}.json`;

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
