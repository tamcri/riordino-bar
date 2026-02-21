"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onDetected: (rawValue: string) => void;
  /** Mostra il bottone torcia (best-effort: dipende da device/browser). */
  enableTorch?: boolean;
  /** Lista formati preferiti (BarcodeDetector ignora quelli non supportati). */
  formats?: string[];
};

// Scanner camera “zero dipendenze” (usa Web BarcodeDetector):
// - Pro: leggero, niente build/npm changes.
// - Contro: se BarcodeDetector non c’è, lo scanner non può funzionare (mostriamo fallback).

export default function BarcodeScannerModal({ open, onClose, onDetected, enableTorch = true, formats }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [starting, setStarting] = useState(false);

  const hasBarcodeDetector = useMemo(() => {
    return typeof window !== "undefined" && typeof (window as any).BarcodeDetector !== "undefined";
  }, []);

  async function stop() {
    try {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
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

    if (!hasBarcodeDetector) {
      setError("Scanner non supportato su questo browser. Usa Chrome (Android) o un lettore barcode fisico.");
      return;
    }
    if (!videoRef.current) return;

    setStarting(true);
    try {
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
          // alcuni frame possono dare errori sporadici
        } finally {
          (loop as any)._busy = false;
        }
      };

      rafRef.current = requestAnimationFrame(loop);
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
