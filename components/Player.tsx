"use client";

/**
 * In-browser preview: the same engine as the server renderer, drawn on a <canvas>.
 * Scrubbing just evaluates a different frame; there is no playback state to drift.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { drawFrame, evaluateFrame, frameToTimecode, FORMATS, type Film, type FormatId, type ImageResource } from "@/lib/engine";
import type { Asset } from "@/lib/studio/types";

export interface PlayerProps {
  film: Film;
  assets: Asset[];
  assetUrl: (assetId: string) => string;
  format?: FormatId;
  frame?: number;
  onFrame?: (f: number) => void;
  markers?: { frame: number; label: string }[];
}

const loadedFonts = new Set<string>();

export function Player({ film, assets, assetUrl, format = "16:9", frame: controlled, onFrame, markers = [] }: PlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [internal, setInternal] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [images, setImages] = useState<Map<string, ImageResource>>(new Map());
  const [fontsReady, setFontsReady] = useState(0);
  const frame = Math.max(0, Math.min(film.duration - 1, controlled ?? internal));
  const setFrame = (f: number) => {
    const clamped = Math.max(0, Math.min(film.duration - 1, Math.round(f)));
    setInternal(clamped);
    onFrame?.(clamped);
  };
  const { width, height } = FORMATS[format];
  const scale = format === "16:9" ? 0.5 : 0.5;

  // Images used by the program
  const usedAssets = useMemo(() => {
    const ids = new Set(film.layers.filter((l) => l.type === "image").map((l) => l.props.asset));
    return assets.filter((a) => ids.has(a.id));
  }, [film, assets]);
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      usedAssets.map(
        (a) =>
          new Promise<[string, ImageResource] | null>((resolve) => {
            const img = new Image();
            img.onload = () => resolve([a.id, { source: img, width: img.naturalWidth, height: img.naturalHeight }]);
            img.onerror = () => resolve(null);
            img.src = assetUrl(a.id);
          }),
      ),
    ).then((entries) => {
      if (!cancelled) setImages(new Map(entries.filter((e): e is [string, ImageResource] => !!e)));
    });
    return () => {
      cancelled = true;
    };
  }, [usedAssets, assetUrl]);

  // Fonts: bundled via @font-face, uploaded via FontFace.
  useEffect(() => {
    const uploads = assets.filter((a) => a.kind === "font" && a.confirmed && a.fontFamily);
    const jobs: Promise<unknown>[] = [];
    for (const a of uploads) {
      const key = `${a.id}:${a.fontFamily}`;
      if (loadedFonts.has(key)) continue;
      loadedFonts.add(key);
      const face = new FontFace(a.fontFamily!, `url(${assetUrl(a.id)})`);
      jobs.push(face.load().then((f) => document.fonts.add(f)).catch(() => undefined));
    }
    for (const fam of new Set([film.fonts.display, film.fonts.body, film.fonts.mono, "Inter"])) {
      for (const w of [400, 600, 700, 800]) jobs.push(document.fonts.load(`${w} 40px "${fam}"`).catch(() => undefined));
    }
    Promise.all(jobs).then(() => setFontsReady((n) => n + 1));
  }, [assets, film.fonts, assetUrl]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawFrame(ctx, evaluateFrame(film, frame, format), { images }, scale);
  }, [film, frame, format, images, scale, fontsReady]);

  // Playback: frame derived from wall-clock offset, never accumulated.
  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    const from = frame >= film.duration - 1 ? 0 : frame;
    let raf = 0;
    const tick = (now: number) => {
      const f = from + Math.floor(((now - start) / 1000) * film.fps);
      if (f >= film.duration) {
        setFrame(film.duration - 1);
        setPlaying(false);
        return;
      }
      setFrame(f);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const scrubRef = useRef<HTMLDivElement>(null);
  const scrubTo = (clientX: number) => {
    const r = scrubRef.current!.getBoundingClientRect();
    setFrame(((clientX - r.left) / r.width) * film.duration);
  };

  return (
    <div className={`player ${format === "9:16" ? "vertical" : ""}`}>
      <canvas ref={canvasRef} width={width * scale} height={height * scale} />
      <div className="player-controls">
        <button className="btn sm" onClick={() => setPlaying(!playing)}>
          {playing ? "❚❚" : "▶"}
        </button>
        <button className="btn sm" onClick={() => setFrame(frame - 1)} title="Previous frame">
          ‹
        </button>
        <button className="btn sm" onClick={() => setFrame(frame + 1)} title="Next frame">
          ›
        </button>
        <div
          ref={scrubRef}
          className="scrub"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            setPlaying(false);
            scrubTo(e.clientX);
          }}
          onPointerMove={(e) => e.buttons === 1 && scrubTo(e.clientX)}
        >
          <div className="scrub-track" />
          {film.beats.map((b) => (
            <div key={b.id} className="scrub-beat" style={{ left: `${(b.start / film.duration) * 100}%`, width: `${((b.end - b.start) / film.duration) * 100}%` }}>
              {format === "16:9" ? b.label : ""}
            </div>
          ))}
          {markers.map((m, i) => (
            <div key={i} className="scrub-flag" style={{ left: `${(m.frame / film.duration) * 100}%` }} title={m.label} />
          ))}
          <div className="scrub-head" style={{ left: `${(frame / film.duration) * 100}%` }} />
        </div>
        <span className="mono" style={{ minWidth: 120, textAlign: "right" }}>
          f{frame} · {frameToTimecode(frame, film.fps)}
        </span>
      </div>
    </div>
  );
}
