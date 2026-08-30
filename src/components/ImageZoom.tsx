"use client";

import React, { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { CachedImage } from '@/components/CachedImage';

export function normalizeImageList(raw: unknown): string[] {
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  if (!Array.isArray(raw)) return [];
  return raw.map(v => String(v ?? '').trim()).filter(Boolean).slice(0, 12);
}

/** Миниатюры как в режиме чтения вопросов: тап открывает зум. */
export function ReadingImages({
  images,
  onZoom,
}: {
  images?: string[];
  onZoom: (list: string[], idx: number) => void;
}) {
  if (!images?.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {images.map((img, i) => (
        <div
          key={`${img}-${i}`}
          className="img-protected-wrapper rounded-2xl overflow-hidden cursor-pointer relative"
          style={{ border: '1px solid var(--c-border)' }}
          onClick={() => onZoom(images, i)}
          onContextMenu={e => e.preventDefault()}
        >
          <CachedImage
            src={img}
            alt=""
            className="w-full h-auto object-contain max-h-80"
            loading="lazy"
            draggable={false}
          />
          <div className="absolute inset-0" style={{ WebkitTouchCallout: 'none' }} />
        </div>
      ))}
    </div>
  );
}

export function useImageZoom() {
  const [zoomList, setZoomList] = useState<string[]>([]);
  const [zoomIdx, setZoomIdx] = useState(0);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const zoomImgRef = useRef<HTMLImageElement | null>(null);

  const openZoom = (list: string[], idx = 0) => {
    setZoomList(list);
    setZoomIdx(idx);
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  const closeZoom = () => {
    setZoomList([]);
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  const clampZoom = (t: { x: number; y: number }, s: number) => {
    const img = zoomImgRef.current;
    if (!img) return t;
    const maxX = Math.max(0, ((s - 1) * img.clientWidth) / 2);
    const maxY = Math.max(0, ((s - 1) * img.clientHeight) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, t.x)),
      y: Math.max(-maxY, Math.min(maxY, t.y)),
    };
  };

  const overlay = zoomList.length > 0 ? (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{
        background: 'hsl(0 0% 0% / 0.92)',
        backdropFilter: 'blur(8px)',
        touchAction: 'none',
        overscrollBehavior: 'contain',
      }}
      onClick={e => { e.stopPropagation(); closeZoom(); }}
      onWheel={e => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.25 : 0.25;
        const newScale = Math.min(5, Math.max(1, scale + delta));
        const img = zoomImgRef.current;
        if (!img) { setScale(newScale); return; }
        const rect = img.getBoundingClientRect();
        const dx = e.clientX - (rect.left + rect.width / 2);
        const dy = e.clientY - (rect.top + rect.height / 2);
        const r = newScale / scale;
        const newT = { x: translate.x + dx * (1 - r), y: translate.y + dy * (1 - r) };
        setScale(newScale);
        setTranslate(clampZoom(newT, newScale));
      }}
      onTouchStart={e => {
        if (e.touches.length === 2) {
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          const cx = (t1.clientX + t2.clientX) / 2;
          const cy = (t1.clientY + t2.clientY) / 2;
          const img = zoomImgRef.current;
          const rect = img?.getBoundingClientRect();
          (e.currentTarget as HTMLElement & { __ps?: unknown }).__ps = {
            dist: Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY),
            scale,
            translate,
            ix: rect ? cx - (rect.left + rect.width / 2) : 0,
            iy: rect ? cy - (rect.top + rect.height / 2) : 0,
          };
        } else if (e.touches.length === 1 && scale > 1) {
          (e.currentTarget as HTMLElement & { __pan?: unknown }).__pan = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
            translate,
          };
        } else if (e.touches.length === 1 && scale === 1 && zoomList.length > 1) {
          (e.currentTarget as HTMLElement & { __swipe?: unknown }).__swipe = {
            x: e.touches[0].clientX,
          };
        }
      }}
      onTouchMove={e => {
        const target = e.currentTarget as HTMLElement & {
          __ps?: { dist: number; scale: number; translate: { x: number; y: number }; ix: number; iy: number };
          __pan?: { x: number; y: number; translate: { x: number; y: number } };
        };
        if (e.touches.length === 2 && target.__ps) {
          e.preventDefault();
          const ps = target.__ps;
          const ns = Math.min(5, Math.max(1, ps.scale * Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY,
          ) / ps.dist));
          const r = ns / ps.scale;
          setScale(ns);
          setTranslate(clampZoom({
            x: ps.translate.x + ps.ix * (1 - r),
            y: ps.translate.y + ps.iy * (1 - r),
          }, ns));
        } else if (e.touches.length === 1 && target.__pan && scale > 1) {
          e.preventDefault();
          const p = target.__pan;
          setTranslate(clampZoom({
            x: p.translate.x + e.touches[0].clientX - p.x,
            y: p.translate.y + e.touches[0].clientY - p.y,
          }, scale));
        }
      }}
      onTouchEnd={e => {
        const t = e.currentTarget as HTMLElement & { __swipe?: { x: number }; __ps?: unknown; __pan?: unknown };
        if (t.__swipe) {
          const dx = e.changedTouches[0].clientX - t.__swipe.x;
          if (Math.abs(dx) > 50) {
            if (dx < 0) setZoomIdx(i => Math.min(zoomList.length - 1, i + 1));
            else setZoomIdx(i => Math.max(0, i - 1));
          }
        }
        delete t.__ps;
        delete t.__pan;
        delete t.__swipe;
      }}
    >
      <div
        className="img-protected-wrapper flex items-center justify-center"
        onClick={e => e.stopPropagation()}
        onContextMenu={e => e.preventDefault()}
      >
        <CachedImage
          ref={zoomImgRef}
          src={zoomList[zoomIdx]}
          alt=""
          className="object-contain rounded-2xl select-none"
          style={{
            maxWidth: '95vw',
            maxHeight: '85vh',
            transform: `translate3d(${translate.x}px, ${translate.y}px, 0) scale(${scale})`,
            transformOrigin: 'center center',
            transition: 'transform 0.12s ease-out',
            touchAction: 'none',
            willChange: 'transform',
            userSelect: 'none',
          }}
          draggable={false}
          onDoubleClick={() => {
            if (scale > 1) {
              setScale(1);
              setTranslate({ x: 0, y: 0 });
            } else {
              setScale(2.5);
            }
          }}
        />
      </div>

      {scale > 1 && (
        <div
          className="fixed top-4 left-4 z-[201] px-3 py-1.5 rounded-full text-[11px] font-bold tabular-nums pointer-events-none"
          style={{
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.15)',
          }}
        >
          {scale.toFixed(1)}×
        </div>
      )}

      <div
        className="fixed left-0 right-0 flex flex-col items-center gap-3 z-[201]"
        style={{ bottom: 'calc(var(--nav-bottom, 12px) + 16px)' }}
        onClick={e => e.stopPropagation()}
      >
        {zoomList.length > 1 && (
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{
              background: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.15)',
            }}
          >
            {zoomList.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { setZoomIdx(i); setScale(1); setTranslate({ x: 0, y: 0 }); }}
                className="rounded-full transition-all duration-200"
                style={{
                  width: i === zoomIdx ? 18 : 7,
                  height: 7,
                  background: i === zoomIdx ? '#fff' : 'rgba(255,255,255,0.4)',
                }}
                aria-label={`Картинка ${i + 1}`}
              />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); closeZoom(); }}
          className="flex items-center gap-2 px-6 h-11 rounded-full text-sm font-semibold transition-all active:scale-95 shadow-2xl"
          style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }}
        >
          <X className="w-4 h-4" /> Закрыть
        </button>
      </div>
    </div>
  ) : null;

  return { openZoom, overlay };
}
