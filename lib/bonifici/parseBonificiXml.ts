import { XMLParser } from "fast-xml-parser";

export type BonificoRicevuta = {
  nome: string;
  importo: number;
  valuta: string;
  dataAccredito: string;
  causale: string;
  stato: string;
  statoOriginale: string;
  riferimento: string;
  azienda: string;
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function mapStato(stato: string) {
  switch (stato) {
    case "ACSC":
      return "ESEGUITO";
    case "RJCT":
      return "RIFIUTATO";
    case "PDNG":
      return "IN ELABORAZIONE";
    default:
      return stato || "NON DISPONIBILE";
  }
}

export function parseBonificiXml(xml: string): BonificoRicevuta[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });

  const parsed = parser.parse(xml);

  const ricevute: BonificoRicevuta[] = [];

  const statusRoot =
  parsed?.CBIDbtrPmtStatusReport ||
  parsed?.CBIBdyDbtrPmtStatusReport?.CBIEnvelDbtrPmtStatusReport?.CBIDbtrPmtStatusReport;

const paymentRoot = parsed?.CBIPaymentRequest;

  if (statusRoot) {
    const gruppiPagamento = asArray(statusRoot?.OrgnlPmtInfAndSts);

    for (const gruppo of gruppiPagamento) {
      const transazioni = asArray(gruppo?.TxInfAndSts);

      for (const tx of transazioni) {
        const ref = tx?.OrgnlTxRef;

        const nome = text(ref?.Cdtr?.Nm);
        const importo = Number(text(ref?.Amt?.["#text"] ?? ref?.Amt));
        const valuta = text(ref?.Amt?.Ccy) || "EUR";
        const dataAccredito =
          text(tx?.OrdValDt) ||
          text(ref?.ReqdExctnDt?.Dt) ||
          text(tx?.AccptncDtTm);

        const causale = text(ref?.RmtInf?.Ustrd);
        const statoOriginale = text(tx?.TxSts);
        const riferimento = text(tx?.StsId || tx?.AcctSvcrRef || tx?.OrgnlEndToEndId);
        const azienda = text(ref?.Dbtr?.Nm || statusRoot?.GrpHdr?.InitgPty?.Nm);

        if (!nome || !Number.isFinite(importo) || !dataAccredito) {
          continue;
        }

        ricevute.push({
          nome,
          importo,
          valuta,
          dataAccredito,
          causale,
          stato: mapStato(statoOriginale),
          statoOriginale,
          riferimento,
          azienda,
        });
      }
    }
  }

  if (paymentRoot) {
    const gruppiPagamento = asArray(paymentRoot?.PmtInf);

    for (const gruppo of gruppiPagamento) {
      const transazioni = asArray(gruppo?.CdtTrfTxInf);

      for (const tx of transazioni) {
        const nome = text(tx?.Cdtr?.Nm);
        const importo = Number(text(tx?.Amt?.InstdAmt?.["#text"] ?? tx?.Amt?.InstdAmt));
        const valuta = text(tx?.Amt?.InstdAmt?.Ccy) || "EUR";
        const dataAccredito = text(gruppo?.ReqdExctnDt?.Dt);
        const causale = text(tx?.RmtInf?.Ustrd);
        const riferimento = text(tx?.CdtrAcct?.Id?.IBAN || tx?.PmtId?.EndToEndId || tx?.PmtId?.InstrId);
        const azienda = text(gruppo?.Dbtr?.Nm || paymentRoot?.GrpHdr?.InitgPty?.Nm);

        if (!nome || !Number.isFinite(importo) || !dataAccredito) {
          continue;
        }

        ricevute.push({
          nome,
          importo,
          valuta,
          dataAccredito,
          causale,
          stato: "ESEGUITO",
          statoOriginale: "CBIPaymentRequest",
          riferimento,
          azienda,
        });
      }
    }
  }

  if (ricevute.length === 0) {
    throw new Error("Nessun bonifico valido trovato nel file XML.");
  }

  return ricevute;
}