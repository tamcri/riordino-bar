"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (rawValue: string) => void;
  enableTorch?: boolean;
  formats?: string[];
};

export default function BarcodeScannerModal({
  open,
  onClose,
  onDetected,
  enableTorch = true,
  formats,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  // ZXing stop "pulito"
  const zxingStopRef = useRef<null | (() => void)>(null);

  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [starting, setStarting] = useState(false);

  const hasBarcodeDetector = useMemo(() => {
    return typeof window !== "undefined" && typeof (window as any).BarcodeDetector !== "undefined";
  }, []);

  async function stop() {
    try {
      // stop loop BarcodeDetector
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      // stop ZXing
      if (zxingStopRef.current) {
        try {
          zxingStopRef.current();
        } catch {}
        zxingStopRef.current = null;
      }

      // stop stream
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) t.stop();
        streamRef.current = null;
      }

      setTorchOn(false);
    } catch {
      // ignore
    }
  }

  async function toggleTorch() {
    if (!enableTorch) return;
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks?.()[0];
    if (!track) return;

    try {
      // @ts-expect-error: advanced constraints (torch)
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn((v) => !v);
    } catch {
      setError("Torcia non supportata su questo dispositivo/browser.");
      window.setTimeout(() => setError(null), 2000);
    }
  }

  async function start() {
    setError(null);
    if (!videoRef.current) return;

    setStarting(true);

    try {
      // ✅ Camera stream (serve HTTPS o localhost)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;

      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();

      // ✅ 1) Se c’è BarcodeDetector, usa quello
      if (hasBarcodeDetector) {
        const Detector = (window as any).BarcodeDetector;
        const detector = new Detector(Array.isArray(formats) && formats.length ? { formats } : undefined);

        const loop = async () => {
          rafRef.current = requestAnimationFrame(loop);

          const v = videoRef.current;
          if (!v || v.readyState < 2) return;
          if ((loop as any)._busy) return;
          (loop as any)._busy = true;

          try {
            const barcodes = await detector.detect(v);
            const first = Array.isArray(barcodes) ? barcodes[0] : null;
            const raw = first?.rawValue ? String(first.rawValue) : "";
            if (raw) {
              await stop();
              onClose();
              onDetected(raw);
              return;
            }
          } catch {
            // ok
          } finally {
            (loop as any)._busy = false;
          }
        };

        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // ✅ 2) Fallback iOS: ZXing
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);

      const hints = new Map<any, any>();

      // (opzionale) forzare formati comuni per velocizzare un pelo
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
      ]);

      const reader: any = new BrowserMultiFormatReader(hints);

      // alcune versioni ritornano controls, altre no: gestiamo entrambi i casi
      let controls: any = null;

      try {
        controls = await reader.decodeFromVideoElement(video, (result: any) => {
          if (result) {
            const raw = String(result.getText?.() || result.text || "").trim();
            if (raw) {
              stop().then(() => {
                onClose();
                onDetected(raw);
              });
            }
          }
        });
      } catch {
        // se qualcosa va storto qui, ci penserà lo stop/reset
      }

      zxingStopRef.current = () => {
        try {
          if (controls?.stop) controls.stop();
        } catch {}
        try {
          if (reader?.reset) reader.reset();
        } catch {}
      };
    } catch (e: any) {
      setError(e?.message || "Permesso camera negato o non disponibile.");
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    start();
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      <div className="absolute inset-0">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
      </div>

      {/* mirino */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[86%] max-w-[520px] h-[220px] rounded-2xl border-2 border-white/80" />
        <div className="absolute left-1/2 top-[calc(50%+130px)] -translate-x-1/2 text-white/90 text-sm">
          Inquadra il barcode
        </div>
      </div>

      {/* top bar */}
      <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between">
        <button
          type="button"
          className="pointer-events-auto rounded-xl bg-white/90 px-4 py-2 text-sm"
          onClick={() => {
            stop();
            onClose();
          }}
        >
          Chiudi
        </button>

        {enableTorch && (
          <button
            type="button"
            className="pointer-events-auto rounded-xl bg-white/90 px-4 py-2 text-sm"
            onClick={toggleTorch}
            disabled={starting}
            title="Torcia (se supportata)"
          >
            {torchOn ? "Torcia ON" : "Torcia"}
          </button>
        )}
      </div>

      {starting && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/90 text-sm">Avvio camera…</div>
      )}
      {error && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-red-200 text-sm px-4 text-center">
          {error}
        </div>
      )}
    </div>
  );
}
