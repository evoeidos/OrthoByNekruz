"use client";

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { Resource } from '@/pages/api/resources';

// ── Иконка и цвет по типу ─────────────────────────────────────────────────────
const TYPE_META: Record<Resource['type'], { emoji: string; label: string; color: string; bg: string }> = {
  umkd:  { emoji: '🎓', label: 'УМКД',          color: '#0EA5E9', bg: 'rgba(14,165,233,0.12)'  },
  video: { emoji: '▶️', label: 'Видео',         color: '#EF4444', bg: 'rgba(239,68,68,0.12)'   },
  pdf:   { emoji: '📄', label: 'PDF',            color: '#F97316', bg: 'rgba(249,115,22,0.12)'  },
  docx:  { emoji: '📝', label: 'Word',           color: '#3B82F6', bg: 'rgba(59,130,246,0.12)'  },
  pptx:  { emoji: '📊', label: 'Презентация',   color: '#A855F7', bg: 'rgba(168,85,247,0.12)'  },
  link:  { emoji: '🔗', label: 'Ссылка',        color: '#10B981', bg: 'rgba(16,185,129,0.12)'  },
};

const TYPE_ORDER: Resource['type'][] = ['umkd', 'video', 'pdf', 'pptx', 'docx', 'link'];

function openUrl(url: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tg = (window as any).Telegram?.WebApp;
  if (tg?.openLink) {
    tg.openLink(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

// ── Карточка ресурса ──────────────────────────────────────────────────────────
function ResourceCard({ resource }: { resource: Resource }) {
  const meta = TYPE_META[resource.type];
  return (
    <button
      onClick={() => openUrl(resource.url)}
      className="w-full text-left flex items-center gap-3 rounded-[14px] p-3 transition-all active:scale-[0.98]"
      style={{
        background: 'var(--c-card)',
        border: '1px solid var(--c-border)',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div
        className="w-10 h-10 rounded-[11px] flex items-center justify-center flex-shrink-0 text-[18px]"
        style={{ background: meta.bg }}
      >
        {meta.emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="text-[13.5px] font-semibold leading-snug"
          style={{ color: 'var(--c-text)' }}
        >
          {resource.title}
        </div>
        {resource.description && (
          <div
            className="text-[11.5px] mt-0.5 leading-tight line-clamp-2"
            style={{ color: 'var(--c-muted)' }}
          >
            {resource.description}
          </div>
        )}
        <div
          className="text-[10.5px] font-semibold uppercase tracking-wide mt-1"
          style={{ color: meta.color }}
        >
          {meta.label}
        </div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="var(--c-text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="flex-shrink-0"
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    </button>
  );
}

// ── Основной компонент ────────────────────────────────────────────────────────
interface ResourcesSheetProps {
  subject:      string;
  accentColor:  string;
  onClose:      () => void;
}

export const ResourcesSheet: React.FC<ResourcesSheetProps> = ({ subject, accentColor, onClose }) => {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    fetch(`/api/resources?subject=${subject}`)
      .then(r => r.json())
      .then(d => setResources(d.resources ?? []))
      .catch(() => setResources([]))
      .finally(() => setLoading(false));
  }, [subject]);

  // Группируем по типу в нужном порядке
  const grouped = TYPE_ORDER
    .map(type => ({ type, items: resources.filter(r => r.type === type) }))
    .filter(g => g.items.length > 0);

  const content = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="absolute bottom-0 left-0 right-0 rounded-t-[24px] flex flex-col"
        style={{
          background: 'var(--c-bg)',
          maxHeight: '88svh',
          paddingBottom: 'env(safe-area-inset-bottom, 16px)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Ручка */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--c-border)' }} />
        </div>

        {/* Шапка */}
        <div className="flex items-center gap-3 px-4 pt-1 pb-3 flex-shrink-0">
          <div
            className="w-9 h-9 rounded-[10px] flex items-center justify-center text-[18px] flex-shrink-0"
            style={{ background: `color-mix(in srgb, ${accentColor} 15%, transparent)` }}
          >
            📚
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-bold" style={{ color: 'var(--c-text)' }}>
              Полезные материалы
            </div>
            {!loading && (
              <div className="text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
                {resources.length === 0
                  ? 'Пока ничего нет'
                  : `${resources.length} ${resources.length === 1 ? 'материал' : resources.length < 5 ? 'материала' : 'материалов'}`}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center active:scale-90 transition-transform duration-150"
            style={{ background: 'var(--c-border)', color: 'var(--c-muted)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Контент */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {loading ? (
            <div className="py-12 text-center text-[13px]" style={{ color: 'var(--c-muted)' }}>
              Загрузка...
            </div>
          ) : resources.length === 0 ? (
            <div className="py-12 text-center">
              <div className="text-[40px] mb-3">📭</div>
              <div className="text-[14px] font-semibold" style={{ color: 'var(--c-muted)' }}>
                Материалы пока не добавлены
              </div>
              <div className="text-[12px] mt-1" style={{ color: 'var(--c-text-faint)' }}>
                 Некруз добавит их позже
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map(({ type, items }) => {
                const meta = TYPE_META[type];
                return (
                  <div key={type}>
                    <div
                      className="text-[10.5px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5"
                      style={{ color: meta.color }}
                    >
                      <span>{meta.emoji}</span>
                      <span>{meta.label}</span>
                      <span
                        className="rounded-md px-1.5 py-px text-[10px]"
                        style={{ background: meta.bg, color: meta.color }}
                      >
                        {items.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {items.map(r => <ResourceCard key={r.id} resource={r} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(content, document.body);
};
