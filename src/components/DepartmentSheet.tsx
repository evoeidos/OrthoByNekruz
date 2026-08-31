"use client";

import React from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  STAFF_GROUP_LABEL,
  STAFF_GROUP_ORDER,
  type Department,
  type DepartmentStaff,
  type DepartmentTool,
  type StaffGroup,
} from '@/lib/departments';
import { openExternalUrl } from '@/lib/openExternalUrl';

function openContact(href: string) {
  if (href.startsWith('http')) {
    openExternalUrl(href);
    return;
  }
  window.location.href = href;
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

function groupedStaff(staff: DepartmentStaff[]): { group: StaffGroup; items: DepartmentStaff[] }[] {
  return STAFF_GROUP_ORDER
    .map(group => ({ group, items: staff.filter(s => s.group === group) }))
    .filter(g => g.items.length > 0);
}

function StoreButtons({ tool, accent }: { tool: DepartmentTool; accent: string }) {
  const buttons: { label: string; url: string }[] = [];
  if (tool.androidUrl) buttons.push({ label: 'Android · Google Play', url: tool.androidUrl });
  if (tool.iosUrl) buttons.push({ label: 'iPhone · App Store', url: tool.iosUrl });
  if (tool.webUrl) buttons.push({ label: 'В браузере', url: tool.webUrl });
  if (!buttons.length) return null;

  return (
    <div className="flex flex-col gap-1.5 mt-3">
      {buttons.map(b => (
        <button
          key={b.url}
          type="button"
          onClick={() => openExternalUrl(b.url)}
          className="w-full text-left text-[13px] font-semibold px-3 py-2.5 rounded-xl transition-all active:scale-[0.98]"
          style={{
            background: `color-mix(in srgb, ${accent} 14%, transparent)`,
            color: accent,
            border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)`,
          }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}

function ContactRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--c-muted)' }}>
        {label}
      </div>
      <div className="text-[13.5px] font-medium leading-snug mt-0.5" style={{ color: 'var(--c-text)' }}>
        {value}
      </div>
    </>
  );
  if (!onClick) {
    return <div className="px-3 py-2.5">{inner}</div>;
  }
  return (
    <button type="button" onClick={onClick} className="w-full text-left px-3 py-2.5 active:opacity-80">
      {inner}
    </button>
  );
}

interface DepartmentSheetProps {
  department: Department;
  accentColor: string;
  onClose: () => void;
}

export const DepartmentSheet: React.FC<DepartmentSheetProps> = ({
  department,
  accentColor,
  onClose,
}) => {
  const groups = groupedStaff(department.staff);

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
          maxHeight: '90svh',
          paddingBottom: 'env(safe-area-inset-bottom, 16px)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-9 h-1 rounded-full" style={{ background: 'var(--c-border)' }} />
        </div>

        <div className="flex items-center gap-3 px-4 pt-1 pb-3 flex-shrink-0">
          <div
            className="w-9 h-9 rounded-[10px] flex items-center justify-center text-[18px] flex-shrink-0"
            style={{ background: `color-mix(in srgb, ${accentColor} 15%, transparent)` }}
          >
            🏛️
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-bold leading-tight" style={{ color: 'var(--c-text)' }}>
              {department.name}
            </div>
            <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
              {department.index ? `Индекс ${department.index} · ` : ''}кто есть кто и чем пользоваться
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: 'var(--c-border)', color: 'var(--c-muted)' }}
            aria-label="Закрыть"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-5 flex flex-col gap-4">
          <p
            className="text-[13.5px] leading-relaxed whitespace-pre-wrap"
            style={{ color: 'color-mix(in srgb, var(--c-text) 90%, transparent)' }}
          >
            {department.intro}
          </p>

          {(department.address || department.phone || department.email || department.hours) && (
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
            >
              {department.address && (
                <ContactRow
                  label="Адрес"
                  value={department.address}
                  onClick={department.mapUrl ? () => openExternalUrl(department.mapUrl!) : undefined}
                />
              )}
              {department.phone && (
                <ContactRow
                  label="Телефон"
                  value={department.phone}
                  onClick={() => openContact(telHref(department.phone!))}
                />
              )}
              {department.email && (
                <ContactRow
                  label="Почта"
                  value={department.email}
                  onClick={() => openContact(`mailto:${department.email}`)}
                />
              )}
              {department.hours && (
                <ContactRow label="Режим работы" value={department.hours} />
              )}
            </div>
          )}

          {department.tools.map(tool => (
            <div
              key={tool.id}
              className="rounded-2xl px-3.5 py-3.5"
              style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
            >
              <div className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: accentColor }}>
                Чем пользоваться
              </div>
              <div className="text-[15px] font-bold mt-1" style={{ color: 'var(--c-text)' }}>
                {tool.title}
              </div>
              <p className="text-[13px] leading-relaxed mt-1.5" style={{ color: 'var(--c-muted)' }}>
                {tool.blurb}
              </p>
              {tool.how.length > 0 && (
                <ol className="mt-3 flex flex-col gap-2">
                  {tool.how.map((step, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span
                        className="flex-shrink-0 text-[12px] font-extrabold tabular-nums w-5 text-center"
                        style={{ color: accentColor, marginTop: 1 }}
                      >
                        {i + 1}
                      </span>
                      <span className="text-[13px] leading-relaxed" style={{ color: 'var(--c-text)' }}>
                        {step}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <StoreButtons tool={tool} accent={accentColor} />
            </div>
          ))}

          {groups.map(({ group, items }) => (
            <div key={group}>
              <div
                className="text-[10.5px] font-bold uppercase tracking-wider mb-2 px-0.5"
                style={{ color: 'var(--c-muted)' }}
              >
                {STAFF_GROUP_LABEL[group]}
              </div>
              <div
                className="rounded-2xl overflow-hidden"
                style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
              >
                {items.map((person, i) => (
                  <div
                    key={person.name}
                    className="px-3.5 py-2.5"
                    style={{
                      borderTop: i === 0 ? undefined : '1px solid var(--c-border)',
                    }}
                  >
                    <div className="text-[13.5px] font-semibold leading-snug" style={{ color: 'var(--c-text)' }}>
                      {person.name}
                    </div>
                    <div className="text-[12px] mt-0.5" style={{ color: 'var(--c-muted)' }}>
                      {person.role}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(content, document.body);
};
