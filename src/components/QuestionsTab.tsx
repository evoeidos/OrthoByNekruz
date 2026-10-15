"use client";

import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { SubjectType } from '@/components/SubjectSelectScreen';
import { getSubject, APP_BRAND_NAME, subjectHasQuestionGameModes } from '@/lib/subjects';
import { loadSubjectData } from '@/lib/subjectData';
import { CachedImage } from '@/components/CachedImage';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, BookOpen, CheckCircle2, Circle, X, ArrowLeft, ArrowRight } from 'lucide-react';
import { PersonalNoteCard } from '@/components/PersonalNoteCard';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger
} from '@/components/ui/accordion';
import { AppBrandIcon } from './AppBrandIcon';
import { QuestionAiPanel } from './QuestionAiPanel';
import { FlashcardsTab } from './FlashcardsTab';
import { TrueFalseTab } from './TrueFalseTab';
import type { BioGameMode } from './Navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { termRegexSource as _termRegexSource, itemRelatedTerms, filterValidGlossary, glossaryForRelatedTerms, isSectionHeaderLabel } from '@/lib/glossaryUtils';

interface GlossaryItem { term: string; variations?: string[]; definition: string; image?: string | string[]; }

const _AUDIO_CACHE = 'ortho-audio-v1';
const _AUDIO_SPEEDS = [0.75, 1, 1.25, 1.5, 2];
let _activeAudio: HTMLAudioElement | null = null;

const AudioPlayer = ({ src, accentColor }: { src: string; accentColor: string }) => {
  const audioRef          = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying]       = useState(false);
  const [current, setCurrent]       = useState(0);
  const [duration, setDuration]     = useState(0);
  const [loading, setLoading]       = useState(true);
  const [speed, setSpeed]           = useState(1);
  const [cached, setCached]         = useState(false);
  const [caching, setCaching]       = useState(false);
  const [cacheProgress, setCacheProgress] = useState(0);
  const [blobUrl, setBlobUrl]       = useState<string | null>(null);
  const posKey = `audio-pos:${src}`;

  useEffect(() => {
    (async () => {
      try {
        const cache = await caches.open(_AUDIO_CACHE);
        const hit   = await cache.match(src);
        if (hit) {
          const blob = await hit.blob();
          const url  = URL.createObjectURL(blob);
          setBlobUrl(url);
          setCached(true);
        }
      } catch {}
    })();
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [src]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !blobUrl) return;
    const wasPlaying = !a.paused;
    const t = a.currentTime;
    a.src = blobUrl;
    a.load();
    a.currentTime = t;
    if (wasPlaying) a.play().catch(() => {});
  }, [blobUrl]);

  const fmt = (s: number) => {
    if (!isFinite(s) || isNaN(s)) return '0:00';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
    } else {
      if (_activeAudio && _activeAudio !== a) _activeAudio.pause();
      _activeAudio = a;
      a.play().catch(() => {});
    }
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Number(e.target.value);
    setCurrent(Number(e.target.value));
  };

  const skip = (sec: number) => {
    const a = audioRef.current;
    if (!a) return;
    const next = Math.max(0, Math.min(a.duration, a.currentTime + sec));
    a.currentTime = next;
    setCurrent(next);
  };

  const cycleSpeed = () => {
    const a = audioRef.current;
    const next = _AUDIO_SPEEDS[(_AUDIO_SPEEDS.indexOf(speed) + 1) % _AUDIO_SPEEDS.length];
    setSpeed(next);
    if (a) a.playbackRate = next;
  };

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const t = (e.target as HTMLAudioElement).currentTime;
    setCurrent(t);
    if (Math.round(t) % 5 === 0) {
      try { localStorage.setItem(posKey, String(t)); } catch {}
    }
  };

  const handleLoaded = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const a = e.target as HTMLAudioElement;
    setDuration(a.duration);
    setLoading(false);
    try {
      const saved = parseFloat(localStorage.getItem(posKey) || '0');
      if (saved > 0 && saved < a.duration - 3) { a.currentTime = saved; setCurrent(saved); }
    } catch {}
  };

  const getMime = (url: string) => {
    if (url.includes('.m4a')) return 'audio/mp4';
    if (url.includes('.ogg')) return 'audio/ogg';
    if (url.includes('.wav')) return 'audio/wav';
    return 'audio/mpeg';
  };

  const cacheAudio = async () => {
    if (cached || caching) return;
    setCaching(true); setCacheProgress(0);
    try {
      const resp   = await fetch(src);
      const total  = Number(resp.headers.get('content-length') || 0);
      const reader = resp.body!.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); received += value.length;
        if (total) setCacheProgress(Math.round((received / total) * 100));
      }
      const mime  = getMime(src);
      const blob  = new Blob(chunks as unknown as BlobPart[], { type: mime });
      const url   = URL.createObjectURL(blob);
      const cache = await caches.open(_AUDIO_CACHE);
      await cache.put(src, new Response(blob, { headers: { 'Content-Type': mime } }));
      setBlobUrl(url); setCached(true);
    } catch {}
    setCaching(false);
  };

  const pct = duration ? (current / duration) * 100 : 0;

  return (
    <div className="mt-3 rounded-2xl overflow-hidden"
      style={{ border: `1.5px solid color-mix(in srgb, ${accentColor} 30%, transparent)`, background: `color-mix(in srgb, ${accentColor} 6%, var(--c-card))` }}>

      <audio ref={audioRef} preload="metadata"
        onLoadedMetadata={handleLoaded}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); if (_activeAudio === audioRef.current) _activeAudio = null; try { localStorage.removeItem(posKey); } catch {} }}
        onWaiting={() => setLoading(true)}
        onCanPlay={() => setLoading(false)}>
        <source src={blobUrl || src} type={getMime(src)} />
      </audio>

      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-base">🎧</span>
          <span className="text-[10px] font-black uppercase tracking-widest"
            style={{ color: accentColor }}>Audio</span>
          {cached && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: `color-mix(in srgb, ${accentColor} 15%, transparent)`, color: accentColor }}>
              ✓ кэш
            </span>
          )}
        </div>
        <span className="text-[11px] font-mono font-semibold tabular-nums"
          style={{ color: 'var(--c-muted)' }}>
          {fmt(current)} / {fmt(duration)}
        </span>
      </div>

      <div className="px-3 pb-2">
        <div className="relative h-2 rounded-full" style={{ background: 'var(--c-border)' }}>
          <div className="absolute left-0 top-0 h-full rounded-full transition-all duration-100"
            style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${accentColor}, color-mix(in srgb, ${accentColor} 70%, #fff))` }} />
          {duration > 0 && (
            <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full shadow-md pointer-events-none"
              style={{ left: `calc(${pct}% - 6px)`, background: '#fff', border: `2px solid ${accentColor}` }} />
          )}
          <input type="range" min={0} max={duration || 100} step={0.5} value={current}
            onChange={seek}
            className="absolute inset-0 w-full opacity-0 h-full cursor-pointer"
            style={{ touchAction: 'none' }} />
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 pb-3">
        <button onClick={toggle} disabled={loading}
          className="w-11 h-11 rounded-2xl flex-shrink-0 flex items-center justify-center transition-all active:scale-90 shadow-md"
          style={{
            background: loading ? 'var(--c-border)' : accentColor,
            color: '#fff',
            border: `1.5px solid color-mix(in srgb, ${accentColor} 60%, #000 40%)`,
          }}>
          {loading ? (
            <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          ) : playing ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" rx="1.5"/><rect x="14" y="4" width="4" height="16" rx="1.5"/>
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5.14v14l11-7-11-7z"/>
            </svg>
          )}
        </button>

        <button onClick={() => skip(-10)} disabled={loading}
          className="flex-1 h-11 rounded-2xl flex items-center justify-center gap-1.5 text-[11px] font-bold transition-all active:scale-95"
          style={{ background: 'var(--c-card)', color: loading ? 'var(--c-border)' : 'var(--c-text)', border: '1.5px solid var(--c-border)' }}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.85"/>
          </svg>
          10с
        </button>

        <button onClick={() => skip(10)} disabled={loading}
          className="flex-1 h-11 rounded-2xl flex items-center justify-center gap-1.5 text-[11px] font-bold transition-all active:scale-95"
          style={{ background: 'var(--c-card)', color: loading ? 'var(--c-border)' : 'var(--c-text)', border: '1.5px solid var(--c-border)' }}>
          10с
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-3.85"/>
          </svg>
        </button>

        <button onClick={cycleSpeed}
          className="h-11 px-3 rounded-2xl flex items-center justify-center gap-1 text-[12px] font-black transition-all active:scale-95 flex-shrink-0"
          style={{
            background: `color-mix(in srgb, ${accentColor} 12%, var(--c-card))`,
            color: accentColor,
            border: `1.5px solid color-mix(in srgb, ${accentColor} 35%, transparent)`,
            minWidth: '52px',
          }}>
          {speed}×
        </button>

        <button onClick={cacheAudio} disabled={cached || caching}
          className="h-11 px-3 rounded-2xl flex items-center justify-center gap-1.5 text-[11px] font-bold transition-all active:scale-95 flex-shrink-0"
          style={cached
            ? { background: `color-mix(in srgb, ${accentColor} 12%, var(--c-card))`, color: accentColor, border: `1.5px solid color-mix(in srgb, ${accentColor} 35%, transparent)` }
            : { background: 'var(--c-card)', color: 'var(--c-muted)', border: '1.5px solid var(--c-border)' }}>
          {caching ? (
            <>
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              {cacheProgress > 0 ? `${cacheProgress}%` : '…'}
            </>
          ) : cached ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
          )}
        </button>
      </div>

      {caching && (
        <div className="h-0.5 mx-3 mb-3 rounded-full overflow-hidden" style={{ background: 'var(--c-border)' }}>
          <div className="h-full rounded-full transition-all duration-200"
            style={{ width: `${cacheProgress}%`, background: accentColor }} />
        </div>
      )}
    </div>
  );
};

const GlossaryImages: React.FC<{ images: string[]; onZoom: (list: string[], idx: number) => void }> = ({ images, onZoom }) => {
  const [idx, setIdx] = useState(0);
  const startX = React.useRef(0);
  const moved  = React.useRef(false);

  if (!images.length) return null;
  const safeIdx = Math.min(idx, images.length - 1);
  const cur = images[safeIdx];
  const single = images.length === 1;

  return (
    <div className="mb-2">
      <div
        className="img-protected-wrapper rounded-xl overflow-hidden cursor-pointer relative"
        style={{ border: '1px solid var(--c-border)' }}
        onContextMenu={e => e.preventDefault()}
        onTouchStart={e => { e.stopPropagation(); startX.current = e.touches[0].clientX; moved.current = false; }}
        onTouchMove={e => { if (Math.abs(e.touches[0].clientX - startX.current) > 10) moved.current = true; }}
        onTouchEnd={e => {
          const dx = e.changedTouches[0].clientX - startX.current;
          if (Math.abs(dx) > 40) {
            e.preventDefault();
            if (dx < 0) setIdx(i => Math.min(images.length - 1, i + 1));
            else        setIdx(i => Math.max(0, i - 1));
          }
        }}
        onClick={e => {
          e.stopPropagation();              
          if (!moved.current) onZoom(images, safeIdx);  
        }}
      >
        <CachedImage src={cur} alt="" className="w-full h-auto object-contain max-h-32" loading="lazy" draggable={false} />
      </div>
      {!single && (
        <div className="flex justify-center items-center gap-1.5 mt-1.5">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={e => { e.stopPropagation(); setIdx(i); }}
              className="rounded-full transition-all duration-200"
              style={{
                width: i === safeIdx ? 16 : 6,
                height: 6,
                background: i === safeIdx ? 'var(--c-primary)' : 'var(--c-border)',
              }}
              aria-label={`Картинка ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};


export const QuestionsTab = ({
  onSecretTap,
  subject = 'ortho',
  bustDataCache = false,
  bioSection: bioSectionProp,
  onBioSectionChange,
}: {
  onSecretTap?: () => void;
  subject?: SubjectType;
  bustDataCache?: boolean;
  bioSection?: BioGameMode;
  onBioSectionChange?: (section: BioGameMode) => void;
}) => {
  const cfg         = getSubject(subject);
  const accentColor = cfg?.color || 'var(--c-primary)';
  const gameModes   = subjectHasQuestionGameModes(subject);
  const lsKey       = subject === 'ortho' ? 'studiedQuestions'  : `${cfg?.lsPrefix || subject}_studiedQuestions`;
  const lsNoteKey   = subject === 'ortho' ? 'userQuestionNotes' : `${cfg?.lsPrefix || subject}_userQuestionNotes`;
  const [loadedQuestionsData, setLoadedQuestionsData] = useState<any[]>([]);
  const [microLoading,        setMicroLoading]        = useState(false);
  const questionsData = loadedQuestionsData;

  const [dynamicGlossary, setDynamicGlossary] = useState<GlossaryItem[]>([]);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unstudied' | 'audio'>('all');
  const [openAccordionId, setOpenAccordionId] = useState<string>('');
  const [studiedIds, setStudiedIds] = useState<Set<number>>(new Set());
  const [userNotes, setUserNotes] = useState<Record<number, string>>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const [readingQuestion, setReadingQuestion] = useState<any | null>(null);
  const readingScrollRef = useRef<HTMLDivElement>(null);
  const [bioSectionLocal, setBioSectionLocal] = useState<BioGameMode>('list');
  const bioSection = bioSectionProp ?? bioSectionLocal;
  const setBioSection = onBioSectionChange ?? setBioSectionLocal;

  const [termDefStack, setTermDefStack] = useState<string[]>([]);
  const activeTermKey = termDefStack.length > 0 ? termDefStack[termDefStack.length - 1] : null;

  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [fontSize, setFontSize] = useState(16);
  
  const [zoomList, setZoomList] = useState<string[]>([]);
  const [zoomIdx,  setZoomIdx]  = useState(0);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const zoomImgRef = useRef<HTMLImageElement | null>(null);

  const openZoom = (list: string[], idx = 0) => {
    setZoomList(list); setZoomIdx(idx);
    setScale(1); setTranslate({ x: 0, y: 0 });
  };

  const clampZoom = (t: {x: number; y: number}, s: number) => {
    const img = zoomImgRef.current;
    if (!img) return t;
    const maxX = Math.max(0, ((s - 1) * img.clientWidth) / 2);
    const maxY = Math.max(0, ((s - 1) * img.clientHeight) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, t.x)),
      y: Math.max(-maxY, Math.min(maxY, t.y)),
    };
  };

  const closeZoom = () => { setZoomList([]); setScale(1); setTranslate({ x: 0, y: 0 }); };

  const initialDistance = useRef<number | null>(null);
  const initialFontSize = useRef(16);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const tooltipStartPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (bioSectionProp === undefined) setBioSectionLocal('list');
  }, [subject, bioSectionProp]);

  useEffect(() => {
    try { setStudiedIds(new Set(JSON.parse(localStorage.getItem(lsKey) || '[]'))); } catch {}
    try { setUserNotes(JSON.parse(localStorage.getItem(lsNoteKey) || '{}')); } catch {}
    setIsLoaded(true);
  }, [subject, lsKey, lsNoteKey]);

  useEffect(() => {
    let cancelled = false;
    setMicroLoading(true);
    setLoadedQuestionsData([]);
    loadSubjectData(subject, 'questions', { bustCache: bustDataCache })
      .then(d => { if (!cancelled) setLoadedQuestionsData(d as any[]); })
      .finally(() => { if (!cancelled) setMicroLoading(false); });
    return () => { cancelled = true; };
  }, [subject, bustDataCache]);

  useEffect(() => {
    let cancelled = false;
    loadSubjectData(subject, 'glossary', { bustCache: bustDataCache })
      .then(d => { if (!cancelled) setDynamicGlossary(filterValidGlossary(d as GlossaryItem[])); });
    return () => { cancelled = true; };
  }, [subject, bustDataCache]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem(lsKey, JSON.stringify(Array.from(studiedIds)));
    localStorage.setItem(lsNoteKey, JSON.stringify(userNotes));
  }, [studiedIds, userNotes, isLoaded]);

  const toggleStudied = (id: number) => {
    setStudiedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const updateNote = (id: number, text: string) => setUserNotes(p => ({ ...p, [id]: text.replace(/<[^>]*>?/gm, '') }));
  const clearNote  = (id: number) => setUserNotes(p => { const n = { ...p }; delete n[id]; return n; });

  const filtered = useMemo(() => {
    const t = search.toLowerCase();
    return questionsData.filter(q => {
      const matchSearch = !search || q.id.toString() === t || q.question.toLowerCase().includes(t);
      const matchFilter =
        filter === 'all'      ? true :
        filter === 'unstudied' ? !studiedIds.has(q.id) :
        filter === 'audio'    ? !!(q as any).audio :
        true;
      return matchSearch && matchFilter;
    });
  }, [search, filter, questionsData, studiedIds]);

  const progress = useMemo(() => questionsData.length ? (studiedIds.size / questionsData.length) * 100 : 0, [studiedIds, questionsData]);

  const glossaryTerms = useMemo(() => {
    return [...dynamicGlossary].sort((a, b) => b.term.length - a.term.length);
  }, [dynamicGlossary]);

 const [tooltipTarget, setTooltipTarget] = useState<{
    top: number; bottom: number; left: number; right: number; width: number;
  } | null>(null);

  // ДОБАВЛЯЕМ ЭТОТ REF: он будет хранить последнее кликнутое слово из текста
  const lastTargetRef = useRef<any>(null);

  // ОБНОВЛЕННЫЙ БЛОК РАСЧЕТА ПОЗИЦИИ
  useLayoutEffect(() => {
    if (!activeTermKey || !tooltipTarget || !tooltipRef.current) return;
    const popup = tooltipRef.current.getBoundingClientRect();
    
    const GAP = 12; 
    const PAD = 10;
    const vw  = window.innerWidth;
    const vh  = window.innerHeight;

    // Сценарий 1: Мы кликнули на НОВОЕ слово в тексте
    if (tooltipTarget !== lastTargetRef.current) {
      let y = tooltipTarget.top - popup.height - GAP;
      
      if (y < PAD) {
        y = tooltipTarget.bottom + GAP;
        if (y + popup.height > vh - PAD) {
          y = Math.max(PAD, vh - popup.height - PAD);
        }
      }

      const x = Math.max(PAD, Math.min(tooltipTarget.left, vw - popup.width - PAD));
      
      setTooltipPos({ x, y });
      lastTargetRef.current = tooltipTarget; // Запоминаем текущую цель
    } 
    // Сценарий 2: Мы навигируемся внутри (вложенный термин или кнопка "Назад")
    else {
      // Тултип остается на том месте, куда его перетащили. 
      // Мы только корректируем координаты, если контент стал больше и вылез за край экрана.
      setTooltipPos(prev => ({
        x: Math.max(PAD, Math.min(prev.x, vw - popup.width - PAD)),
        y: Math.max(PAD, Math.min(prev.y, vh - popup.height - PAD))
      }));
    }
  }, [activeTermKey, tooltipTarget]);
  
  useEffect(() => {
    if (termDefStack.length === 0) return;
    const h = () => { if (zoomList.length > 0) return; setTermDefStack([]); };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [termDefStack, zoomList]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      initialDistance.current = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      initialFontSize.current = fontSize;
    }
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialDistance.current !== null) {
      e.preventDefault();
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      setFontSize(Math.max(12, Math.min(28, Math.round(initialFontSize.current * d / initialDistance.current))));
    }
  };
  const handleTouchEnd = (e: React.TouchEvent) => { if (e.touches.length < 2) initialDistance.current = null; };

  const handleTooltipMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation(); setDragging(true);
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    tooltipStartPos.current = { x: tooltipPos.x, y: tooltipPos.y };
  };
  const handleTooltipTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation(); const t = e.touches[0]; setDragging(true);
    dragStartPos.current = { x: t.clientX, y: t.clientY };
    tooltipStartPos.current = { x: tooltipPos.x, y: tooltipPos.y };
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent | TouchEvent) => {
      const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const rect = tooltipRef.current?.getBoundingClientRect();
      setTooltipPos({
        x: Math.max(10, Math.min(tooltipStartPos.current.x + cx - dragStartPos.current.x, window.innerWidth  - (rect?.width  || 200) - 10)),
        y: Math.max(10, Math.min(tooltipStartPos.current.y + cy - dragStartPos.current.y, window.innerHeight - (rect?.height || 100) - 10)),
      });
    };
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move as any, { passive: false }); window.addEventListener('touchend', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', move as any); window.removeEventListener('touchend', up); };
  }, [dragging]);


const renderWithGlossary = (text: string, relatedTerms?: string[], isNested: boolean = false) => {
  if (!text) return null;

  const localGlossary = isNested
    ? glossaryTerms
    : glossaryForRelatedTerms(glossaryTerms, relatedTerms);

  return (
    <div className="w-full break-words whitespace-pre-wrap [word-break:break-word]">
      {text.split('\n').map((line, lineIdx) => {
        if (line.trim() === '') return <div key={lineIdx} className="h-1" />;

        // Пункт списка («- », «• », «1. ») — маркер слева, как в ExamScreen и RichText.
        const listMatch = line.match(/^(\s*[•\-*]\s+|\s*\d+\.\s+)/);
        let listMarker = listMatch ? listMatch[1].trim() : '';
        if (listMarker === '-' || listMarker === '*') listMarker = '•';
        const cleanLine = listMatch ? line.slice(listMatch[0].length) : line;

        const chars: { ch: string; bold: boolean; italic: boolean }[] = [];
        let bold = false, italic = false;
        for (const tk of cleanLine.split(/(\*\*|_)/g)) {
          if (tk === '**') { bold = !bold; continue; }
          if (tk === '_')  { italic = !italic; continue; }
          for (const ch of tk) chars.push({ ch, bold, italic });
        }
        const plain = chars.map(c => c.ch).join('');
        const plainNorm = plain.toLowerCase().replace(/ё/g, 'е');

        type Hit = { start: number; end: number; item: GlossaryItem };
        const hits: Hit[] = [];
        
        const isLetter = (s: string, i: number) =>
          i >= 0 && i < s.length && /[а-яеa-z]/.test(s[i]);

        for (const g of localGlossary) {
          const forms = [g.term, ...(g.variations || [])];
          for (const form of forms) {
            const f = form.toLowerCase().replace(/ё/g, 'е');
            let idx = plainNorm.indexOf(f);
            while (idx !== -1) {
              if (
                !isLetter(plainNorm, idx - 1) &&
                !isLetter(plainNorm, idx + f.length) &&
                !isSectionHeaderLabel(plain, idx, idx + f.length)
              ) {
                hits.push({ start: idx, end: idx + f.length, item: g });
              }
              idx = plainNorm.indexOf(f, idx + 1);
            }
          }
        }

        hits.sort((a, b) => (b.end - b.start) - (a.end - a.start));
        const accepted: Hit[] = [];
        const used = new Array(plain.length).fill(false);
        for (const h of hits) {
          let canAdd = true;
          for (let i = h.start; i < h.end; i++) if (used[i]) canAdd = false;
          if (canAdd) {
            accepted.push(h);
            for (let i = h.start; i < h.end; i++) used[i] = true;
          }
        }
        accepted.sort((a, b) => a.start - b.start);

        // Режем строку на куски по границам жирного/курсива и терминов глоссария,
        // чтобы у каждого куска было одно оформление.
        const boundary = new Set<number>([0, plain.length]);
        for (let i = 1; i < chars.length; i++) {
          if (chars[i].bold !== chars[i - 1].bold || chars[i].italic !== chars[i - 1].italic) boundary.add(i);
        }
        for (const h of accepted) { boundary.add(h.start); boundary.add(h.end); }
        const bounds = [...boundary].sort((a, b) => a - b);

        const segs: React.ReactNode[] = [];
        for (let bi = 0; bi < bounds.length - 1; bi++) {
          const s = bounds[bi], e = bounds[bi + 1];
          if (s >= e) continue;
          const fmt = chars[s];
          const style: React.CSSProperties = {
            fontWeight: fmt.bold ? 700 : 'inherit',
            color: fmt.bold ? 'var(--c-text)' : 'inherit',
            fontStyle: fmt.italic ? 'italic' : 'normal',
          };
          const h = accepted.find(a => s >= a.start && e <= a.end);
          if (!h) {
            segs.push(<span key={s} style={style}>{plain.slice(s, e)}</span>);
            continue;
          }
          segs.push(
            <span
              key={s}
              className="border-b border-dashed border-current transition-opacity active:opacity-70"
              style={{ ...style, cursor: 'pointer', color: 'var(--c-glossary, var(--c-primary))' }}
              onClick={(ev) => {
                ev.stopPropagation();
                const termKey = h.item.term;
                if (isNested) {
                  setTermDefStack(prev => [...prev, termKey]);
                } else {
                  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                  setTooltipTarget({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width });
                  let safeX = Math.max(10, Math.min(r.left, window.innerWidth - 290));
                  let safeY = r.bottom + 8;
                  if (safeY + 200 > window.innerHeight) safeY = r.top - 210;
                  setTooltipPos({ x: safeX, y: Math.max(10, safeY) });
                  setTermDefStack([termKey]);
                }
              }}
            >
              {plain.slice(s, e)}
            </span>
          );
        }

        if (listMatch) {
          // Пункт с отступом в исходнике («  - …») — вложенный: сдвигаем правее родителя.
          const nested = /^\s{2,}/.test(line);
          return (
            <div key={lineIdx} className={`flex gap-2 mb-1.5 mt-1 ${nested ? 'pl-6' : 'pl-2'}`}>
              <span className="text-[14px] leading-snug font-bold" style={{ color: accentColor }}>{listMarker}</span>
              <p className="m-0 flex-1 leading-snug">{segs}</p>
            </div>
          );
        }
        return <p key={lineIdx} className="indent-4 mb-2 mt-1 last:mb-0">{segs}</p>;
      })}
    </div>
  );
};
  const getPreview = (t: string) => t.replace(/\*\*/g, '').trim();

  return (
    <div className="flex flex-col h-full overflow-hidden max-w-full" style={{ background: 'var(--c-bg)' }}>

                    <div className="flex-shrink-0 px-4 pt-1 pb-3 sticky top-0 z-10"
                        style={{
                           background: 'color-mix(in srgb, var(--c-bg) 92%, transparent)',
                           backdropFilter: 'blur(16px)',
                           WebkitBackdropFilter: 'blur(16px)',
                          borderBottom: '1px solid var(--c-border)',
                          /* Срезаем 24 пикселя, но оставляем минимум 12px на всякий случай */
                          paddingTop: 'max(12px, calc(var(--header-pt) - 24px))', 
                        }}>
              <div className="flex items-start justify-between px-1">
                {/* 1. Левая безопасная зона (75px) — защищает от кнопки "Назад" */}
                <div className="w-[75px] flex-shrink-0" />

                {/* 2. Центрированный блок с логотипом, названием и прогрессом */}
                <div className="flex flex-col items-center justify-center flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <AppBrandIcon onClick={onSecretTap} />
                    <h1 className="text-[16px] font-bold tracking-tight leading-tight truncate" style={{ color: 'var(--c-text)' }}>
                      {APP_BRAND_NAME}
                    </h1>
                  </div>
                  
                  {/* Обертка w-fit, которая "обтягивает" текст, а полоска растягивается на 100% от этой ширины */}
                  <div className="flex flex-col items-stretch w-fit mt-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5 text-center" style={{ color: accentColor }}>
                      {bioSection === 'flashcards' && gameModes
                        ? `Флэшкарты · ${cfg?.shortLabel || subject}`
                        : bioSection === 'true_false' && gameModes
                          ? `Верно/Неверно · ${cfg?.shortLabel || subject}`
                          : `Вопросы · ${cfg?.label || subject}`}
                    </p>

                    {/* Полоска прогресса (w-full заполнит ровно ширину текста выше) */}
                    {!(gameModes && (bioSection === 'flashcards' || bioSection === 'true_false')) && (
                    <div className="w-full h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--c-border)' }}>
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${progress}%`, background: accentColor }} />
                    </div>
                    )}
                  </div>
                </div>

  {/* 3. Правая безопасная зона (75px) — теперь пустая, только для симметрии и защиты от меню "..." */}
  <div className="w-[75px] flex-shrink-0" />
</div>

        {!(gameModes && (bioSection === 'flashcards' || bioSection === 'true_false')) && (
        <>
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--c-muted)' }} />
          <Input placeholder="Поиск по вопросу или №…" value={search} onChange={e => setSearch(e.target.value)}
            className="pl-10 h-11 border focus-visible:ring-0 focus-visible:ring-offset-0 text-sm rounded-xl"
            style={{ background: 'var(--c-card)', borderColor: 'var(--c-border)', color: 'var(--c-text)', caretColor: 'var(--c-primary)' }} />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--c-muted)' }}><X className="w-4 h-4" /></button>}
        </div>

        <div className="flex gap-1.5 mt-2.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {([
            ['all',       'Все',        questionsData.length],
            ['unstudied', 'Не изучены', Math.max(0, questionsData.length - studiedIds.size)],
            ['audio',     'С аудио',    questionsData.filter((q: any) => !!q.audio).length],
          ] as const).map(([val, label, cnt]) => {
            const act = filter === val;
            return (
              <button key={val} onClick={() => setFilter(val as any)}
                className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-[12px] font-bold whitespace-nowrap transition-all active:scale-95"
                style={act
                  ? { background: accentColor, color: '#fff' }
                  : { background: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>
                {label}
                <span className="text-[10px] font-mono px-1.5 rounded-md"
                  style={act
                    ? { background: 'rgba(255,255,255,0.25)', color: '#fff' }
                    : { background: 'var(--c-chip)', color: 'var(--c-text-faint)' }}>
                  {cnt}
                </span>
              </button>
            );
          })}
        </div>
        </>
        )}
      </div>

      {gameModes && bioSection === 'flashcards' ? (
        <div className="flex-1 flex flex-col min-h-0" style={{ paddingBottom: 'var(--scroll-pb)' }}>
          <FlashcardsTab subject={subject} accentColor={accentColor} bustDataCache={bustDataCache} />
        </div>
      ) : gameModes && bioSection === 'true_false' ? (
        <div className="flex-1 flex flex-col min-h-0" style={{ paddingBottom: 'var(--scroll-pb)' }}>
          <TrueFalseTab subject={subject} accentColor={accentColor} bustDataCache={bustDataCache} />
        </div>
      ) : (
      <ScrollArea className="flex-1 scroll-container">
        <div className="py-3 px-3 mx-auto max-w-2xl w-full" style={{ paddingBottom: 'var(--scroll-pb)' }}>
          {microLoading ? (
              <div className="flex items-center justify-center py-24" style={{ color: 'var(--c-amber)' }}>
                <svg className="animate-spin w-8 h-8" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              </div>
            ) : filtered.length > 0 ? (
            <Accordion type="single" collapsible className="space-y-2 w-full"
              onValueChange={val => setOpenAccordionId(val ?? '')}>
              {filtered.map(q => {
                const studied = studiedIds.has(q.id);
                const hasAudio = !!(q as any).audio;
                return (
                  <AccordionItem key={q.id} value={q.id.toString()} className="border-none rounded-2xl overflow-hidden w-full relative transition-all duration-200"
                    style={{ background: studied ? 'color-mix(in srgb, var(--c-primary) 6%, var(--c-card))' : 'var(--c-card)', border: studied ? '1px solid var(--c-primary-br)' : '1px solid var(--c-border)' }}>
                    <div className="absolute left-0 top-0 bottom-0 w-[3px]"
                      style={{ background: studied ? 'var(--c-primary)' : 'var(--c-border)' }} />
                    <AccordionTrigger className="px-4 py-3.5 pl-4 hover:no-underline [&>svg]:hidden">
                      <div className="flex items-start gap-3 text-left w-full pr-2">
                        <div className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border flex items-center justify-center transition-all"
                          style={studied ? { background: 'var(--c-primary-dim)', borderColor: 'var(--c-primary)' } : { borderColor: 'var(--c-border)' }}>
                          {studied && <div className="w-2 h-2 rounded-full" style={{ background: 'var(--c-primary)' }} />}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="inline-block text-[10px] font-mono font-bold px-2 py-0.5 rounded-md"
                              style={studied
                                ? { background: 'var(--c-primary-dim)', color: 'var(--c-primary)', border: '1px solid var(--c-primary-br)' }
                                : { background: 'color-mix(in srgb, var(--c-border) 60%, transparent)', color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}>
                              №{q.id}
                            </span>
                            {hasAudio && (
                              <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                                style={{ background: `color-mix(in srgb, ${accentColor} 12%, transparent)`, color: accentColor, border: `1px solid color-mix(in srgb, ${accentColor} 25%, transparent)` }}>
                                🎧
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-medium leading-snug line-clamp-2 break-words"
                            style={{ color: studied ? 'color-mix(in srgb, var(--c-text) 75%, transparent)' : 'var(--c-text)' }}>
                            {getPreview(q.question)}
                          </p>
                        </div>
                        <div className="flex-shrink-0 mt-1" style={{ color: 'var(--c-muted)' }}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
                          </svg>
                        </div>
                      </div>
                    </AccordionTrigger>

                    <AccordionContent className="px-4 pb-4 pt-0 w-full overflow-hidden">
                      <div className="rounded-xl p-3 mb-3 relative overflow-hidden"
                        style={{ background: 'color-mix(in srgb, var(--c-bg) 60%, var(--c-card))', border: '1px solid var(--c-border)' }}>
                        <div className="text-sm leading-relaxed max-h-20 overflow-hidden" style={{ color: 'color-mix(in srgb, var(--c-text) 70%, transparent)' }}>
                          {renderWithGlossary(q.answer, itemRelatedTerms(q))}
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none"
                          style={{ background: 'linear-gradient(to top, color-mix(in srgb, var(--c-bg) 60%, var(--c-card)), transparent)' }} />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => { _activeAudio?.pause(); setReadingQuestion(q); }}
                          className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-semibold transition-all active:scale-[0.97]"
                          style={{ background: 'var(--c-primary-dim)', border: '1px solid var(--c-primary-br)', color: 'var(--c-primary)' }}>
                          <BookOpen className="w-4 h-4" /> Читать
                        </button>
                        <button onClick={() => toggleStudied(q.id)}
                          className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-semibold transition-all active:scale-[0.97]"
                          style={studied
                            ? { background: 'var(--c-primary)', border: '1px solid var(--c-primary)', color: 'hsl(var(--primary-foreground))' }
                            : { background: 'transparent', border: '1px solid var(--c-border)', color: 'var(--c-muted)' }}>
                          {studied ? <><CheckCircle2 className="w-4 h-4" /> Изучено</> : <><Circle className="w-4 h-4" /> Изучил</>}
                        </button>
                      </div>
                      {(q as any).audio && <AudioPlayer src={(q as any).audio} accentColor={accentColor} />}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 space-y-3" style={{ color: 'var(--c-muted)', opacity: 0.5 }}>
              <Search className="w-12 h-12" /><p className="text-sm">Ничего не найдено</p>
            </div>
          )}
        </div>
      </ScrollArea>
      )}

      <AnimatePresence>
        {readingQuestion && (
          <motion.div initial={{ opacity: 0, y: 80 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 80 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="fixed inset-0 z-[100] flex flex-col overflow-hidden" style={{ background: 'var(--c-bg)' }}>

            <div className="flex items-center justify-center px-3 py-2 flex-shrink-0"
              style={{
                background: 'color-mix(in srgb, var(--c-bg) 92%, transparent)',
                backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                borderBottom: '1px solid var(--c-border)',
                paddingTop: 'calc(var(--header-pt) - 28px)',
              }}>
              <div className="text-center min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--c-muted)' }}>Чтение</div>
                <div className="text-[12px] font-mono font-bold leading-tight" style={{ color: 'var(--c-text)' }}>
                  №{readingQuestion.id} · {cfg?.label || subject}
                </div>
              </div>
            </div>

            <div
              ref={readingScrollRef}
              className="flex-1 overflow-y-auto px-5 pt-2 scroll-container"
              onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
            >
              
              <div className="space-y-4 pb-32 max-w-2xl mx-auto w-full overflow-x-hidden">
                <div className="flex items-center gap-2 pt-2">
                  <span className="text-[11px] font-mono font-bold px-3 py-1 rounded-lg"
                    style={{ background: 'var(--c-primary-dim)', color: 'var(--c-primary)', border: '1px solid var(--c-primary-br)' }}>
                    Вопрос №{readingQuestion.id}
                  </span>
                </div>
                <h2 className="font-semibold leading-snug break-words" style={{ fontSize: `${fontSize * 1.15}px`, color: 'var(--c-text)' }}>
                  {renderWithGlossary(readingQuestion.question, itemRelatedTerms(readingQuestion))}
                </h2>
                <div className="flex items-center gap-3" style={{ borderTop: '1px solid var(--c-border)', paddingTop: '12px' }}>
                  <BookOpen className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
                  <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: accentColor }}>Ответ</span>
                </div>
                
                <div className="leading-snug font-normal break-words" style={{ fontSize: `${fontSize}px`, color: 'color-mix(in srgb, var(--c-text) 92%, transparent)' }}>
                  {renderWithGlossary(readingQuestion.answer, itemRelatedTerms(readingQuestion))}
                </div>

                <QuestionAiPanel
                  key={readingQuestion.id}
                  question={readingQuestion.question}
                  answer={readingQuestion.answer}
                  accentColor={accentColor}
                />

                {(() => {
                  const raw = readingQuestion.images || readingQuestion.image;
                  if (!raw) return null;
                  const imgArr: string[] = Array.isArray(raw) ? raw : [raw];
                  return imgArr.map((img: string, i: number) => (
                    <div key={i}
                      className="img-protected-wrapper rounded-2xl overflow-hidden cursor-pointer relative"
                      style={{ border: '1px solid var(--c-border)' }}
                      onClick={() => openZoom(imgArr, i)}
                      onTouchStart={e => e.preventDefault()}
                      onContextMenu={e => e.preventDefault()}>
                      <CachedImage src={img} alt="" className="w-full h-auto object-contain max-h-80"
                        loading="lazy" draggable={false} />
                      <div className="absolute inset-0" style={{ WebkitTouchCallout: 'none' }} />
                    </div>
                  ));
                })()}
                <PersonalNoteCard
                  note={userNotes[readingQuestion.id] || ''}
                  onSave={text => updateNote(readingQuestion.id, text)}
                  onClear={() => clearNote(readingQuestion.id)}
                  scrollContainerRef={readingScrollRef}
                />
                {readingQuestion.audio && <AudioPlayer src={readingQuestion.audio} accentColor={accentColor} />}
              </div>
            </div>

            <div
              className="fixed left-0 right-0 px-5 z-[110] flex justify-center"
              style={{ bottom: 'calc(var(--nav-bottom, 12px) + 12px)' }}
            >
              <div
                className="flex items-center gap-1.5 p-1.5 rounded-[28px] shadow-2xl"
                style={{
                  background: 'var(--c-nav-bg)',
                  backdropFilter: 'blur(24px)',
                  WebkitBackdropFilter: 'blur(24px)',
                  border: '1.5px solid var(--c-nav-border)',
                  boxShadow: '0 8px 32px hsl(0 0% 0% / 0.4)',
                }}
              >
                <button
                  onClick={() => { const i = questionsData.findIndex(q => q.id === readingQuestion.id); setReadingQuestion(questionsData[(i - 1 + questionsData.length) % questionsData.length]); }}
                  className="w-10 h-10 flex items-center justify-center rounded-full flex-shrink-0 transition-all active:scale-95"
                  style={{ color: 'var(--c-muted)' }}
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                <button
                  onClick={() => toggleStudied(readingQuestion.id)}
                  className="flex items-center justify-center gap-2 px-4 h-10 rounded-full text-sm font-bold transition-all active:scale-[0.97]"
                  style={studiedIds.has(readingQuestion.id)
                    ? { background: 'var(--c-primary)', color: 'hsl(var(--primary-foreground))' }
                    : { background: 'var(--c-primary-dim)', color: 'var(--c-primary)', border: '1px solid var(--c-primary-br)' }}
                >
                  {studiedIds.has(readingQuestion.id)
                    ? <><CheckCircle2 className="w-4 h-4" /> Изучено</>
                    : <><Circle className="w-4 h-4" /> Изучил</>}
                </button>

                <button
                  onClick={() => setReadingQuestion(null)}
                  className="flex items-center justify-center gap-2 px-4 h-10 rounded-full text-sm font-semibold transition-all active:scale-[0.97]"
                  style={{ color: 'var(--c-muted)', border: '1px solid var(--c-border)' }}
                >
                  <X className="w-4 h-4" /> Выйти
                </button>

                <button
                  onClick={() => { const i = questionsData.findIndex(q => q.id === readingQuestion.id); setReadingQuestion(questionsData[(i + 1) % questionsData.length]); }}
                  className="w-10 h-10 flex items-center justify-center rounded-full flex-shrink-0 transition-all active:scale-95"
                  style={{ color: 'var(--c-muted)' }}
                >
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {activeTermKey && (() => {
        const found = glossaryTerms.find(g => g.term === activeTermKey);
        return (
          <div ref={tooltipRef} className="fixed z-[200] rounded-2xl p-4 shadow-2xl max-w-[280px] select-none"
            style={{ 
              left: tooltipPos.x, 
              top: tooltipPos.y, 
              background: 'var(--c-card)', 
              border: '1px solid var(--c-primary-br)', 
              cursor: dragging ? 'grabbing' : 'grab' 
            }}
            onMouseDown={handleTooltipMouseDown} 
            onTouchStart={handleTooltipTouchStart} 
            onClick={e => e.stopPropagation()}
          >
            
            {termDefStack.length > 1 && (
              <div className="flex items-center gap-2 mb-3 pb-2 border-b" style={{ borderColor: 'color-mix(in srgb, var(--c-text) 10%, transparent)' }}>
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setTermDefStack(p => p.slice(0, -1)); 
                  }}
                  className="flex items-center gap-1 text-[12px] font-bold active:scale-95 transition-transform"
                  style={{ color: 'var(--c-primary)' }}
                >
                  <ArrowLeft className="w-3 h-3" /> Назад
                </button>
              </div>
            )}

            {found?.image && (
              <GlossaryImages
                images={Array.isArray(found.image) ? found.image : [found.image]}
                onZoom={openZoom}
              />
            )}

            {found?.term && (
              <h4 className="font-bold mb-1 text-sm" style={{ color: 'var(--c-text)' }}>
                {found.term}
              </h4>
            )}
            
            <div className="text-sm font-normal" style={{ color: 'var(--c-text)' }}>
               {renderWithGlossary(found?.definition || '', undefined, true)}
            </div>
            
            <p className="text-[10px] mt-3 opacity-50 flex justify-center" style={{ color: 'var(--c-muted)' }}>↔ перетащите</p>
          </div>
        );
      })()}

      {zoomList.length > 0 && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{
            background:     'hsl(0 0% 0% / 0.92)',
            backdropFilter: 'blur(8px)',
            touchAction:    'none',
            overscrollBehavior: 'contain',
          }}
          onClick={e => { e.stopPropagation(); closeZoom(); }}
          onWheel={e => {
            e.preventDefault();
            const delta    = e.deltaY > 0 ? -0.25 : 0.25;
            const newScale = Math.min(5, Math.max(1, scale + delta));
            const img      = zoomImgRef.current;
            if (!img) { setScale(newScale); return; }
            const rect = img.getBoundingClientRect();
            const dx   = e.clientX - (rect.left + rect.width  / 2);
            const dy   = e.clientY - (rect.top  + rect.height / 2);
            const r    = newScale / scale;
            const newT = { x: translate.x + dx * (1 - r), y: translate.y + dy * (1 - r) };
            setScale(newScale);
            setTranslate(clampZoom(newT, newScale));
          }}
          onTouchStart={e => {
            if (e.touches.length === 2) {
              const t1 = e.touches[0], t2 = e.touches[1];
              const dx = t1.clientX - t2.clientX;
              const dy = t1.clientY - t2.clientY;
              const cx = (t1.clientX + t2.clientX) / 2;
              const cy = (t1.clientY + t2.clientY) / 2;
              const img = zoomImgRef.current;
              const rect = img?.getBoundingClientRect();
              const ix = rect ? cx - (rect.left + rect.width  / 2) : 0;
              const iy = rect ? cy - (rect.top  + rect.height / 2) : 0;
              (e.currentTarget as any).__ps = {
                dist: Math.hypot(dx, dy),
                scale,
                translate,
                ix, iy,
              };
            } else if (e.touches.length === 1 && scale > 1) {
              (e.currentTarget as any).__pan = {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY,
                translate,
              };
            } else if (e.touches.length === 1 && scale === 1 && zoomList.length > 1) {
              (e.currentTarget as any).__swipe = { x: e.touches[0].clientX };
            }
          }}
          onTouchMove={e => {
            const target = e.currentTarget as any;
            if (e.touches.length === 2 && target.__ps) {
              e.preventDefault();
              const ps = target.__ps;
              const dx = e.touches[0].clientX - e.touches[1].clientX;
              const dy = e.touches[0].clientY - e.touches[1].clientY;
              const ns = Math.min(5, Math.max(1, ps.scale * Math.hypot(dx, dy) / ps.dist));
              const r  = ns / ps.scale;
              const newT = {
                x: ps.translate.x + ps.ix * (1 - r),
                y: ps.translate.y + ps.iy * (1 - r),
              };
              setScale(ns);
              setTranslate(clampZoom(newT, ns));
            } else if (e.touches.length === 1 && target.__pan && scale > 1) {
              e.preventDefault();
              const p = target.__pan;
              const newT = {
                x: p.translate.x + e.touches[0].clientX - p.x,
                y: p.translate.y + e.touches[0].clientY - p.y,
              };
              setTranslate(clampZoom(newT, scale));
            }
          }}
          onTouchEnd={e => {
            const t = e.currentTarget as any;
            if (t.__swipe) {
              const dx = e.changedTouches[0].clientX - t.__swipe.x;
              if (Math.abs(dx) > 50) {
                if (dx < 0) setZoomIdx(i => Math.min(zoomList.length - 1, i + 1));
                else        setZoomIdx(i => Math.max(0, i - 1));
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
                maxWidth:        '95vw',
                maxHeight:       '85vh',
                transform:       `translate3d(${translate.x}px, ${translate.y}px, 0) scale(${scale})`,
                transformOrigin: 'center center',
                transition:      'transform 0.12s ease-out',
                touchAction:     'none',
                willChange:      'transform',
                userSelect:      'none',
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
                color:      '#fff',
                backdropFilter: 'blur(8px)',
                border:     '1px solid rgba(255,255,255,0.15)',
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
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
                style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.15)' }}>
                {zoomList.map((_, i) => (
                  <button key={i} onClick={() => { setZoomIdx(i); setScale(1); setTranslate({ x: 0, y: 0 }); }}
                    className="rounded-full transition-all duration-200"
                    style={{
                      width: i === zoomIdx ? 18 : 7, height: 7,
                      background: i === zoomIdx ? '#fff' : 'rgba(255,255,255,0.4)',
                    }}
                    aria-label={`Картинка ${i + 1}`}
                  />
                ))}
              </div>
            )}
            <button
              onClick={e => { e.stopPropagation(); closeZoom(); }}
              className="flex items-center gap-2 px-6 h-11 rounded-full text-sm font-semibold transition-all active:scale-95 shadow-2xl"
              style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-text)' }}
            >
              <X className="w-4 h-4" /> Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
};