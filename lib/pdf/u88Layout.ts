// File: lib/pdf/u88Layout.ts

export const U88_DPI = 300;

/**
 * In pdf-lib le coordinate sono in "points":
 * 72 points = 1 inch.
 * Se l'immagine è a 300 DPI: points = pixels * 72 / 300
 */
export function pxToPt(px: number, dpi = U88_DPI) {
  return (px * 72) / dpi;
}

export type U88PageLayout = {
  pageIndex: number; // 0-based
  rows: number;
  rowHeightPx: number;

  // Y della prima riga (in px, rispetto al top dell'immagine)
  firstRowYPx: number;

  // X della colonna KG/GR/IMPORTO per colonna sinistra/destra (in px da sinistra)
  left: { kgXPx: number; grXPx: number; impXPx: number; };
  right: { kgXPx: number; grXPx: number; impXPx: number; };

  // X dove inizia la colonna destra (solo per debug / lettura mentale)
  splitXPx: number;

  // altezza immagine in px (serve per convertire top->pdf y)
  imageHeightPx: number;
};

/**
 * Pagine 2..13 del cartaceo = 12 pagine.
 * Se nel tuo PNG sono tutte "in colonna" (lunghissimo), NON usiamo questo:
 * noi useremo il PDF (o un PNG per pagina) come sfondo per ogni pagina.
 *
 * Quindi: qui layout per UNA pagina standard (2 colonne x 61 righe).
 * Lo duplichiamo per pageIndex 1..12 (se pageIndex 0 è copertina).
 */
export const DEFAULT_PAGE_LAYOUT: Omit<U88PageLayout, "pageIndex"> = {
  rows: 61,

  // 🔧 DA TARARE (in px @300dpi)
  rowHeightPx: 38,       // altezza riga (esempio)
  firstRowYPx: 520,      // y della prima riga utile (sotto intestazione)

  // 🔧 DA TARARE: x delle colonne (in px @300dpi)
  left: {
    kgXPx: 250,
    grXPx: 340,
    impXPx: 430,
  },
  right: {
    kgXPx: 1330,
    grXPx: 1420,
    impXPx: 1510,
  },

  splitXPx: 1100,

  // 🔧 DA TARARE: altezza della singola pagina immagine (in px @300dpi)
  imageHeightPx: 3508, // A4 @300dpi ~ 2480x3508 (portrait)
};

/**
 * Genera il layout per N pagine uguali
 */
export function buildLayouts(pageCount: number, startPageIndex: number) {
  const out: U88PageLayout[] = [];
  for (let i = 0; i < pageCount; i++) {
    out.push({
      pageIndex: startPageIndex + i,
      ...DEFAULT_PAGE_LAYOUT,
    });
  }
  return out;
}
