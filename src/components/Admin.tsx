"use client";

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import Script from 'next/script';
import { PREVIEW_MODULE_LABELS, type PreviewModule } from '@/lib/previewModules';
import { formatAdminModuleLabel } from '@/lib/previewModuleStatus';
import { formatPriceRub } from '@/lib/previewPricing';
import { getTgChatHref, formatTgChatLabel, openTgChat, normalizeTelegramUsername, isValidTelegramUsername } from '@/lib/tgLinks';
import { AdminPatternLock, ADMIN_PATTERN, ADMIN_UNLOCK_SECRET } from '@/components/AdminPatternLock';
import AdminGroupAccessTab from '@/components/AdminGroupAccessTab';
import AdminCurriculumTab from '@/components/AdminCurriculumTab';

interface User {
  tgId:          string;
  username:      string | null;
  firstName:     string | null;
  lastName:      string | null;
  blocked:       boolean;
  blockedReason: string | null;
  blockedAt:     string | null;
  subjects:      string[];
  hasMicro:      boolean;
  usedDemo:      boolean;
  previewStatus:        string | null;
  previewChosenSubject: string | null;
  previewChosenModules: string[] | null;
  previewDisplayModules?: PreviewModule[];
  promoCode:            string | null;
  facultyId:            string | null;
  previewFaculty:       string | null;
  facultyDisplayLabel?: string | null;
  facultyDisplayCode?:  string | null;
  facultyIcon?:         string | null;
  previewStartedAt?:    string | null;
  previewConfirmedAt?:  string | null;
  previewQuotedPrice?:  number | null;
  receiptClaimedAt?:    string | null;
  previewNeedsConfirm?: boolean;
  previewPendingModules?: PreviewModule[];
  previewIsAddon?:       boolean;
  contactUsername?:     string | null;
  studyGroup?:          string | null;
  activatedKey:  string | null;
  registeredAt:  string | null;
  lastLogin:       string | null;
  lastActivityAt?: string | null;
  loginCount:      number;
  opensToday:    number;
  suspicious:    boolean;
  navHidden?:    Record<string, string[]>;
  paid:          boolean;
}

type AdminTab = 'students' | 'access' | 'lessons' | 'settings';

interface SubjectInfo {
  id:         string;
  label:      string;
  shortLabel: string;
  color:      string;
}

interface RateBlock {
  tgId: string;
  ttl:  number;
}

type Filter = 'all' | 'blocked' | 'suspicious' | 'demo' | 'unpaid';
type SortBy = 'registered' | 'lastActivity' | 'loginCount';
type Action = 'block' | 'unblock' | 'reset_demo' | 'grant_direct_access' | 'force_payment_only' | 'confirm_preview' | 'confirm_preview_module' | 'reject_preview_module' | 'reopen_preview_vitrine' | 'toggle_subject' | 'toggle_section' | 'delete_user' | 'toggle_paid' | 'set_contact_username' | 'set_study_group';

type PreviewModKind = 'questions' | 'tests' | 'tasks';
type PreviewCatalogSettings = Record<string, {
  open?: boolean;
  modules?: Partial<Record<PreviewModKind, boolean>>;
}>;
type PreviewCatalogBaseEntry = {
  id:      string;
  label:   string;
  badge:   string;
  color:   string;
  modules: { id: PreviewModKind; label: string; available: boolean }[];
};

// Управляемые из админки разделы. Сам раздел «Статистика» не выключается
// (там прогресс юзера), но внутри него можно скрыть блок «Проверка готовности».
const NAV_SECTIONS: { id: string; label: string }[] = [
  { id: 'lessons',   label: 'Занятия'             },
  { id: 'questions', label: 'Вопросы'             },
  { id: 'tests',     label: 'Тесты'               },
  { id: 'tasks',     label: 'Задачи'              },
  { id: 'exam',      label: 'Проверка готовности' },
];

// ── Палитра (Paper) ───────────────────────────────────────────────────────────
const T = {
  bg:          '#F4F1EA',
  surface:     '#FFFFFF',
  surfaceAlt:  '#FAF8F3',
  border:      '#E7E2D6',
  borderStrong:'#D7D1C2',
  text:        '#1F1B14',
  textMuted:   '#6B6558',
  textFaint:   '#9A9485',
  chipBg:      '#F1ECDE',
  accent:      '#1F7A6E',
  accentSoft:  '#E5F1EE',
  danger:      '#B8423A',
  dangerSoft:  '#FBE9E6',
  warn:        '#A0741E',
  warnSoft:    '#F7EED7',
  success:     '#3B7A48',
  successSoft: '#E4EFE3',
  info:        '#3461B5',
  infoSoft:    '#E4ECF8',
  purple:      '#6A4DB4',
  purpleSoft:  '#ECE6F7',
};

const FONT_SANS = '"IBM Plex Sans", -apple-system, "SF Pro Display", system-ui, sans-serif';
const FONT_MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';

// ── Читает initData из Telegram WebApp ────────────────────────────────────────
function getTelegramInitData(): string {
  if (typeof window === 'undefined') return '';
  // @ts-ignore
  return window.Telegram?.WebApp?.initData ?? '';
}

// ── Подключаем Google Fonts (IBM Plex) ────────────────────────────────────────
function useFonts() {
  useEffect(() => {
    const id = 'admin-plex-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap&subset=cyrillic,latin';
    document.head.appendChild(link);
  }, []);
}

// ── Хук: снимает блокировку скролла из globals.css ───────────────────────────
function useAdminScroll() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow:    html.style.overflow,
      htmlHeight:      html.style.height,
      htmlPosition:    html.style.position,
      bodyOverflow:    body.style.overflow,
      bodyHeight:      body.style.height,
      bodyPosition:    body.style.position,
      bodyTouchAction: body.style.touchAction,
      bodyBg:          body.style.background,
    };
    html.style.overflow    = 'auto';
    html.style.height      = 'auto';
    html.style.position    = 'static';
    body.style.overflow    = 'auto';
    body.style.height      = 'auto';
    body.style.position    = 'static';
    body.style.touchAction = 'auto';
    body.style.background  = T.bg;
    return () => {
      html.style.overflow    = prev.htmlOverflow;
      html.style.height      = prev.htmlHeight;
      html.style.position    = prev.htmlPosition;
      body.style.overflow    = prev.bodyOverflow;
      body.style.height      = prev.bodyHeight;
      body.style.position    = prev.bodyPosition;
      body.style.touchAction = prev.bodyTouchAction;
      body.style.background  = prev.bodyBg;
    };
  }, []);
}

function fmtTTL(sec: number): string {
  if (sec < 0) return 'истёк';
  if (sec < 60) return `${sec}с`;
  if (sec < 3600) return `${Math.floor(sec / 60)}м`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return m > 0 ? `${h}ч ${m}м` : `${h}ч`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function displayName(u: User): string {
  const parts = [u.firstName, u.lastName].filter(Boolean).join(' ');
  if (parts && u.username) return `${parts} · @${u.username}`;
  if (parts) return parts;
  if (u.username) return `@${u.username}`;
  return 'Без имени';
}

function initials(u: User): string {
  const a = (u.firstName?.[0] || u.username?.[0] || '?').toUpperCase();
  const b = (u.lastName?.[0] || '').toUpperCase();
  return a + b;
}

// ── Чип ───────────────────────────────────────────────────────────────────────
function Chip({ children, bg, color }: { children: React.ReactNode; bg: string; color: string }) {
  return (
    <span style={{
      background: bg, color,
      borderRadius: 6, padding: '2px 7px',
      fontSize: 11, fontWeight: 600, letterSpacing: 0.1,
      flexShrink: 0, lineHeight: 1.4,
    }}>{children}</span>
  );
}

// ── Мета-поле ─────────────────────────────────────────────────────────────────
function Meta({ label, value, color, mono }: {
  label: string; value: string; color?: string; mono?: boolean;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        color: T.textFaint, fontSize: 10.5, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2,
      }}>{label}</div>
      <div style={{
        color: color ?? T.text, fontSize: 13, fontWeight: 500,
        fontFamily: mono ? FONT_MONO : FONT_SANS,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value}</div>
    </div>
  );
}

// ── Кнопка действия ───────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'danger' | 'success' | 'warn' | 'info' | 'neutral';

function ActionBtn({
  onClick, disabled, children, variant = 'neutral', fullWidth,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  variant?: BtnVariant;
  fullWidth?: boolean;
}) {
  const variants: Record<BtnVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: T.accent,      fg: '#fff',      border: T.accent },
    danger:  { bg: T.dangerSoft,  fg: T.danger,    border: T.danger + '33' },
    success: { bg: T.successSoft, fg: T.success,   border: T.success + '33' },
    warn:    { bg: T.warnSoft,    fg: T.warn,      border: T.warn + '33' },
    info:    { bg: T.infoSoft,    fg: T.info,      border: T.info + '33' },
    neutral: { bg: T.surface,     fg: T.textMuted, border: T.border },
  };
  const v = variants[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? T.surfaceAlt : v.bg,
        color: disabled ? T.textFaint : v.fg,
        border: `1px solid ${disabled ? T.border : v.border}`,
        borderRadius: 10, padding: '9px 13px',
        fontSize: 13, fontWeight: 600, letterSpacing: 0.1,
        cursor: disabled ? 'default' : 'pointer',
        flex: fullWidth ? '1 1 0' : '0 0 auto',
        whiteSpace: 'nowrap', minHeight: 38,
        opacity: disabled ? 0.6 : 1,
        fontFamily: FONT_SANS,
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {children}
    </button>
  );
}

// ── Карточка пользователя ─────────────────────────────────────────────────────
function UserCard({
  user, actioning, onAction, expanded, onToggle, availableSubjects, onCopy,
}: {
  user: User;
  actioning: string | null;
  onAction: (tgId: string, action: Action, subjectId?: string, enabled?: boolean, reason?: string, section?: string) => void;
  expanded: boolean;
  onToggle: () => void;
  availableSubjects: SubjectInfo[];
  onCopy: (text: string, label: string) => void;
}) {
  const busy        = actioning === user.tgId;
  const name        = displayName(user);
  const hasFullKey  = user.activatedKey && user.activatedKey !== 'trial' && user.activatedKey !== 'preview' && !String(user.activatedKey).startsWith('promo:');
  const isTrial     = user.activatedKey === 'trial';
  const isChannelGrant = !!user.previewConfirmedAt && user.subjects.length > 0;
  const isPreviewKey = (user.activatedKey === 'preview' || String(user.activatedKey || '').startsWith('promo:'))
    && !user.previewConfirmedAt;
  const previewSubjectLabel = user.previewChosenSubject
    ? (availableSubjects.find(s => s.id === user.previewChosenSubject)?.label || user.previewChosenSubject)
    : null;
  const adminModules = (user.previewDisplayModules?.length
    ? user.previewDisplayModules
    : user.previewChosenModules) as PreviewModule[] | null | undefined;
  const previewModulesLabel = adminModules?.length
    ? adminModules.map(m =>
        m === 'questions' ? 'Вопросы' : m === 'tests' ? 'Тесты' : m === 'tasks' ? 'Задачи' : m,
      ).join(', ')
    : null;
  const previewRequestLabel = previewSubjectLabel
    ? (previewModulesLabel ? `${previewSubjectLabel} — ${previewModulesLabel}` : previewSubjectLabel)
    : null;
  const facultyLabel = user.facultyDisplayLabel
    ?? (user.previewFaculty
      ? user.previewFaculty.replace(/\s+факультет$/i, '')
      : null);
  const facultyCode = user.facultyDisplayCode ?? user.promoCode;
  const facultyIcon = user.facultyIcon ?? null;

  // «Новенький» — регистрация менее 24 ч назад
  const isFresh = !!user.registeredAt &&
    (Date.now() - Date.parse(user.registeredAt) < 24 * 3600 * 1000);

  const statusColor = user.blocked ? T.danger
    : user.suspicious ? T.warn
    : isFresh ? T.info
    : T.success;
  const avatarBg    = user.blocked ? T.dangerSoft
    : user.suspicious ? T.warnSoft
    : isFresh ? T.infoSoft
    : T.accentSoft;
  const avatarFg    = user.blocked ? T.danger
    : user.suspicious ? T.warn
    : isFresh ? T.info
    : T.accent;

  // Модалка причины блокировки
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [contactDraft, setContactDraft] = useState(user.contactUsername || '');
  const [contactError, setContactError] = useState('');
  const [groupDraft, setGroupDraft] = useState('');
  const [groupError, setGroupError] = useState('');

  useEffect(() => {
    setContactDraft(user.contactUsername || '');
    setContactError('');
  }, [user.contactUsername, user.tgId]);

  // Long-press на ID → копировать
  const pressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = React.useRef(false);
  const startPress = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      onCopy(user.tgId, 'ID скопирован');
    }, 550);
  };
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const onIdClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // не разворачивать карточку
    if (longPressed.current) {
      longPressed.current = false; // только что был long-press, клик игнорируем
    }
  };

  const tgChatHref = getTgChatHref(user.tgId, user.username, user.contactUsername);
  const tgChatLabel = formatTgChatLabel(user.username, user.contactUsername);

  const saveContactUsername = () => {
    const raw = contactDraft.trim();
    if (!raw) {
      setContactError('');
      onAction(user.tgId, 'set_contact_username', undefined, undefined, '');
      return;
    }
    const handle = normalizeTelegramUsername(raw);
    if (!isValidTelegramUsername(handle)) {
      setContactError('5–32 символа, латиница, цифры и _');
      return;
    }
    setContactError('');
    onAction(user.tgId, 'set_contact_username', undefined, undefined, handle);
  };

  const saveStudyGroup = () => {
    const digits = groupDraft.trim();
    if (!/^\d{2,4}$/.test(digits)) {
      setGroupError('Только цифры группы, например 108');
      return;
    }
    setGroupError('');
    onAction(user.tgId, 'set_study_group', undefined, undefined, digits);
    setGroupDraft('');
  };

  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${user.blocked ? T.danger + '33' : user.suspicious ? T.warn + '33' : T.border}`,
      borderRadius: 14, overflow: 'hidden',
      boxShadow: expanded ? `0 6px 20px ${T.text}0F` : 'none',
      position: 'relative',
    }}>
      {/* статус-полоска слева */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        background: statusColor,
      }} />

      {/* шапка */}
      <div
        onClick={onToggle}
        style={{
          padding: '12px 14px 12px 16px',
          display: 'flex', alignItems: 'flex-start', gap: 11,
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <div style={{
          width: 38, height: 38, borderRadius: '50%',
          background: avatarBg, color: avatarFg,
          fontWeight: 700, fontSize: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, letterSpacing: 0.2,
        }}>{initials(user)}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
          }}>
            <div style={{
              fontSize: 14.5, fontWeight: 600, color: T.text,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              flex: 1, minWidth: 0,
            }}>{name}</div>
            {user.blocked && <Chip bg={T.dangerSoft} color={T.danger}>blocked</Chip>}
            {!user.blocked && user.suspicious && <Chip bg={T.warnSoft} color={T.warn}>подозр</Chip>}
            {!user.blocked && !user.suspicious && isFresh && <Chip bg={T.infoSoft} color={T.info}>🆕 new</Chip>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span
              onMouseDown={startPress}
              onMouseUp={cancelPress}
              onMouseLeave={cancelPress}
              onTouchStart={startPress}
              onTouchEnd={cancelPress}
              onTouchCancel={cancelPress}
              onClick={onIdClick}
              title="Удерживай, чтобы скопировать"
              style={{
                fontFamily: FONT_MONO, fontSize: 11,
                color: T.textFaint, letterSpacing: 0.2,
                cursor: 'copy', userSelect: 'none',
                padding: '1px 4px', margin: '-1px -4px',
                borderRadius: 4,
                WebkitTapHighlightColor: 'transparent',
              }}
            >id {user.tgId}</span>
            {!user.username && user.contactUsername && (
              <Chip bg={T.infoSoft} color={T.info}>@{user.contactUsername}</Chip>
            )}
            {hasFullKey && (
              <Chip bg={T.accentSoft} color={T.accent}>ключ</Chip>
            )}
            {isChannelGrant && !hasFullKey && (
              <Chip bg={T.purpleSoft} color={T.purple}>канал</Chip>
            )}
            {facultyLabel && (
              <Chip bg={T.successSoft} color={T.success}>
                {facultyIcon ? `${facultyIcon} ` : ''}{facultyCode ? `${facultyCode} · ` : ''}{facultyLabel}
              </Chip>
            )}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onAction(user.tgId, 'toggle_paid'); }}
              disabled={busy}
              title={user.paid ? 'Нажми, чтобы снять отметку оплаты' : 'Нажми, чтобы отметить как оплачено'}
              style={{
                padding: 0,
                border: 'none',
                background: 'transparent',
                cursor: busy ? 'default' : 'pointer',
                flexShrink: 0,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <Chip
                bg={user.paid ? T.successSoft : T.warnSoft}
                color={user.paid ? T.success : T.warn}
              >
                {user.paid ? '💲 оплачено' : 'не оплачено'}
              </Chip>
            </button>
            {isTrial    && <Chip bg={T.warnSoft}   color={T.warn}>trial</Chip>}
            {isPreviewKey && <Chip bg={T.purpleSoft} color={T.purple}>пробный</Chip>}
            {user.receiptClaimedAt && user.previewNeedsConfirm && (
              <Chip bg={T.purpleSoft} color={T.purple}>чек скинул</Chip>
            )}
            {user.previewStatus === 'expired' && previewSubjectLabel && (
              <Chip bg={T.purpleSoft} color={T.purple}>→ {previewSubjectLabel}</Chip>
            )}
            {user.previewIsAddon && (user.previewStatus === 'expired' || user.previewStatus === 'active') && (
              <Chip bg={T.infoSoft} color={T.info}>
                докупка{previewSubjectLabel
                  ? ` · ${previewSubjectLabel}${previewModulesLabel ? ` — ${previewModulesLabel}` : ''}`
                  : ''}
              </Chip>
            )}
            {user.previewStatus === 'selecting' && (
              <Chip bg={T.infoSoft} color={T.info}>выбирает</Chip>
            )}
              {user.previewStatus === 'active' && previewSubjectLabel && (
              <Chip bg={T.warnSoft} color={T.warn}>сессия · {previewSubjectLabel}</Chip>
            )}
            {availableSubjects
              .filter(s => s.id !== 'ortho' && user.subjects.includes(s.id))
              .map(s => (
                <Chip key={s.id} bg={T.successSoft} color={T.success}>{s.shortLabel}</Chip>
              ))}
            {user.usedDemo && !user.previewStatus && <Chip bg={T.purpleSoft} color={T.purple}>демо</Chip>}
            {user.opensToday >= 3 && (
              <Chip
                bg={user.opensToday >= 5 ? T.dangerSoft : T.warnSoft}
                color={user.opensToday >= 5 ? T.danger : T.warn}
              >
                {user.opensToday} откр
              </Chip>
            )}
          </div>
        </div>

        <span style={{
          color: T.textFaint, fontSize: 13, alignSelf: 'center',
          transform: expanded ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s',
          display: 'inline-block', flexShrink: 0,
        }}>▾</span>
      </div>

      {/* раскрытое */}
      {expanded && (
        <div style={{
          borderTop: `1px solid ${T.border}`,
          background: T.surfaceAlt,
          padding: '14px 16px 16px',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px',
          }}>
            <Meta label="Зарегистрирован" value={fmtDate(user.registeredAt)} mono />
            <Meta
              label="Последний вход"
              value={fmtDate(user.lastActivityAt || user.lastLogin)}
              mono
            />
            {user.loginCount > 0 && (
              <Meta label="Всего входов" value={String(user.loginCount)} />
            )}
            {user.activatedKey && (
              <Meta label="Ключ"
                value={
                  user.activatedKey === 'trial' ? 'триал'
                    : user.activatedKey === 'preview' ? 'пробный'
                    : String(user.activatedKey).startsWith('promo:') ? 'код канала'
                    : `···${user.activatedKey.slice(-4)}`
                }
                mono />
            )}
            {previewRequestLabel && (
              <Meta label={user.previewIsAddon ? 'Докупка' : 'Заявка'} value={previewRequestLabel} color={T.purple} />
            )}
            {user.previewIsAddon && previewModulesLabel && !previewRequestLabel && previewSubjectLabel && (
              <Meta label="Докупка" value={`${previewSubjectLabel} — ${previewModulesLabel}`} color={T.purple} />
            )}
            {user.previewQuotedPrice != null && (
              <Meta label="Сумма" value={formatPriceRub(user.previewQuotedPrice)} color={T.purple} />
            )}
            {user.receiptClaimedAt && (
              <Meta label="Чек" value="студент нажал «Скинул»" color={T.purple} />
            )}
            {user.previewIsAddon && previewModulesLabel && !user.receiptClaimedAt
              && (user.previewStatus === 'expired' || user.previewStatus === 'active') && (
              <Meta
                label="Ожидание"
                value="студент ещё не нажал «войти» — кнопки дать/отказ появятся после чека"
                color={T.warn}
              />
            )}
            {previewSubjectLabel && !previewModulesLabel && (
              <Meta label="Выбор (пробный)" value={previewSubjectLabel} color={T.purple} />
            )}
            {user.promoCode && (
              <Meta label="Код канала" value={user.promoCode} mono />
            )}
            {facultyLabel && (
              <Meta
                label="Факультет"
                value={`${facultyIcon ? `${facultyIcon} ` : ''}${facultyCode ? `${facultyCode} · ` : ''}${facultyLabel}`}
                color={T.success}
              />
            )}
            {user.studyGroup && (
              <Meta label="Группа" value={user.studyGroup} mono />
            )}
            {!facultyLabel && user.previewFaculty && (
              <Meta label="Факультет" value={user.previewFaculty} />
            )}
            <Meta
              label="Оплата"
              value={user.paid ? 'оплачено' : 'не оплачено'}
              color={user.paid ? T.success : T.warn}
            />
            {user.previewStatus && (
              <Meta label="Статус пробного"
                value={
                  user.previewStatus === 'selecting' ? 'выбирает предмет'
                    : user.previewStatus === 'active' ? 'идёт пробный период'
                    : user.previewStatus === 'expired' ? 'ждёт подтверждения'
                    : 'подтверждён'
                }
                color={user.previewStatus === 'expired' ? T.purple : T.textMuted}
              />
            )}
            <Meta label="Открытий сегодня" value={String(user.opensToday)}
              color={user.opensToday >= 5 ? T.danger : user.opensToday >= 3 ? T.warn : undefined} />
            {user.blocked && (
              <Meta label="Заблокирован" value={fmtDate(user.blockedAt)} color={T.danger} />
            )}
            {user.blocked && user.blockedReason && user.blockedReason !== 'manual' && (
              <div style={{ gridColumn: '1 / -1' }}>
                <Meta label="Причина блокировки" value={user.blockedReason} color={T.danger} />
              </div>
            )}
          </div>

          {/* доступ к предметам */}
          <div>
            <div style={{
              fontSize: 11, color: T.textMuted, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
            }}>Доступ к предметам</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {availableSubjects.map(s => {
                const enabled = user.subjects.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => onAction(user.tgId, 'toggle_subject', s.id, !enabled)}
                    disabled={busy}
                    style={{
                      padding: '7px 12px', borderRadius: 10,
                      fontSize: 12.5, fontWeight: 600,
                      border: `1px solid ${enabled ? T.success + '55' : T.border}`,
                      background: enabled ? T.successSoft : T.surface,
                      color: enabled ? T.success : T.textMuted,
                      cursor: busy ? 'default' : 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontFamily: FONT_SANS, opacity: busy ? 0.6 : 1,
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <span style={{
                      width: 14, height: 14, borderRadius: 4,
                      background: enabled ? T.success : T.chipBg,
                      color: '#fff', fontSize: 10, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      lineHeight: 1,
                    }}>{enabled ? '✓' : ''}</span>
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* разделы навигации (per-subject, только для доступных предметов) */}
          {user.subjects.length > 0 && (
            <div>
              <div style={{
                fontSize: 11, color: T.textMuted, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
              }}>Разделы навигации</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {availableSubjects
                  .filter(s => user.subjects.includes(s.id))
                  .map(subj => {
                    const hidden = new Set<string>((user.navHidden ?? {})[subj.id] || []);
                    return (
                      <div key={subj.id} style={{
                        background: T.surface, border: `1px solid ${T.border}`,
                        borderRadius: 10, padding: '8px 10px',
                      }}>
                        <div style={{
                          fontSize: 12, fontWeight: 600, color: T.text,
                          marginBottom: 6,
                        }}>{subj.shortLabel}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {NAV_SECTIONS.map(sec => {
                            const enabled = !hidden.has(sec.id);
                            return (
                              <button
                                key={sec.id}
                                onClick={() => onAction(user.tgId, 'toggle_section', subj.id, !enabled, undefined, sec.id)}
                                disabled={busy}
                                style={{
                                  padding: '5px 10px', borderRadius: 8,
                                  fontSize: 12, fontWeight: 600,
                                  border: `1px solid ${enabled ? T.accent + '55' : T.border}`,
                                  background: enabled ? T.accentSoft : T.surfaceAlt,
                                  color: enabled ? T.accent : T.textFaint,
                                  cursor: busy ? 'default' : 'pointer',
                                  display: 'inline-flex', alignItems: 'center', gap: 5,
                                  fontFamily: FONT_SANS, opacity: busy ? 0.6 : 1,
                                  textDecoration: enabled ? 'none' : 'line-through',
                                  WebkitTapHighlightColor: 'transparent',
                                }}
                              >
                                <span style={{
                                  width: 12, height: 12, borderRadius: 3,
                                  background: enabled ? T.accent : T.chipBg,
                                  color: '#fff', fontSize: 9, fontWeight: 700,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  lineHeight: 1,
                                }}>{enabled ? '✓' : ''}</span>
                                {sec.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {!user.username && (
            <div style={{
              background: T.surface, border: `1px solid ${T.border}`,
              borderRadius: 10, padding: '10px 12px',
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 8, letterSpacing: 0.3 }}>
                КОНТАКТ В TELEGRAM
              </div>
              <div style={{ fontSize: 12, color: T.textFaint, marginBottom: 8, lineHeight: 1.45 }}>
                У пользователя нет @username в профиле. Укажи его вручную — кнопка «Написать» откроет чат.
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                <input
                  value={contactDraft}
                  onChange={e => { setContactDraft(e.target.value); setContactError(''); }}
                  onClick={e => e.stopPropagation()}
                  placeholder="@username"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  style={{
                    flex: 1, minWidth: 0,
                    background: T.surfaceAlt, color: T.text,
                    border: `1px solid ${contactError ? T.danger + '66' : T.border}`,
                    borderRadius: 8, padding: '8px 10px',
                    fontSize: 13, fontFamily: FONT_MONO,
                    outline: 'none',
                  }}
                />
                <ActionBtn
                  variant={user.contactUsername && normalizeTelegramUsername(contactDraft) === user.contactUsername ? 'neutral' : 'primary'}
                  disabled={busy}
                  onClick={saveContactUsername}
                >
                  {busy ? '...' : 'Сохранить'}
                </ActionBtn>
              </div>
              {contactError && (
                <div style={{ fontSize: 11.5, color: T.danger, marginTop: 6 }}>{contactError}</div>
              )}
              {user.contactUsername && !contactError && (
                <div style={{ fontSize: 11.5, color: T.success, marginTop: 6 }}>
                  Привязан @{user.contactUsername}
                </div>
              )}
            </div>
          )}

          {user.studyGroup && (
            <div style={{
              background: T.surface, border: `1px solid ${T.border}`,
              borderRadius: 10, padding: '10px 12px',
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 8, letterSpacing: 0.3 }}>
                ГРУППА · {user.studyGroup}
              </div>
              <div style={{ fontSize: 12, color: T.textFaint, marginBottom: 8, lineHeight: 1.45 }}>
                Студент сам сменить группу не может — она закрепляется при первом вводе. Буква факультета добавится сама.
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                <input
                  value={groupDraft}
                  onChange={e => { setGroupDraft(e.target.value); setGroupError(''); }}
                  onClick={e => e.stopPropagation()}
                  placeholder="108"
                  inputMode="numeric"
                  style={{
                    flex: 1, minWidth: 0,
                    background: T.surfaceAlt, color: T.text,
                    border: `1px solid ${groupError ? T.danger + '66' : T.border}`,
                    borderRadius: 8, padding: '8px 10px',
                    fontSize: 13, fontFamily: FONT_MONO,
                    outline: 'none',
                  }}
                />
                <ActionBtn variant="primary" disabled={busy || !groupDraft.trim()} onClick={saveStudyGroup}>
                  {busy ? '...' : 'Сменить'}
                </ActionBtn>
              </div>
              {groupError && (
                <div style={{ fontSize: 11.5, color: T.danger, marginTop: 6 }}>{groupError}</div>
              )}
            </div>
          )}

          {/* действия */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {user.blocked ? (
              <ActionBtn variant="success" disabled={busy} fullWidth
                onClick={() => onAction(user.tgId, 'unblock')}>
                {busy ? '...' : 'Разблокировать'}
              </ActionBtn>
            ) : (
              <ActionBtn variant="danger" disabled={busy} fullWidth
                onClick={() => { setBlockReason(''); setBlockOpen(true); }}>
                {busy ? '...' : 'Заблокировать'}
              </ActionBtn>
            )}
            {(user.previewStatus || user.receiptClaimedAt
              || (user.previewChosenSubject && !user.previewConfirmedAt)) && (
              <ActionBtn variant="success" disabled={busy} fullWidth
                onClick={() => onAction(user.tgId, 'grant_direct_access')}>
                {busy ? '...' : '✓ Открыть доступ (без пробника)'}
              </ActionBtn>
            )}
            {user.previewNeedsConfirm && user.previewChosenSubject && (
              (user.previewPendingModules && user.previewPendingModules.length > 0
                ? user.previewPendingModules
                : (adminModules || [])
              ).map(mod => (
                <React.Fragment key={mod}>
                  <ActionBtn variant="success" disabled={busy} fullWidth
                    onClick={() => onAction(user.tgId, 'confirm_preview_module', undefined, undefined, undefined, mod)}>
                    {busy ? '...' : `✓ ${formatAdminModuleLabel(user.previewChosenSubject!, mod)}`}
                  </ActionBtn>
                  <ActionBtn variant="danger" disabled={busy} fullWidth
                    onClick={() => onAction(user.tgId, 'reject_preview_module', undefined, undefined, undefined, mod)}>
                    {busy ? '...' : `✕ ${formatAdminModuleLabel(user.previewChosenSubject!, mod)}`}
                  </ActionBtn>
                </React.Fragment>
              ))
            )}
            {user.receiptClaimedAt && user.previewNeedsConfirm && (
              <ActionBtn variant="warn" disabled={busy} fullWidth
                onClick={() => onAction(user.tgId, 'reopen_preview_vitrine')}>
                {busy ? '...' : '↩ Вернуть на витрину (оплаты нет)'}
              </ActionBtn>
            )}
            {user.usedDemo && (
              <ActionBtn variant="warn" disabled={busy} fullWidth
                onClick={() => onAction(user.tgId, 'reset_demo')}>
                {busy ? '...' : 'Сбросить пробный доступ'}
              </ActionBtn>
            )}
            <ActionBtn variant="warn" disabled={busy} fullWidth
              onClick={() => onAction(user.tgId, 'force_payment_only')}>
              {busy ? '...' : '💳 Только оплата'}
            </ActionBtn>
            <button
              type="button"
              style={{
                background: T.infoSoft, color: T.info,
                border: `1px solid ${T.info}33`,
                borderRadius: 10, padding: '9px 13px',
                fontSize: 13, fontWeight: 600, letterSpacing: 0.1,
                minHeight: 38,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                flex: '1 1 0', whiteSpace: 'nowrap',
                fontFamily: FONT_SANS, cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
              onClick={e => { e.stopPropagation(); openTgChat(tgChatHref); }}
            >
              ✉ {tgChatLabel}
            </button>
          </div>

          {/* удаление навсегда */}
          <button
            onClick={() => setDeleteOpen(true)}
            disabled={busy}
            style={{
              marginTop: 8, width: '100%',
              background: 'transparent', color: T.danger,
              border: `1px dashed ${T.danger}66`,
              borderRadius: 10, padding: '9px',
              fontSize: 12.5, fontWeight: 600, letterSpacing: 0.1,
              cursor: busy ? 'default' : 'pointer',
              fontFamily: FONT_SANS, opacity: busy ? 0.5 : 1,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            🗑 Удалить пользователя навсегда
          </button>
        </div>
      )}

      {/* ─── Модалка причины блокировки ─── */}
      {blockOpen && (
        <div
          onClick={e => { e.stopPropagation(); setBlockOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(31,27,20,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 18, backdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: T.surface, borderRadius: 16,
              border: `1px solid ${T.border}`,
              padding: 18, width: '100%', maxWidth: 380,
              boxShadow: `0 20px 60px ${T.text}30`,
              fontFamily: FONT_SANS,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 4 }}>
              Заблокировать пользователя
            </div>
            <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 14 }}>
              {name}
            </div>
            <label style={{
              fontSize: 11, fontWeight: 600, color: T.textMuted,
              textTransform: 'uppercase', letterSpacing: 0.5,
              display: 'block', marginBottom: 6,
            }}>Причина (необязательно)</label>
            <textarea
              value={blockReason}
              onChange={e => setBlockReason(e.target.value.slice(0, 200))}
              autoFocus
              placeholder="Например: 2 аккаунта с одной IP / просил вернуть деньги без оснований…"
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '10px 12px', borderRadius: 10,
                border: `1px solid ${T.border}`,
                background: T.surfaceAlt, color: T.text,
                fontSize: 14, fontFamily: FONT_SANS,
                outline: 'none', resize: 'none',
              }}
            />
            <div style={{
              fontSize: 11, color: T.textFaint,
              textAlign: 'right', marginTop: 4, marginBottom: 14,
            }}>{blockReason.length}/200</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <ActionBtn variant="neutral" fullWidth onClick={() => setBlockOpen(false)}>
                Отмена
              </ActionBtn>
              <ActionBtn
                variant="danger"
                fullWidth
                disabled={busy}
                onClick={() => {
                  setBlockOpen(false);
                  onAction(user.tgId, 'block', undefined, undefined, blockReason.trim() || undefined);
                }}
              >
                Заблокировать
              </ActionBtn>
            </div>
          </div>
        </div>
      )}

      {/* ─── Модалка подтверждения удаления ─── */}
      {deleteOpen && (
        <div
          onClick={e => { e.stopPropagation(); setDeleteOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(31,27,20,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 18, backdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: T.surface, borderRadius: 16,
              border: `1px solid ${T.border}`,
              padding: 18, width: '100%', maxWidth: 380,
              boxShadow: `0 20px 60px ${T.text}30`,
              fontFamily: FONT_SANS,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: T.danger, marginBottom: 4 }}>
              Удалить пользователя навсегда?
            </div>
            <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 6 }}>
              {name}
            </div>
            <div style={{ fontSize: 12.5, color: T.text, marginBottom: 14, lineHeight: 1.5 }}>
              Все данные пользователя будут <b>безвозвратно стёрты</b> из базы:
              доступы, прогресс, история. Карточка исчезнет из админки.
              Действие необратимо.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <ActionBtn variant="neutral" fullWidth onClick={() => setDeleteOpen(false)}>
                Отмена
              </ActionBtn>
              <ActionBtn
                variant="danger"
                fullWidth
                disabled={busy}
                onClick={() => {
                  setDeleteOpen(false);
                  onAction(user.tgId, 'delete_user');
                }}
              >
                Удалить навсегда
              </ActionBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stat-плитка ───────────────────────────────────────────────────────────────
function StatTile({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 12, padding: '12px 10px',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: 24, fontWeight: 700, color: T.text,
          letterSpacing: -0.5, lineHeight: 1, fontFamily: FONT_SANS,
        }}>{value}</span>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', background: accent,
          display: 'inline-block',
        }} />
      </div>
      <div style={{
        color: T.textMuted, fontSize: 11, fontWeight: 500,
        textTransform: 'uppercase', letterSpacing: 0.4,
      }}>{label}</div>
    </div>
  );
}

// ── Главный компонент ─────────────────────────────────────────────────────────
export default function AdminPage() {
  useFonts();
  useAdminScroll();

  const [topInset, setTopInset] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp as any;
    if (!tg) return;

    tg.expand?.();
    tg.requestFullscreen?.();
    tg.enableClosingConfirmation?.();
    tg.disableVerticalSwipes?.();
    tg.BackButton?.hide?.();

    // contentSafeAreaInset.top обновляется ПОСЛЕ fullscreenChanged — слушаем его
    const readInset = () => {
      const safe    = (tg.safeAreaInset?.top        ?? 0) as number;
      const content = (tg.contentSafeAreaInset?.top ?? 0) as number;
      // Минимум 52px — высота кнопки закрытия TG в fullscreen
      setTopInset(Math.max(safe + content, 52));
    };

    tg.onEvent?.('fullscreenChanged',  readInset);
    tg.onEvent?.('viewportChanged',    readInset);
    tg.onEvent?.('safeAreaChanged',    readInset);

    // Попытки прочитать сразу и с задержками (TG может не сразу отдать значения)
    readInset();
    const t1 = setTimeout(readInset, 200);
    const t2 = setTimeout(readInset, 700);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      tg.offEvent?.('fullscreenChanged', readInset);
      tg.offEvent?.('viewportChanged',   readInset);
      tg.offEvent?.('safeAreaChanged',   readInset);
    };
  }, []);

  const [secret,             setSecret]             = useState('');
  const [authed,             setAuthed]             = useState(false);
  const [adminTab,           setAdminTab]           = useState<AdminTab>('students');
  const [users,              setUsers]              = useState<User[]>([]);
  const [availableSubjects,  setAvailableSubjects]  = useState<SubjectInfo[]>([]);
  const [loading,            setLoading]            = useState(false);
  const [refreshing,         setRefreshing]         = useState(false);
  const [page,               setPage]               = useState(1);
  const [hasMore,            setHasMore]            = useState(false);
  const [filter,             setFilter]             = useState<Filter>('all');
  const [sortBy,             setSortBy]             = useState<SortBy>('lastActivity');
  const [registeredAsc,      setRegisteredAsc]      = useState(false);
  const [search,             setSearch]             = useState('');
  const [debouncedSearch,    setDebouncedSearch]    = useState('');
  const [error,              setError]              = useState('');
  const [total,              setTotal]              = useState(0);
  const [demoCount,          setDemoCount]          = useState(0);
  const [blockedCount,       setBlockedCount]       = useState(0);
  const [unpaidCount,        setUnpaidCount]        = useState(0);
  const [suspiciousCount,    setSuspiciousCount]    = useState(0);
  const [microCount,         setMicroCount]         = useState(0);
  const [filteredTotal,      setFilteredTotal]      = useState(0);
  const [actioning,          setActioning]          = useState<string | null>(null);
  const [toast,              setToast]              = useState<string | null>(null);
  // expandedIds восстанавливаются из sessionStorage, чтобы после ↻ refresh карточки не схлопывались
  const expandedIdsRef = useRef<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const saved = sessionStorage.getItem('admin_expanded_ids');
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  // Debounce строки поиска (200ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  // Сохраняем раскрытые карточки в sessionStorage при каждом изменении
  useEffect(() => {
    expandedIdsRef.current = expandedIds;
    try {
      sessionStorage.setItem('admin_expanded_ids', JSON.stringify([...expandedIds]));
    } catch { /* private mode / quota */ }
  }, [expandedIds]);

  // ── Глоссарий (кастомные записи) ─────────────────────────────────────────
  const [glExpanded,    setGlExpanded]    = useState(false);
  const [glSubject,     setGlSubject]     = useState('');
  const [glEntries,     setGlEntries]     = useState<{ id: string; term: string; definition: string; image?: string }[]>([]);
  const [glLoading,     setGlLoading]     = useState(false);
  const [glDeleting,    setGlDeleting]    = useState<string | null>(null);
  const [glAdding,      setGlAdding]      = useState(false);
  const [glForm,        setGlForm]        = useState({ term: '', definition: '', image: '' });

  // ── Связанные термины (relatedTerms) ──────────────────────────────────────
  const [rtExpanded,    setRtExpanded]    = useState(false);
  const [rtSubject,     setRtSubject]     = useState('');
  const [rtType,        setRtType]        = useState<'questions' | 'tests' | 'tasks'>('questions');
  const [rtItems,       setRtItems]       = useState<{ id: string; preview: string; relatedTerms: string[] }[]>([]);
  const [rtLoading,     setRtLoading]     = useState(false);
  const [rtSearch,      setRtSearch]      = useState('');
  const [rtSelectedId,  setRtSelectedId]  = useState<string | null>(null);
  const [rtTerms,       setRtTerms]       = useState<string[]>([]);
  const [rtSaving,      setRtSaving]      = useState(false);
  const [rtNewTerm,     setRtNewTerm]     = useState('');
  const [rtBusting,     setRtBusting]     = useState(false);

  // ── Блокировки входа (rate-limit) ─────────────────────────────────────────
  const [rateBlocks,         setRateBlocks]         = useState<RateBlock[]>([]);
  const [rateBlocksLoading,  setRateBlocksLoading]  = useState(false);
  const [rateBlocksExpanded, setRateBlocksExpanded] = useState(false);
  const [clearingTgId,       setClearingTgId]       = useState<string | null>(null);

  const [keysOpen,    setKeysOpen]    = useState(false);
  const [keysList,    setKeysList]    = useState<string[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);

  // ── Белый список (обход проверки подписки) ────────────────────────────────
  const [wlExpanded,   setWlExpanded]   = useState(false);
  const [wlItems,      setWlItems]      = useState<string[]>([]);
  const [wlLoading,    setWlLoading]    = useState(false);
  const [wlInput,      setWlInput]      = useState('');
  const [wlAdding,     setWlAdding]     = useState(false);
  const [wlRemoving,   setWlRemoving]   = useState<string | null>(null);

  const [isPaidKeysEnabled, setIsPaidKeysEnabled] = useState(true);
  const [isPaidKeysLoading, setIsPaidKeysLoading] = useState(false);
  const [demoResetTgId, setDemoResetTgId] = useState('');
  const [demoResetLoading, setDemoResetLoading] = useState(false);
  const [giftBioTasksLoading, setGiftBioTasksLoading] = useState(false);

  const [facultyStatsExpanded, setFacultyStatsExpanded] = useState(false);
  const [facultyStatsLoading, setFacultyStatsLoading] = useState(false);
  const [facultyStats, setFacultyStats] = useState<{
    total: number;
    stomatology: number;
    pediatrics: number;
    therapeutic: number;
    unknown: number;
    computedAt: string;
    nextRefreshAt: string;
  } | null>(null);

  const [previewCatalogExpanded, setPreviewCatalogExpanded] = useState(false);
  const [previewCatalog, setPreviewCatalog] = useState<PreviewCatalogSettings>({});
  const [previewCatalogBase, setPreviewCatalogBase] = useState<PreviewCatalogBaseEntry[]>([]);
  const [previewCatalogEffective, setPreviewCatalogEffective] = useState<
    Record<string, { open: boolean; modules: Record<PreviewModKind, boolean> }>
  >({});
  const [previewCatalogSaving, setPreviewCatalogSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin-config')
      .then(res => res.json())
      .then(data => {
        if (typeof data.isPaidKeysEnabled === 'boolean') setIsPaidKeysEnabled(data.isPaidKeysEnabled);
        if (Array.isArray(data.previewCatalogBase)) setPreviewCatalogBase(data.previewCatalogBase);
        if (data.previewCatalog && typeof data.previewCatalog === 'object') {
          setPreviewCatalog(data.previewCatalog as PreviewCatalogSettings);
        }
        if (data.previewCatalogEffective && typeof data.previewCatalogEffective === 'object') {
          setPreviewCatalogEffective(data.previewCatalogEffective);
        }
      })
      .catch(err => console.error('Ошибка загрузки конфига:', err));
  }, []);

  const togglePaidKeys = async () => {
    const initData = getTelegramInitData();
    if (!initData) { showToast('Нет доступа: не в Telegram'); return; }

    setIsPaidKeysLoading(true);
    try {
      const newValue = !isPaidKeysEnabled;
      const res = await fetch('/api/admin-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body: JSON.stringify({ isPaidKeysEnabled: newValue, initData, secret }),
      });
      if (res.ok) {
        setIsPaidKeysEnabled(newValue);
        showToast(newValue ? '✓ 8-значные ключи включены' : '8-значные ключи отключены');
      } else if (res.status === 403) {
        showToast('Нет прав');
      } else {
        showToast('Ошибка при переключении');
      }
    } catch {
      showToast('Ошибка сети');
    } finally {
      setIsPaidKeysLoading(false);
    }
  };

  const applyPreviewCatalogResponse = (data: Record<string, unknown>) => {
    if (data.previewCatalog && typeof data.previewCatalog === 'object') {
      setPreviewCatalog(data.previewCatalog as PreviewCatalogSettings);
    }
    if (Array.isArray(data.previewCatalogBase)) setPreviewCatalogBase(data.previewCatalogBase);
    if (data.previewCatalogEffective && typeof data.previewCatalogEffective === 'object') {
      setPreviewCatalogEffective(data.previewCatalogEffective as typeof previewCatalogEffective);
    }
  };

  const savePreviewCatalog = async (next: PreviewCatalogSettings, savingKey: string) => {
    const initData = getTelegramInitData();
    if (!initData) { showToast('Нет доступа: не в Telegram'); return; }

    setPreviewCatalogSaving(savingKey);
    try {
      const res = await fetch('/api/admin-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body: JSON.stringify({ previewCatalog: next, initData, secret }),
      });
      if (res.ok) {
        const data = await res.json();
        applyPreviewCatalogResponse(data);
        showToast('✓ Витрина обновлена');
      } else if (res.status === 403) {
        showToast('Нет прав');
      } else {
        showToast('Ошибка сохранения');
      }
    } catch {
      showToast('Ошибка сети');
    } finally {
      setPreviewCatalogSaving(null);
    }
  };

  const buildSubjectCatalogPatch = (
    subjectId: string,
    open: boolean,
    modules: Record<PreviewModKind, boolean>,
  ): PreviewCatalogSettings[string] | null => {
    const baseEntry = previewCatalogBase.find(s => s.id === subjectId);
    if (!baseEntry) return null;

    const entry: PreviewCatalogSettings[string] = {};
    if (!open) {
      entry.open = false;
      return entry;
    }

    const modOverrides: Partial<Record<PreviewModKind, boolean>> = {};
    for (const mod of baseEntry.modules) {
      if (!mod.available) continue;
      if (modules[mod.id] === false) modOverrides[mod.id] = false;
    }
    if (Object.keys(modOverrides).length) entry.modules = modOverrides;
    return Object.keys(entry).length ? entry : null;
  };

  const mergePreviewCatalog = (
    current: PreviewCatalogSettings,
    subjectId: string,
    patch: PreviewCatalogSettings[string] | null,
  ): PreviewCatalogSettings => {
    const next = { ...current };
    if (!patch) delete next[subjectId];
    else next[subjectId] = patch;
    return next;
  };

  const togglePreviewSubjectOpen = (subjectId: string) => {
    const effective = previewCatalogEffective[subjectId];
    const baseEntry = previewCatalogBase.find(s => s.id === subjectId);
    if (!effective || !baseEntry) return;

    const newOpen = !effective.open;
    const modules = { ...effective.modules };
    if (newOpen) {
      for (const mod of baseEntry.modules) {
        if (mod.available) modules[mod.id] = true;
      }
    }

    const patch = buildSubjectCatalogPatch(subjectId, newOpen, modules);
    const next = mergePreviewCatalog(previewCatalog, subjectId, patch);
    savePreviewCatalog(next, `subject:${subjectId}`);
  };

  const togglePreviewModule = (subjectId: string, modId: PreviewModKind) => {
    const effective = previewCatalogEffective[subjectId];
    const baseEntry = previewCatalogBase.find(s => s.id === subjectId);
    const baseMod = baseEntry?.modules.find(m => m.id === modId);
    if (!effective || !baseEntry || !baseMod?.available) return;

    const modules = { ...effective.modules };
    modules[modId] = !effective.modules[modId];

    const open = baseEntry.modules.some(
      m => m.available && modules[m.id],
    );
    const patch = buildSubjectCatalogPatch(subjectId, open, modules);
    const next = mergePreviewCatalog(previewCatalog, subjectId, patch);
    savePreviewCatalog(next, `module:${subjectId}:${modId}`);
  };

  const resetPreviewByTgId = async () => {
    const initData = getTelegramInitData();
    if (!initData) { showToast('Нет доступа: не в Telegram'); return; }

    const id = demoResetTgId.replace(/\D/g, '').trim();
    if (!id || id.length < 5) {
      showToast('Введи корректный Telegram ID');
      return;
    }
    setDemoResetLoading(true);
    try {
      const r = await fetch('/api/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body: JSON.stringify({ action: 'reset_demo', tgId: id, secret, initData }),
      });
      if (r.ok) {
        setDemoResetTgId('');
        showToast('✓ Сброшено: пробный доступ и блокировки входа');
      } else if (r.status === 403) {
        showToast('Нет прав — открой админку через Telegram');
      } else {
        showToast('Ошибка сброса');
      }
    } catch {
      showToast('Ошибка сети');
    } finally {
      setDemoResetLoading(false);
    }
  };

  const giftBioTasksToAll = async () => {
    const initData = getTelegramInitData();
    if (!initData) { showToast('Нет доступа: не в Telegram'); return; }
    if (!window.confirm(
      'Открыть «Задачи» по биологии всем, у кого уже есть тест?\n\n'
      + 'У кого задачи уже открыты — не затронуты.',
    )) return;

    setGiftBioTasksLoading(true);
    try {
      const r = await fetch('/api/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body: JSON.stringify({ action: 'gift_bio_tasks', secret, initData }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        showToast(`🎁 Задачи bio: обновлено ${data.updated ?? 0} из ${data.total ?? '?'}`);
      } else if (r.status === 403) {
        showToast('Нет прав — открой админку через Telegram');
      } else {
        showToast((data as { error?: string }).error || 'Ошибка раздачи');
      }
    } catch {
      showToast('Ошибка сети');
    } finally {
      setGiftBioTasksLoading(false);
    }
  };

  const fetchFacultyStats = useCallback(async (force = false) => {
    const initData = getTelegramInitData();
    if (!initData) { showToast('Нет доступа: не в Telegram'); return; }
    setFacultyStatsLoading(true);
    try {
      const r = await fetch('/api/admin-faculty-stats', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body:    JSON.stringify({ secret, initData, force }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.stats) {
        setFacultyStats(data.stats);
      } else if (r.status === 403) {
        showToast('Нет прав — открой админку через Telegram');
      } else {
        showToast((data as { error?: string }).error || 'Ошибка загрузки статистики');
      }
    } catch {
      showToast('Ошибка сети');
    } finally {
      setFacultyStatsLoading(false);
    }
  }, [secret]);

  const fetchRateBlocks = useCallback(async () => {
    setRateBlocksLoading(true);
    try {
      const r = await fetch('/api/admin-rate-blocks', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body:    JSON.stringify({ action: 'list', secret }),
      });
      if (r.ok) {
        const data = await r.json();
        setRateBlocks(data.blocks ?? []);
      }
    } catch {
      showToast('Ошибка загрузки блокировок');
    } finally {
      setRateBlocksLoading(false);
    }
  }, [secret]);

  const clearRateBlock = async (tgId: string) => {
    setClearingTgId(tgId);
    try {
      const r = await fetch('/api/admin-rate-blocks', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body:    JSON.stringify({ action: 'clear', tgId, secret }),
      });
      if (r.ok) {
        setRateBlocks(prev => prev.filter(b => b.tgId !== tgId));
        showToast('✓ Блокировка снята');
      } else {
        showToast('Ошибка снятия блокировки');
      }
    } catch {
      showToast('Ошибка сети');
    } finally {
      setClearingTgId(null);
    }
  };

  const fetchWhitelist = useCallback(async () => {
    setWlLoading(true);
    try {
      const r = await fetch('/api/admin-whitelist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body:    JSON.stringify({ action: 'list', secret }),
      });
      if (r.ok) {
        const data = await r.json();
        setWlItems(data.ids ?? []);
      }
    } catch {
      showToast('Ошибка загрузки белого списка');
    } finally {
      setWlLoading(false);
    }
  }, [secret]);

  const fetchValidKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      const r = await fetch('/api/admin-whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body: JSON.stringify({ action: 'list_keys', secret }),
      });
      const data = await r.json();
      if (data.ok) setKeysList((data.keys ?? []).sort());
      else showToast('Ошибка загрузки ключей');
    } catch {
      showToast('Ошибка загрузки ключей');
    } finally {
      setKeysLoading(false);
    }
  }, [secret]);

  const addToWhitelist = async () => {
    const id = wlInput.trim();
    if (!id) return;
    setWlAdding(true);
    try {
      const r = await fetch('/api/admin-whitelist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body:    JSON.stringify({ action: 'add', tgId: id, secret }),
      });
      if (r.ok) {
        setWlItems(prev => prev.includes(id) ? prev : [...prev, id]);
        setWlInput('');
        showToast('✓ ID добавлен в белый список');
      } else {
        showToast('Ошибка добавления');
      }
    } catch {
      showToast('Ошибка сети');
    } finally {
      setWlAdding(false);
    }
  };

  const removeFromWhitelist = async (id: string) => {
    setWlRemoving(id);
    try {
      const r = await fetch('/api/admin-whitelist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body:    JSON.stringify({ action: 'remove', tgId: id, secret }),
      });
      if (r.ok) {
        setWlItems(prev => prev.filter(x => x !== id));
        showToast('✓ ID удалён из белого списка');
      } else {
        showToast('Ошибка удаления');
      }
    } catch {
      showToast('Ошибка сети');
    } finally {
      setWlRemoving(null);
    }
  };

  const fetchRtItems = useCallback(async (subjId: string, typeVal: 'questions' | 'tests' | 'tasks') => {
    setRtLoading(true);
    setRtItems([]);
    setRtSelectedId(null);
    setRtTerms([]);
    try {
      const r = await fetch('/api/admin-related-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body: JSON.stringify({ action: 'load_items', subjectId: subjId, type: typeVal, secret }),
      });
      if (r.ok) { const d = await r.json(); setRtItems(d.items ?? []); }
      else showToast('Ошибка загрузки списка');
    } catch { showToast('Ошибка сети'); }
    finally { setRtLoading(false); }
  }, [secret]);

  const saveRtTerms = async (subjId: string, typeVal: string, itemId: string, terms: string[]) => {
    setRtSaving(true);
    try {
      const r = await fetch('/api/admin-related-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body: JSON.stringify({ action: 'set_terms', subjectId: subjId, type: typeVal, itemId, terms, secret }),
      });
      if (r.ok) {
        setRtItems(prev => prev.map(item =>
          item.id === itemId ? { ...item, relatedTerms: terms } : item
        ));
        showToast('✓ Термины сохранены');
      } else { showToast('Ошибка сохранения'); }
    } catch { showToast('Ошибка сети'); }
    finally { setRtSaving(false); }
  };

  const bustCache = async () => {
    setRtBusting(true);
    try {
      const r = await fetch('/api/admin-cache-bust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body: JSON.stringify({ secret }),
      });
      if (r.ok) { showToast('✓ Кэш сброшен — все получат свежие данные в течение 5 мин'); }
      else if (r.status === 401) { showToast('Нет прав'); }
      else { showToast('Ошибка при сбросе кэша'); }
    } catch { showToast('Ошибка сети'); }
    finally { setRtBusting(false); }
  };

  const fetchGlEntries = useCallback(async (subjId: string) => {
    setGlLoading(true);
    setGlEntries([]);
    try {
      const r = await fetch('/api/admin-glossary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body: JSON.stringify({ action: 'list', subjectId: subjId, secret }),
      });
      if (r.ok) { const d = await r.json(); setGlEntries(d.entries ?? []); }
      else showToast('Ошибка загрузки глоссария');
    } catch { showToast('Ошибка сети'); }
    finally { setGlLoading(false); }
  }, [secret]);

  const addGlEntry = async () => {
    if (!glForm.term.trim() || !glForm.definition.trim()) {
      showToast('Заполни термин и определение'); return;
    }
    setGlAdding(true);
    try {
      const r = await fetch('/api/admin-glossary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body: JSON.stringify({ action: 'add', subjectId: glSubject, entry: glForm, secret }),
      });
      if (r.ok) {
        const d = await r.json();
        setGlEntries(d.entries ?? []);
        setGlForm({ term: '', definition: '', image: '' });
        showToast('✓ Термин добавлен');
      } else { showToast('Ошибка добавления'); }
    } catch { showToast('Ошибка сети'); }
    finally { setGlAdding(false); }
  };

  const deleteGlEntry = async (entryId: string) => {
    setGlDeleting(entryId);
    try {
      const r = await fetch('/api/admin-glossary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body: JSON.stringify({ action: 'delete', subjectId: glSubject, entryId, secret }),
      });
      if (r.ok) { const d = await r.json(); setGlEntries(d.entries ?? []); showToast('Удалено'); }
      else { showToast('Ошибка удаления'); }
    } catch { showToast('Ошибка сети'); }
    finally { setGlDeleting(null); }
  };

  // Копирование в буфер с тостом
  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('✓ ' + label);
    } catch {
      // fallback для старых браузеров
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); showToast('✓ ' + label); }
      catch { showToast('Не удалось скопировать'); }
      document.body.removeChild(ta);
    }
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem('admin_secret');
    if (saved && authed) setSecret(saved);
  }, [authed]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const fetchUserDetail = useCallback(async (s: string, tgId: string) => {
    const initData = getTelegramInitData();
    if (!initData) return;
    try {
      const r = await fetch('/api/admin-users', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body:    JSON.stringify({ secret: s, initData, action: 'get_user', tgId }),
      });
      if (!r.ok) return;
      const data = await r.json();
      if (!data.user) return;
      setUsers(prev => prev.map(u => u.tgId === tgId ? { ...u, ...data.user } : u));
    } catch { /* не критично */ }
  }, []);

  const toggleExpand = useCallback((tgId: string) => {
    setExpandedIds(prev => {
      const opening = !prev.has(tgId);
      if (opening) {
        const u = users.find(x => x.tgId === tgId);
        if (u && u.navHidden === undefined) {
          void fetchUserDetail(secret, tgId);
        }
        return new Set([tgId]);
      }
      return new Set();
    });
  }, [users, secret, fetchUserDetail]);

  // ── POST: список пользователей (пагинация, фильтры на сервере) ───────────
  const fetchUsers = useCallback(async (
    s: string,
    opts?: {
      page?: number;
      append?: boolean;
      background?: boolean;
      sortBy?: SortBy;
      sortDir?: 'asc' | 'desc';
    },
  ) => {
    const initData = getTelegramInitData();
    if (!initData) { setError('Вход только через Telegram Mini App'); return; }

    const pageNum    = opts?.page ?? 1;
    const append     = opts?.append === true;
    const bg         = opts?.background === true;
    const reqSort    = opts?.sortBy ?? sortBy;
    const reqSortDir = opts?.sortDir ?? (
      reqSort === 'registered' && registeredAsc ? 'asc' : 'desc'
    );

    if (bg) setRefreshing(true);
    else if (!append) setLoading(true);
    setError('');

    try {
      const r = await fetch('/api/admin-users', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body:    JSON.stringify({
          secret: s,
          initData,
          page:     pageNum,
          limit:    50,
          filter,
          q:        debouncedSearch,
          sortBy:   reqSort,
          sortDir:  reqSortDir,
        }),
      });

      if (r.status === 403 || r.status === 401) {
        setError('Нет доступа: неверный пароль или Telegram ID');
        setAuthed(false);
        return;
      }
      if (!r.ok) { setError('Ошибка сервера'); return; }

      const data = await r.json();
      setUsers(prev => append ? [...prev, ...(data.users ?? [])] : (data.users ?? []));
      setPage(data.page ?? pageNum);
      setHasMore(data.hasMore === true);
      setTotal(data.total ?? 0);
      setFilteredTotal(data.filteredTotal ?? data.total ?? 0);
      setDemoCount(data.demoCount ?? 0);
      setBlockedCount(data.blockedCount ?? 0);
      setUnpaidCount(data.unpaidCount ?? 0);
      setSuspiciousCount(data.suspiciousCount ?? 0);
      setMicroCount(data.microCount ?? 0);
      setAvailableSubjects(data.availableSubjects ?? []);

      sessionStorage.setItem('admin_secret', s);
      setAuthed(true);

      for (const tgId of expandedIdsRef.current) {
        void fetchUserDetail(s, tgId);
      }

      if (!bg) {
        fetch('/api/admin-rate-blocks', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
          body:    JSON.stringify({ action: 'list', secret: s }),
        })
          .then(res => res.ok ? res.json() : null)
          .then(d => { if (d) setRateBlocks(d.blocks ?? []); })
          .catch(() => {});
      }
    } catch {
      setError('Ошибка соединения');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, debouncedSearch, sortBy, registeredAsc, fetchUserDetail]);

  useEffect(() => {
    if (!authed || !secret) return;
    setPage(1);
    fetchUsers(secret, { page: 1, append: false, background: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, debouncedSearch]);

  const handleSortClick = useCallback((id: SortBy) => {
    if (id === 'registered') {
      if (sortBy === 'registered') {
        const nextAsc = !registeredAsc;
        setRegisteredAsc(nextAsc);
        setPage(1);
        fetchUsers(secret, {
          page: 1,
          append: false,
          background: true,
          sortBy: 'registered',
          sortDir: nextAsc ? 'asc' : 'desc',
        });
      } else {
        setSortBy('registered');
        setRegisteredAsc(false);
        setPage(1);
        fetchUsers(secret, {
          page: 1,
          append: false,
          background: true,
          sortBy: 'registered',
          sortDir: 'desc',
        });
      }
      return;
    }
    setSortBy(id);
    setRegisteredAsc(false);
    setPage(1);
    fetchUsers(secret, {
      page: 1,
      append: false,
      background: true,
      sortBy: id,
      sortDir: 'desc',
    });
  }, [sortBy, registeredAsc, secret, fetchUsers]);

  const handlePatternUnlock = useCallback(() => {
    const initData = getTelegramInitData();
    if (!initData) {
      setError('Откройте панель через Telegram — вход из браузера заблокирован');
      return;
    }
    setError('');
    setSecret(ADMIN_UNLOCK_SECRET);
    fetchUsers(ADMIN_UNLOCK_SECRET);
  }, [fetchUsers]);

  // ── POST: действие над пользователем ──────────────────────────────────────
  const doAction = async (
    tgId: string,
    action: Action,
    subjectId?: string,
    enabled?: boolean,
    reason?: string,
    section?: string,
  ) => {
    const initData = getTelegramInitData();
    if (!initData) { showToast('Нет доступа: не в Telegram'); return; }

    setActioning(tgId);
    try {
      const body: Record<string, unknown> = { secret, initData, action, tgId };
      if (action === 'toggle_subject' && subjectId !== undefined) {
        body.subject = subjectId;
        body.enable  = enabled;
      }
      if (action === 'toggle_section' && subjectId !== undefined && section !== undefined) {
        body.subject = subjectId;
        body.section = section;
        body.enable  = enabled;
      }
      if (action === 'block' && reason) {
        body.reason = reason;
      }
      if (action === 'set_contact_username') {
        body.contactUsername = reason ?? '';
      }
      if (action === 'set_study_group') {
        body.studyGroup = reason ?? '';
      }
      if ((action === 'confirm_preview_module' || action === 'reject_preview_module') && section) {
        body.module = section;
      }

      const r = await fetch('/api/admin-users', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': getTelegramInitData() },
        body:    JSON.stringify(body),
      });

      if (!r.ok) {
        if (action === 'set_contact_username' || action === 'set_study_group') {
          const err = await r.json().catch(() => ({}));
          showToast((err as { error?: string }).error || 'Некорректное значение');
        } else {
          showToast('Ошибка действия');
        }
        return;
      }
      const data = await r.json().catch(() => ({}));

      // Удаление — убираем пользователя из списка целиком
      if (action === 'delete_user') {
        setUsers(prev => prev.filter(u => u.tgId !== tgId));
        setTotal(t => Math.max(0, t - 1));
        showToast('🗑 Пользователь удалён');
        return;
      }

      setUsers(prev => {
        const next = prev.map(u => {
        if (u.tgId !== tgId) return u;
        switch (action) {
          case 'block':
            return { ...u, blocked: true, blockedReason: reason || 'manual', blockedAt: new Date().toISOString() };
          case 'unblock':
            return { ...u, blocked: false, blockedReason: null, blockedAt: null, opensToday: 0, suspicious: false };
          case 'reset_demo': {
            const detail = (data.user && typeof data.user === 'object')
              ? data.user as Partial<User>
              : null;
            const navHidden = (data.navHidden && typeof data.navHidden === 'object')
              ? data.navHidden as Record<string, string[]>
              : (detail?.navHidden ?? u.navHidden);
            const subjects = Array.isArray(data.subjects)
              ? data.subjects
              : (detail?.subjects ?? u.subjects);
            return {
              ...u,
              ...detail,
              usedDemo: detail?.previewStatus === 'selecting' ? true : false,
              previewStatus: detail?.previewStatus ?? null,
              previewChosenSubject: detail?.previewChosenSubject ?? null,
              previewChosenModules: detail?.previewChosenModules ?? null,
              previewNeedsConfirm: false,
              previewPendingModules: [],
              previewQuotedPrice: null,
              previewConfirmedAt: null,
              receiptClaimedAt: null,
              subjects,
              navHidden,
            };
          }
          case 'force_payment_only': {
            const newSubjects = Array.isArray(data.subjects) ? data.subjects : [];
            const navHidden = (data.navHidden && typeof data.navHidden === 'object')
              ? data.navHidden as Record<string, string[]>
              : u.navHidden;
            return {
              ...u,
              previewStatus: (data.previewStatus as string | null) ?? 'expired',
              previewChosenSubject: (data.previewChosenSubject as string | null) ?? u.previewChosenSubject,
              previewChosenModules: Array.isArray(data.previewChosenModules)
                ? data.previewChosenModules
                : u.previewChosenModules,
              previewQuotedPrice: typeof data.previewQuotedPrice === 'number' ? data.previewQuotedPrice : u.previewQuotedPrice,
              previewConfirmedAt: null,
              receiptClaimedAt: null,
              previewNeedsConfirm: data.previewNeedsConfirm === true,
              previewPendingModules: Array.isArray(data.previewPendingModules)
                ? data.previewPendingModules
                : [],
              previewStartedAt: null,
              subjects: newSubjects,
              navHidden,
              paid: data.paid === true,
            };
          }
          case 'grant_direct_access': {
            const detail = (data.user && typeof data.user === 'object')
              ? data.user as Partial<User>
              : null;
            const newSubjects = Array.isArray(data.subjects) ? data.subjects : u.subjects;
            const navHidden = (data.navHidden && typeof data.navHidden === 'object')
              ? data.navHidden as Record<string, string[]>
              : u.navHidden;
            return {
              ...u,
              ...detail,
              previewStatus: null,
              previewStartedAt: null,
              previewExpiredAt: null,
              previewConfirmedAt: (data.previewConfirmedAt as string | null) ?? new Date().toISOString(),
              previewChosenSubject: null,
              previewChosenModules: null,
              previewNeedsConfirm: false,
              previewPendingModules: [],
              previewDisplayModules: [],
              receiptClaimedAt: null,
              paid: true,
              studyGroup: (data.studyGroup as string | null) ?? detail?.studyGroup ?? u.studyGroup ?? null,
              subjects: newSubjects,
              navHidden,
            };
          }
          case 'confirm_preview':
          case 'confirm_preview_module': {
            const newSubjects = Array.isArray(data.subjects) ? data.subjects : u.subjects;
            const navHidden = (data.navHidden && typeof data.navHidden === 'object')
              ? data.navHidden as Record<string, string[]>
              : u.navHidden;
            return {
              ...u,
              previewStatus: (data.previewStatus as string | null) ?? null,
              previewStartedAt: null,
              previewExpiredAt: null,
              previewConfirmedAt: (data.previewConfirmedAt as string | null) ?? u.previewConfirmedAt,
              previewChosenSubject: (data.previewChosenSubject as string | null) ?? u.previewChosenSubject,
              previewChosenModules: Array.isArray(data.previewChosenModules)
                ? data.previewChosenModules
                : u.previewChosenModules,
              previewNeedsConfirm: data.previewNeedsConfirm === true,
              previewPendingModules: Array.isArray(data.previewPendingModules)
                ? data.previewPendingModules
                : [],
              previewDisplayModules: Array.isArray(data.previewDisplayModules)
                ? data.previewDisplayModules
                : u.previewDisplayModules,
              receiptClaimedAt: u.receiptClaimedAt,
              paid: data.paid === true,
              activatedKey: u.activatedKey === 'preview' || !u.activatedKey ? 'preview' : u.activatedKey,
              subjects: newSubjects,
              navHidden,
            };
          }
          case 'reject_preview_module': {
            const navHidden = (data.navHidden && typeof data.navHidden === 'object')
              ? data.navHidden as Record<string, string[]>
              : u.navHidden;
            return {
              ...u,
              previewStatus: (data.previewStatus as string | null) ?? u.previewStatus,
              previewNeedsConfirm: data.previewNeedsConfirm === true,
              previewPendingModules: Array.isArray(data.previewPendingModules)
                ? data.previewPendingModules
                : [],
              previewDisplayModules: Array.isArray(data.previewDisplayModules)
                ? data.previewDisplayModules
                : u.previewDisplayModules,
              receiptClaimedAt: (data.receiptClaimedAt as string | null) ?? u.receiptClaimedAt,
              navHidden,
            };
          }
          case 'reopen_preview_vitrine':
            return {
              ...u,
              previewStatus: 'selecting',
              previewChosenSubject: null,
              previewChosenModules: null,
              previewQuotedPrice: null,
              receiptClaimedAt: null,
              previewNeedsConfirm: false,
              previewStartedAt: null,
              previewExpiredAt: null,
            };
          case 'toggle_paid':
            return { ...u, paid: !u.paid };
          case 'set_study_group':
            return { ...u, studyGroup: (data.studyGroup as string | null) ?? u.studyGroup };
          case 'set_contact_username': {
            const handle = String(reason ?? '').trim();
            return {
              ...u,
              contactUsername: handle ? normalizeTelegramUsername(handle) : null,
            };
          }
          case 'toggle_subject': {
            if (!subjectId) return u;
            const newSubjects = enabled
              ? Array.from(new Set([...u.subjects, subjectId]))
              : u.subjects.filter(s => s !== subjectId);
            const fallbackNav: Record<string, string[]> = { ...(u.navHidden || {}) };
            if (enabled) {
              fallbackNav[subjectId] = NAV_SECTIONS.map(s => s.id);
            } else {
              delete fallbackNav[subjectId];
            }
            const navHidden = (data.navHidden && typeof data.navHidden === 'object')
              ? data.navHidden as Record<string, string[]>
              : fallbackNav;
            return {
              ...u,
              subjects: newSubjects,
              hasMicro: newSubjects.includes('micro'),
              navHidden,
              previewStatus: (data.previewStatus as string | null) ?? u.previewStatus,
              previewConfirmedAt: (data.previewConfirmedAt as string | null) ?? u.previewConfirmedAt,
              previewChosenSubject: (data.previewChosenSubject as string | null) ?? u.previewChosenSubject,
              paid: data.previewConfirmedAt ? true : u.paid,
            };
          }
          case 'toggle_section': {
            if (!subjectId || !section) return u;
            const fallbackNav = { ...(u.navHidden || {}) };
            const set = new Set<string>(fallbackNav[subjectId] || []);
            if (enabled) set.delete(section); else set.add(section);
            if (set.size === 0) delete fallbackNav[subjectId];
            else fallbackNav[subjectId] = [...set];
            const navHidden = (data.navHidden && typeof data.navHidden === 'object')
              ? data.navHidden as Record<string, string[]>
              : fallbackNav;
            return {
              ...u,
              navHidden,
              previewStatus: (data.previewStatus as string | null) ?? u.previewStatus,
              previewConfirmedAt: (data.previewConfirmedAt as string | null) ?? u.previewConfirmedAt,
              previewChosenSubject: (data.previewChosenSubject as string | null) ?? u.previewChosenSubject,
              paid: data.previewConfirmedAt ? true : u.paid,
            };
          }
          default:
            return u;
        }
        });
        if (action === 'toggle_paid' && filter === 'unpaid') {
          return next.filter(u => !(u.tgId === tgId && u.paid));
        }
        return next;
      });

      if (action === 'confirm_preview' || action === 'confirm_preview_module' || action === 'reject_preview_module') {
        void fetchUserDetail(secret, tgId);
      }

      if (action === 'reset_demo') setDemoCount(c => Math.max(0, c - 1));
      if (action === 'toggle_paid') {
        const nowPaid = !users.find(u => u.tgId === tgId)?.paid;
        setUnpaidCount(c => Math.max(0, nowPaid ? c - 1 : c + 1));
      }

      let msg = '';
      switch (action) {
        case 'block':          msg = '🚫 Заблокирован'; break;
        case 'unblock':        msg = '✓ Разблокирован'; break;
        case 'reset_demo':     msg = '✓ Пробный доступ сброшен'; break;
        case 'grant_direct_access': msg = '✓ Доступ открыт без пробника'; break;
        case 'force_payment_only': msg = '💳 Только экраны оплаты'; break;
        case 'confirm_preview':
        case 'confirm_preview_module': msg = '✓ Раздел подтверждён'; break;
        case 'reject_preview_module': msg = '↩ Отказ по разделу'; break;
        case 'reopen_preview_vitrine': msg = '↩ Студент возвращён на витрину'; break;
        case 'toggle_paid': {
          const nowPaid = !users.find(u => u.tgId === tgId)?.paid;
          msg = nowPaid ? '💲 Отмечено как оплачено' : 'Отметка оплаты снята';
          break;
        }
        case 'toggle_subject': {
          const subj  = availableSubjects.find(s => s.id === subjectId);
          const label = subj?.shortLabel || subjectId;
          msg = enabled ? `✓ ${label} выдано` : `${label} отозвано`;
          break;
        }
        case 'toggle_section': {
          const sectionLabel = NAV_SECTIONS.find(s => s.id === section)?.label || section;
          const subj  = availableSubjects.find(s => s.id === subjectId);
          const subjLabel = subj?.shortLabel || subjectId;
          msg = enabled ? `✓ «${sectionLabel}» включён в ${subjLabel}` : `«${sectionLabel}» скрыт в ${subjLabel}`;
          break;
        }
        case 'set_study_group':
          msg = `✓ Группа ${String(data.studyGroup ?? '')} закреплена`;
          break;
        case 'set_contact_username': {
          const handle = String(reason ?? '').trim();
          msg = handle ? `✓ Контакт @${normalizeTelegramUsername(handle)} сохранён` : 'Контакт удалён';
          break;
        }
      }
      if (msg) showToast(msg);
    } finally {
      setActioning(null);
    }
  };

  const loadMoreUsers = () => {
    if (!hasMore || loading || refreshing) return;
    fetchUsers(secret, { page: page + 1, append: true, background: true });
  };
  // ─── ЭКРАН ВХОДА ───────────────────────────────────────────────────────────
  const loginScreen = (
    <div style={{
      minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: T.bg, padding: '20px',
      fontFamily: FONT_SANS, color: T.text,
    }}>
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 20, padding: '32px 24px 26px', width: '100%', maxWidth: 360,
        boxShadow: `0 4px 20px ${T.text}08`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12, background: T.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 18, letterSpacing: -0.5,
          }}>O</div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>ByNekruz</div>
            <div style={{
              fontSize: 11, color: T.textMuted, fontWeight: 500,
              textTransform: 'uppercase', letterSpacing: 0.8,
            }}>Admin panel</div>
          </div>
        </div>

        <div style={{
          fontSize: 11, color: T.textMuted, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 14, textAlign: 'center',
        }}>Графический ключ</div>

        <AdminPatternLock
          expectedPattern={[...ADMIN_PATTERN]}
          onSuccess={handlePatternUnlock}
          disabled={loading}
          theme={{
            accent: T.accent,
            accentSoft: T.accentSoft,
            border: T.border,
            textMuted: T.textMuted,
            danger: T.danger,
            surfaceAlt: T.surfaceAlt,
          }}
        />

        {error && (
          <div style={{
            marginTop: 14,
            background: T.dangerSoft, border: `1px solid ${T.danger}33`,
            borderRadius: 10, padding: '10px 13px',
            color: T.danger, fontSize: 13, lineHeight: 1.4,
          }}>{error}</div>
        )}

        {loading && (
          <div style={{
            marginTop: 12, textAlign: 'center',
            color: T.textMuted, fontSize: 13,
          }}>Вход...</div>
        )}
      </div>
    </div>
  );

  // ─── ОСНОВНАЯ ПАНЕЛЬ ───────────────────────────────────────────────────────
  const mainPanel = (
    <div style={{
      height: '100svh',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: T.bg, fontFamily: FONT_SANS, color: T.text,
    }}>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: T.text, border: 'none',
          borderRadius: 12, padding: '11px 22px',
          color: '#fff', fontSize: 14, fontWeight: 500,
          zIndex: 999, whiteSpace: 'nowrap',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}>{toast}</div>
      )}

      {/* шапка */}
      <div style={{
        padding: `${topInset}px 16px 12px`,
        display: 'flex', alignItems: 'center', gap: 11,
        background: T.surface, borderBottom: `1px solid ${T.border}`,
        position: 'sticky', top: 0, zIndex: 100, flexShrink: 0,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 10, background: T.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 700, fontSize: 15,
        }}>O</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: T.text, letterSpacing: -0.2 }}>
            ByNekruz Admin
          </div>
          <div style={{ fontSize: 11, color: T.textMuted, fontWeight: 500 }}>
            {refreshing ? 'Обновление…' : (
              <>
                <span style={{ color: T.text, fontWeight: 600 }}>{users.length}</span>
                {hasMore ? '+' : ''} · всего {total}
              </>
            )}
          </div>
        </div>
        <button
          onClick={() => fetchUsers(secret, { page: 1, append: false, background: true })}
          disabled={loading || refreshing}
          style={{
            width: 36, height: 36, borderRadius: 10,
            background: T.surfaceAlt, border: `1px solid ${T.border}`,
            color: loading || refreshing ? T.textFaint : T.textMuted,
            fontSize: 16, cursor: loading || refreshing ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >{loading || refreshing ? '⏳' : '↻'}</button>

        <button
          onClick={bustCache}
          disabled={rtBusting}
          title="Сбросить кэш у всех"
          style={{
            width: 36, height: 36, borderRadius: 10,
            background: T.surfaceAlt, border: `1px solid ${T.border}`,
            color: rtBusting ? T.textFaint : T.textMuted,
            fontSize: 17, cursor: rtBusting ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >{rtBusting ? '⏳' : '🔄'}</button>

        <button
          onClick={() => { setKeysOpen(true); fetchValidKeys(); }}
          title="Активационные ключи"
          style={{
            width: 36, height: 36, borderRadius: 10,
            background: T.surfaceAlt, border: `1px solid ${T.border}`,
            color: T.textMuted, fontSize: 17, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >🔑</button>
      </div>

      {/* вкладки: студенты / настройки */}
      <div style={{
        display: 'flex', gap: 8, padding: '10px 14px 0',
        background: T.surface, borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
      }}>
        {([
          { id: 'students' as AdminTab, label: '👥 Студенты' },
          { id: 'access' as AdminTab, label: '📚 Группы' },
          { id: 'lessons' as AdminTab, label: '🗓 Занятия' },
          { id: 'settings' as AdminTab, label: '⚙️ Настройки' },
        ]).map(tab => {
          const active = adminTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setAdminTab(tab.id)}
              style={{
                flex: 1, padding: '10px 12px', borderRadius: 10,
                border: `1px solid ${active ? T.accent : T.border}`,
                background: active ? T.accentSoft : T.surfaceAlt,
                color: active ? T.accent : T.textMuted,
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
                fontFamily: FONT_SANS,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {keysOpen && (
        <div
          onClick={() => setKeysOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 500,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: T.surface, borderRadius: '18px 18px 0 0',
              width: '100%', maxWidth: 520,
              maxHeight: '70vh', display: 'flex', flexDirection: 'column',
              padding: '0 0 32px',
            }}
          >
            <div style={{
              padding: '16px 18px 12px',
              borderBottom: `1px solid ${T.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>
                🔑 Активационные ключи {keysList.length > 0 && <span style={{ color: T.textMuted, fontWeight: 500 }}>({keysList.length})</span>}
              </div>
              <button
                onClick={() => setKeysOpen(false)}
                style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: T.surfaceAlt, border: `1px solid ${T.border}`,
                  color: T.textMuted, cursor: 'pointer', fontSize: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >×</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '10px 14px', flex: 1 }}>
              {keysLoading ? (
                <div style={{ textAlign: 'center', color: T.textMuted, padding: 24, fontSize: 13 }}>Загрузка...</div>
              ) : keysList.length === 0 ? (
                <div style={{ textAlign: 'center', color: T.textMuted, padding: 24, fontSize: 13 }}>Нет активных ключей</div>
              ) : keysList.map(k => (
                <div
                  key={k}
                  onClick={() => {
                    navigator.clipboard.writeText(k).then(() => showToast('✓ Скопировано'));
                  }}
                  style={{
                    fontFamily: FONT_MONO, fontSize: 13,
                    padding: '11px 14px', marginBottom: 7,
                    background: T.surfaceAlt, border: `1px solid ${T.border}`,
                    borderRadius: 10, cursor: 'pointer',
                    color: T.text, letterSpacing: 0.5,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <span style={{ wordBreak: 'break-all' }}>{k}</span>
                  <span style={{ color: T.textFaint, fontSize: 12, flexShrink: 0 }}>📋</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{
        padding: '14px 14px 80px', maxWidth: 680, margin: '0 auto',
        width: '100%', boxSizing: 'border-box',
        flex: 1, overflowY: 'auto',
      }}>

        {adminTab === 'settings' && (<>

        {/* статистика по факультетам */}
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 14, marginBottom: 14, overflow: 'hidden',
        }}>
          <button
            type="button"
            onClick={() => {
              if (!facultyStatsExpanded && !facultyStats) void fetchFacultyStats(false);
              setFacultyStatsExpanded(v => !v);
            }}
            style={{
              width: '100%', padding: '13px 14px', border: 'none', background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              cursor: 'pointer', fontFamily: FONT_SANS, textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, background: T.accentSoft,
                color: T.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, flexShrink: 0,
              }}>📊</div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text }}>
                  Студенты по факультетам
                </div>
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
                  Стом · Пед · Леч · без факультета · обновление раз в месяц
                </div>
              </div>
            </div>
            <span style={{
              color: T.textFaint, fontSize: 14,
              transform: facultyStatsExpanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s', display: 'inline-block',
            }}>▾</span>
          </button>

          {facultyStatsExpanded && (
            <div style={{ borderTop: `1px solid ${T.border}`, background: T.surfaceAlt, padding: '14px' }}>
              {facultyStatsLoading && !facultyStats ? (
                <div style={{ textAlign: 'center', color: T.textFaint, fontSize: 13, padding: 12 }}>
                  Считаем…
                </div>
              ) : facultyStats ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                    {([
                      { label: '🦷 Стоматология', value: facultyStats.stomatology, color: T.success },
                      { label: '👶 Педиатрия', value: facultyStats.pediatrics, color: T.warn },
                      { label: '🩺 Лечебное дело', value: facultyStats.therapeutic, color: T.accent },
                      { label: '❓ Без факультета', value: facultyStats.unknown, color: T.textMuted },
                    ] as const).map(row => (
                      <div
                        key={row.label}
                        style={{
                          padding: '10px 12px', borderRadius: 10,
                          background: T.surface, border: `1px solid ${T.border}`,
                        }}
                      >
                        <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>{row.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: row.color }}>{row.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{
                    fontSize: 11, color: T.textFaint, lineHeight: 1.5, marginBottom: 10,
                  }}>
                    Всего в базе: <strong style={{ color: T.text }}>{facultyStats.total}</strong>
                    {' · '}
                    Обновлено: {new Date(facultyStats.computedAt).toLocaleString('ru-RU')}
                    <br />
                    Следующее автообновление: {new Date(facultyStats.nextRefreshAt).toLocaleDateString('ru-RU')}
                  </div>
                  <button
                    type="button"
                    onClick={() => void fetchFacultyStats(true)}
                    disabled={facultyStatsLoading}
                    style={{
                      height: 34, padding: '0 12px', borderRadius: 8,
                      border: `1px solid ${T.border}`, background: T.surface,
                      color: T.textMuted, fontSize: 12, fontWeight: 600,
                      cursor: facultyStatsLoading ? 'default' : 'pointer',
                      opacity: facultyStatsLoading ? 0.6 : 1,
                    }}
                  >
                    {facultyStatsLoading ? '…' : '↻ Пересчитать сейчас'}
                  </button>
                </>
              ) : (
                <div style={{ textAlign: 'center', color: T.textFaint, fontSize: 13, padding: 12 }}>
                  Не удалось загрузить
                </div>
              )}
            </div>
          )}
        </div>

        {/* пробный вход — коды из канала */}
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 14, padding: '13px 14px', marginBottom: 14,
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: T.purpleSoft,
            color: T.purple, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 15, flexShrink: 0,
          }}>D</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text, marginBottom: 4 }}>
              Пробный вход
            </div>
            <div style={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.5 }}>
              Студент вводит код (3950 / 5016 / 2314), затем только цифры группы (108, 207). Буква факультета дописывается сама — в карточке: 108с, 204л, 114п.
              После выбора предмета сразу можно нажать «Подтвердить» в карточке. Если не подтвердил — после окончания просмотра доступ ограничится.
            </div>
            <div style={{
              marginTop: 10, paddingTop: 10,
              borderTop: `1px solid ${T.border}`,
              display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
            }}>
              <input
                type="text"
                inputMode="numeric"
                placeholder="Telegram ID для сброса"
                value={demoResetTgId}
                onChange={e => setDemoResetTgId(e.target.value.replace(/\D/g, '').slice(0, 12))}
                style={{
                  flex: 1, minWidth: 140, height: 36, borderRadius: 10,
                  border: `1px solid ${T.border}`, background: T.surfaceAlt,
                  color: T.text, padding: '0 12px', fontSize: 13,
                  fontFamily: FONT_MONO, boxSizing: 'border-box',
                }}
              />
              <button
                onClick={resetPreviewByTgId}
                disabled={demoResetLoading}
                style={{
                  height: 36, padding: '0 14px', borderRadius: 10, border: 'none',
                  background: T.purpleSoft, color: T.purple,
                  fontSize: 12.5, fontWeight: 600, cursor: demoResetLoading ? 'default' : 'pointer',
                  opacity: demoResetLoading ? 0.6 : 1, whiteSpace: 'nowrap',
                }}
              >
                {demoResetLoading ? '...' : 'Сбросить пробный'}
              </button>
            </div>
            <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 6, lineHeight: 1.4 }}>
              Снимает «уже использовано» и «слишком много попыток» — даже если аккаунта нет в списке.
            </div>
          </div>
        </div>

        {/* подарок: задачи bio */}
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 14, padding: '13px 14px', marginBottom: 14,
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: T.successSoft,
            color: T.success, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 15, flexShrink: 0,
          }}>🎁</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text, marginBottom: 4 }}>
              Подарок: задачи по биологии
            </div>
            <div style={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.5 }}>
              Одной кнопкой откроет раздел «Задачи» всем, у кого уже выдан bio и включён тест.
              Вопросы и экзамен не трогает. После — объяви в канале и попроси перезайти в приложение.
            </div>
            <button
              onClick={giftBioTasksToAll}
              disabled={giftBioTasksLoading}
              style={{
                marginTop: 10, height: 36, padding: '0 14px', borderRadius: 10, border: 'none',
                background: T.successSoft, color: T.success,
                fontSize: 12.5, fontWeight: 600, cursor: giftBioTasksLoading ? 'default' : 'pointer',
                opacity: giftBioTasksLoading ? 0.6 : 1,
              }}
            >
              {giftBioTasksLoading ? '...' : '🎁 Выдать задачи bio всем с тестом'}
            </button>
          </div>
        </div>

        {/* платные 8-значные ключи */}
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 14, padding: '13px 14px', marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: T.accentSoft,
            color: T.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 13, flexShrink: 0,
          }}>₽</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text, marginBottom: 2 }}>
              Платные ключи (8 цифр)
            </div>
            <div style={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.4 }}>
              {isPaidKeysEnabled
                ? 'Старая монетизация активна — ключи из списка ниже принимаются'
                : 'Отключено — только коды из канала и подтверждение админа'}
            </div>
          </div>
          <button
            onClick={togglePaidKeys}
            disabled={isPaidKeysLoading}
            aria-label="Toggle paid keys"
            style={{
              width: 44, height: 26, borderRadius: 999,
              background: isPaidKeysEnabled ? T.accent : T.borderStrong,
              border: 'none', position: 'relative', flexShrink: 0,
              cursor: isPaidKeysLoading ? 'default' : 'pointer',
              padding: 0, transition: 'background 0.15s',
              opacity: isPaidKeysLoading ? 0.6 : 1,
            }}
          >
            <span style={{
              position: 'absolute', top: 3, left: isPaidKeysEnabled ? 21 : 3,
              width: 20, height: 20, borderRadius: '50%',
              background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              transition: 'left 0.15s',
            }} />
          </button>
        </div>

        {/* витрина пробного выбора */}
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 14, marginBottom: 14, overflow: 'hidden',
        }}>
          <div
            onClick={() => setPreviewCatalogExpanded(v => !v)}
            style={{
              padding: '13px 14px',
              display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 10, background: T.accentSoft,
              color: T.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 14, flexShrink: 0,
            }}>👁</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text, marginBottom: 2 }}>
                Витрина пробного выбора
              </div>
              <div style={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.4 }}>
                Что видят студенты с кодами 3950 / 5016 / 2314. Серое — «в разработке», но предмет всё равно можно открыть и посмотреть.
              </div>
            </div>
            <span style={{
              color: T.textFaint, fontSize: 13,
              transform: previewCatalogExpanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s', display: 'inline-block',
            }}>▾</span>
          </div>

          {previewCatalogExpanded && (
            <div style={{ borderTop: `1px solid ${T.border}`, padding: '10px 14px 14px' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={() => savePreviewCatalog({}, 'reset-all')}
                  disabled={!!previewCatalogSaving}
                  style={{
                    flex: 1, height: 34, borderRadius: 10,
                    border: `1px solid ${T.border}`, background: T.surfaceAlt,
                    color: T.text, fontSize: 12, fontWeight: 600,
                    cursor: previewCatalogSaving ? 'default' : 'pointer',
                    opacity: previewCatalogSaving === 'reset-all' ? 0.6 : 1,
                  }}
                >
                  Показать всё (сброс)
                </button>
              </div>
              {previewCatalogBase.length === 0 ? (
                <div style={{ fontSize: 12, color: T.textMuted }}>Загрузка каталога…</div>
              ) : previewCatalogBase.map(entry => {
                const effective = previewCatalogEffective[entry.id];
                const subjectOpen = effective?.open ?? false;
                const subjectSaving = previewCatalogSaving === `subject:${entry.id}`;

                return (
                  <div
                    key={entry.id}
                    style={{
                      padding: '10px 0',
                      borderBottom: `1px solid ${T.border}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: entry.color, flexShrink: 0,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                          {entry.label}
                          <span style={{
                            marginLeft: 6, fontSize: 10.5, fontWeight: 600,
                            color: T.textMuted, background: T.surfaceAlt,
                            borderRadius: 5, padding: '1px 6px',
                          }}>{entry.badge}</span>
                        </div>
                        <div style={{ fontSize: 10.5, color: subjectOpen ? T.textMuted : T.textFaint }}>
                          {subjectOpen
                            ? 'В витрине · можно выбрать готовые разделы'
                            : 'Весь предмет серый · только просмотр'}
                        </div>
                      </div>
                      <button
                        onClick={() => togglePreviewSubjectOpen(entry.id)}
                        disabled={!!previewCatalogSaving}
                        aria-label={`Toggle ${entry.label}`}
                        style={{
                          width: 44, height: 26, borderRadius: 999,
                          background: subjectOpen ? T.accent : T.borderStrong,
                          border: 'none', position: 'relative', flexShrink: 0,
                          cursor: previewCatalogSaving ? 'default' : 'pointer',
                          padding: 0, opacity: subjectSaving ? 0.6 : 1,
                        }}
                      >
                        <span style={{
                          position: 'absolute', top: 3, left: subjectOpen ? 21 : 3,
                          width: 20, height: 20, borderRadius: '50%',
                          background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                          transition: 'left 0.15s',
                        }} />
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingLeft: 18 }}>
                      {(['questions', 'tests', 'tasks'] as PreviewModKind[]).map(modId => {
                        const baseMod = entry.modules.find(m => m.id === modId);
                        const hasFile = baseMod?.available ?? false;
                        const modOpen = effective?.modules?.[modId] ?? false;
                        const modSaving = previewCatalogSaving === `module:${entry.id}:${modId}`;
                        const label = PREVIEW_MODULE_LABELS[modId];

                        return (
                          <button
                            key={modId}
                            onClick={() => togglePreviewModule(entry.id, modId)}
                            disabled={!hasFile || !!previewCatalogSaving || !subjectOpen}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              padding: '5px 10px', borderRadius: 8,
                              border: `1px solid ${modOpen && hasFile ? entry.color + '55' : T.border}`,
                              background: !hasFile
                                ? T.surfaceAlt
                                : modOpen && subjectOpen
                                  ? entry.color + '18'
                                  : T.surfaceAlt,
                              color: !hasFile
                                ? T.textFaint
                                : modOpen && subjectOpen
                                  ? T.text
                                  : T.textMuted,
                              fontSize: 11.5, fontWeight: 600,
                              cursor: !hasFile || previewCatalogSaving || !subjectOpen ? 'default' : 'pointer',
                              opacity: modSaving ? 0.6 : 1,
                            }}
                          >
                            <span style={{
                              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                              background: modOpen && hasFile && subjectOpen ? entry.color : T.borderStrong,
                            }} />
                            {label}
                            {!hasFile && ' · нет файла'}
                            {hasFile && !modOpen && subjectOpen && ' · скрыто'}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* блокировки входа */}
        <div style={{
          background: T.surface, border: `1px solid ${rateBlocks.length > 0 ? T.danger + '44' : T.border}`,
          borderRadius: 14, marginBottom: 14, overflow: 'hidden',
        }}>
          <div
            onClick={() => {
              if (!rateBlocksExpanded && rateBlocks.length === 0) fetchRateBlocks();
              setRateBlocksExpanded(v => !v);
            }}
            style={{
              padding: '13px 14px',
              display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: rateBlocks.length > 0 ? T.dangerSoft : T.surfaceAlt,
              color: rateBlocks.length > 0 ? T.danger : T.textMuted,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 15, flexShrink: 0,
            }}>🔒</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text, marginBottom: 2 }}>
                Блокировки входа
                {rateBlocks.length > 0 && (
                  <span style={{
                    marginLeft: 8, background: T.dangerSoft, color: T.danger,
                    borderRadius: 6, padding: '1px 7px', fontSize: 12, fontWeight: 700,
                  }}>{rateBlocks.length}</span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.4 }}>
                {rateBlocks.length === 0
                  ? 'Нет активных блокировок по ключу'
                  : `${rateBlocks.length} студент${rateBlocks.length === 1 ? '' : rateBlocks.length < 5 ? 'а' : 'ов'} заблокирован${rateBlocks.length === 1 ? '' : 'о'} после ошибок ввода`}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={e => { e.stopPropagation(); fetchRateBlocks(); }}
                disabled={rateBlocksLoading}
                style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: T.surfaceAlt, border: `1px solid ${T.border}`,
                  color: rateBlocksLoading ? T.textFaint : T.textMuted,
                  fontSize: 14, cursor: rateBlocksLoading ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >{rateBlocksLoading ? '⏳' : '↻'}</button>
              <span style={{
                color: T.textFaint, fontSize: 13,
                transform: rateBlocksExpanded ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s', display: 'inline-block',
              }}>▾</span>
            </div>
          </div>

          {rateBlocksExpanded && (
            <div style={{ borderTop: `1px solid ${T.border}`, background: T.surfaceAlt }}>
              {rateBlocksLoading ? (
                <div style={{ padding: '20px', textAlign: 'center', color: T.textFaint, fontSize: 13 }}>
                  Загрузка...
                </div>
              ) : rateBlocks.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
                  Нет активных блокировок
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {rateBlocks.map((b, i) => {
                    const knownUser = users.find(u => u.tgId === b.tgId);
                    const busy = clearingTgId === b.tgId;
                    return (
                      <div key={b.tgId} style={{
                        padding: '10px 14px',
                        borderTop: i === 0 ? 'none' : `1px solid ${T.border}`,
                        display: 'flex', alignItems: 'center', gap: 10,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 13, fontWeight: 600, color: T.text,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {knownUser ? displayName(knownUser) : (
                              <span style={{ fontFamily: FONT_MONO, color: T.textMuted }}>id {b.tgId}</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            {knownUser && (
                              <span style={{
                                fontFamily: FONT_MONO, fontSize: 10.5, color: T.textFaint,
                              }}>id {b.tgId}</span>
                            )}
                            <span style={{
                              background: T.dangerSoft, color: T.danger,
                              borderRadius: 5, padding: '1px 6px',
                              fontSize: 11, fontWeight: 600,
                            }}>ещё {fmtTTL(b.ttl)}</span>
                          </div>
                        </div>
                        <ActionBtn
                          variant="success"
                          disabled={busy}
                          onClick={() => clearRateBlock(b.tgId)}
                        >
                          {busy ? '...' : 'Снять'}
                        </ActionBtn>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* белый список — обход проверки подписки */}
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 14, marginBottom: 14, overflow: 'hidden',
        }}>
          <div
            onClick={() => {
              const next = !wlExpanded;
              setWlExpanded(next);
              if (next && wlItems.length === 0) fetchWhitelist();
            }}
            style={{
              padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: wlItems.length > 0 ? T.successSoft : T.surfaceAlt,
              color: wlItems.length > 0 ? T.success : T.textMuted,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 18, flexShrink: 0,
            }}>✅</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text, marginBottom: 2 }}>
                Белый список (без подписки)
                {wlItems.length > 0 && (
                  <span style={{
                    marginLeft: 8, background: T.successSoft, color: T.success,
                    borderRadius: 6, padding: '1px 7px', fontSize: 12, fontWeight: 700,
                  }}>{wlItems.length}</span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.4 }}>
                ID из списка проходят без проверки подписки на канал
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={e => { e.stopPropagation(); fetchWhitelist(); }}
                disabled={wlLoading}
                style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: T.surfaceAlt, border: `1px solid ${T.border}`,
                  color: wlLoading ? T.textFaint : T.textMuted,
                  fontSize: 14, cursor: wlLoading ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >{wlLoading ? '⏳' : '↻'}</button>
              <span style={{
                color: T.textFaint, fontSize: 13,
                transform: wlExpanded ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s', display: 'inline-block',
              }}>▾</span>
            </div>
          </div>

          {wlExpanded && (
            <div style={{ borderTop: `1px solid ${T.border}`, background: T.surfaceAlt }}>
              {/* поле ввода нового ID */}
              <div style={{ padding: '12px 14px', display: 'flex', gap: 8 }}>
                <input
                  value={wlInput}
                  onChange={e => setWlInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addToWhitelist(); }}
                  placeholder="Telegram ID студента"
                  style={{
                    flex: 1, padding: '8px 11px',
                    border: `1px solid ${T.border}`, borderRadius: 10,
                    fontSize: 13, fontFamily: FONT_MONO,
                    background: T.surface, color: T.text,
                    outline: 'none',
                  }}
                />
                <ActionBtn
                  variant="success"
                  disabled={wlAdding || !wlInput.trim()}
                  onClick={addToWhitelist}
                >
                  {wlAdding ? '...' : 'Добавить'}
                </ActionBtn>
              </div>

              {wlLoading ? (
                <div style={{ padding: '14px', textAlign: 'center', color: T.textFaint, fontSize: 13 }}>
                  Загрузка...
                </div>
              ) : wlItems.length === 0 ? (
                <div style={{ padding: '14px', textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
                  Белый список пуст
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${T.border}` }}>
                  {wlItems.map((id, i) => {
                    const knownUser = users.find(u => u.tgId === id);
                    const busy = wlRemoving === id;
                    return (
                      <div key={id} style={{
                        padding: '10px 14px',
                        borderTop: i === 0 ? 'none' : `1px solid ${T.border}`,
                        display: 'flex', alignItems: 'center', gap: 10,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 13, fontWeight: 600, color: T.text,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {knownUser ? displayName(knownUser) : (
                              <span style={{ fontFamily: FONT_MONO, color: T.textMuted }}>id {id}</span>
                            )}
                          </div>
                          {knownUser && (
                            <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: T.textFaint }}>
                              id {id}
                            </span>
                          )}
                        </div>
                        <ActionBtn
                          variant="danger"
                          disabled={busy}
                          onClick={() => removeFromWhitelist(id)}
                        >
                          {busy ? '...' : 'Удалить'}
                        </ActionBtn>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* глоссарий — кастомные записи */}
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 14, marginBottom: 14, overflow: 'hidden',
        }}>
          <div
            onClick={() => {
              const next = !glExpanded;
              setGlExpanded(next);
              if (next && !glSubject && availableSubjects.length > 0) {
                const first = availableSubjects[0].id;
                setGlSubject(first);
                fetchGlEntries(first);
              }
            }}
            style={{
              padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 10, background: T.warnSoft,
              color: T.warn, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 18, flexShrink: 0,
            }}>📝</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text, marginBottom: 2 }}>
                Глоссарий
              </div>
              <div style={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.4 }}>
                Добавить термин + определение + картинку
              </div>
            </div>
            <span style={{
              color: T.textFaint, fontSize: 13,
              transform: glExpanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s', display: 'inline-block',
            }}>▾</span>
          </div>

          {glExpanded && (
            <div style={{ borderTop: `1px solid ${T.border}`, background: T.surfaceAlt }}>
              {/* вкладки предметов */}
              <div style={{
                display: 'flex', gap: 6, padding: '10px 14px 0',
                overflowX: 'auto', scrollbarWidth: 'none',
              } as React.CSSProperties}>
                {availableSubjects.map(s => {
                  const active = glSubject === s.id;
                  return (
                    <button key={s.id} onClick={() => {
                      setGlSubject(s.id);
                      fetchGlEntries(s.id);
                    }} style={{
                      padding: '5px 12px', borderRadius: 999, flexShrink: 0,
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      background: active ? T.warn : T.surface,
                      color: active ? '#fff' : T.textMuted,
                      border: `1px solid ${active ? T.warn : T.border}`,
                      fontFamily: FONT_SANS, WebkitTapHighlightColor: 'transparent',
                    }}>{s.shortLabel}</button>
                  );
                })}
              </div>

              {/* список существующих кастомных записей */}
              <div style={{ padding: '10px 14px' }}>
                {glLoading ? (
                  <div style={{ padding: '12px 0', textAlign: 'center', color: T.textFaint, fontSize: 13 }}>
                    Загрузка...
                  </div>
                ) : glEntries.length === 0 ? (
                  <div style={{ padding: '8px 0', color: T.textMuted, fontSize: 13, textAlign: 'center' }}>
                    Кастомных записей нет — добавь первую
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                    {glEntries.map(entry => {
                      const busy = glDeleting === entry.id;
                      return (
                        <div key={entry.id} style={{
                          background: T.surface, border: `1px solid ${T.border}`,
                          borderRadius: 10, padding: '8px 10px',
                          display: 'flex', alignItems: 'flex-start', gap: 8,
                        }}>
                          {entry.image && (
                            <img
                              src={entry.image}
                              alt={entry.term}
                              style={{
                                width: 48, height: 48, borderRadius: 6,
                                objectFit: 'cover', flexShrink: 0,
                              }}
                            />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 12.5, fontWeight: 700, color: T.warn,
                              marginBottom: 2,
                            }}>{entry.term}</div>
                            <div style={{
                              fontSize: 12, color: T.textMuted, lineHeight: 1.4,
                              overflow: 'hidden', display: '-webkit-box',
                              WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                            } as React.CSSProperties}>{entry.definition}</div>
                          </div>
                          <button
                            onClick={() => deleteGlEntry(entry.id)}
                            disabled={busy}
                            style={{
                              background: T.dangerSoft, color: T.danger,
                              border: `1px solid ${T.danger}33`,
                              borderRadius: 8, padding: '4px 8px',
                              fontSize: 12, fontWeight: 600,
                              cursor: busy ? 'default' : 'pointer',
                              opacity: busy ? 0.5 : 1, flexShrink: 0,
                              fontFamily: FONT_SANS,
                              WebkitTapHighlightColor: 'transparent',
                            }}
                          >{busy ? '...' : '✕'}</button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* форма добавления нового термина */}
                <div style={{
                  background: T.surface, border: `1px solid ${T.warn}44`,
                  borderRadius: 12, padding: '11px 12px',
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: T.warn,
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>Добавить термин</div>

                  <input
                    value={glForm.term}
                    onChange={e => setGlForm(f => ({ ...f, term: e.target.value }))}
                    placeholder="Термин * (точно как в тексте вопроса)"
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '8px 10px', borderRadius: 8,
                      border: `1px solid ${T.border}`,
                      background: T.surfaceAlt, color: T.text,
                      fontSize: 13, fontFamily: FONT_SANS, outline: 'none',
                    }}
                  />

                  <textarea
                    value={glForm.definition}
                    onChange={e => setGlForm(f => ({ ...f, definition: e.target.value }))}
                    placeholder="Определение *"
                    rows={3}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '8px 10px', borderRadius: 8,
                      border: `1px solid ${T.border}`,
                      background: T.surfaceAlt, color: T.text,
                      fontSize: 13, fontFamily: FONT_SANS, outline: 'none',
                      resize: 'vertical',
                    }}
                  />

                  {/* картинка */}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      value={glForm.image}
                      onChange={e => setGlForm(f => ({ ...f, image: e.target.value }))}
                      placeholder="URL картинки (необязательно)"
                      style={{
                        flex: 1, minWidth: 0, boxSizing: 'border-box',
                        padding: '8px 10px', borderRadius: 8,
                        border: `1px solid ${T.border}`,
                        background: T.surfaceAlt, color: T.text,
                        fontSize: 13, fontFamily: FONT_SANS, outline: 'none',
                      }}
                    />
                  </div>

                  {/* превью картинки если заполнен URL */}
                  {glForm.image && (
                    <img
                      src={glForm.image}
                      alt="preview"
                      style={{
                        height: 80, borderRadius: 8, objectFit: 'cover',
                        border: `1px solid ${T.border}`, alignSelf: 'flex-start',
                      }}
                    />
                  )}

                  <ActionBtn
                    variant="warn"
                    fullWidth
                    disabled={glAdding || !glForm.term.trim() || !glForm.definition.trim()}
                    onClick={addGlEntry}
                  >
                    {glAdding ? '...' : '+ Добавить в глоссарий'}
                  </ActionBtn>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* связанные термины (relatedTerms) */}
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 14, marginBottom: 14, overflow: 'hidden',
        }}>
          <div
            onClick={() => {
              const next = !rtExpanded;
              setRtExpanded(next);
              if (next && !rtSubject && availableSubjects.length > 0) {
                const first = availableSubjects[0].id;
                setRtSubject(first);
                fetchRtItems(first, rtType);
              }
            }}
            style={{
              padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 10, background: T.purpleSoft,
              color: T.purple, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 18, flexShrink: 0,
            }}>📖</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text, marginBottom: 2 }}>
                Связанные термины
              </div>
              <div style={{ fontSize: 11.5, color: T.textMuted, lineHeight: 1.4 }}>
                relatedTerms для вопросов, тестов и задач
              </div>
            </div>
            <span style={{
              color: T.textFaint, fontSize: 13,
              transform: rtExpanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s', display: 'inline-block',
            }}>▾</span>
          </div>

          {rtExpanded && (
            <div style={{ borderTop: `1px solid ${T.border}`, background: T.surfaceAlt }}>
              {/* вкладки предметов */}
              <div style={{
                display: 'flex', gap: 6, padding: '10px 14px 0',
                overflowX: 'auto', scrollbarWidth: 'none',
              } as React.CSSProperties}>
                {availableSubjects.map(s => {
                  const active = rtSubject === s.id;
                  return (
                    <button key={s.id} onClick={() => {
                      setRtSubject(s.id);
                      fetchRtItems(s.id, rtType);
                    }} style={{
                      padding: '5px 12px', borderRadius: 999, flexShrink: 0,
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      background: active ? T.purple : T.surface,
                      color: active ? '#fff' : T.textMuted,
                      border: `1px solid ${active ? T.purple : T.border}`,
                      fontFamily: FONT_SANS, WebkitTapHighlightColor: 'transparent',
                    }}>{s.shortLabel}</button>
                  );
                })}
              </div>

              {/* вкладки раздела */}
              <div style={{ display: 'flex', gap: 6, padding: '8px 14px 0' }}>
                {([
                  { id: 'questions', label: 'Вопросы' },
                  { id: 'tests',     label: 'Тесты'   },
                  { id: 'tasks',     label: 'Задачи'  },
                ] as const).map(tab => {
                  const active = rtType === tab.id;
                  return (
                    <button key={tab.id} onClick={() => {
                      setRtType(tab.id);
                      if (rtSubject) fetchRtItems(rtSubject, tab.id);
                    }} style={{
                      padding: '4px 11px', borderRadius: 999, flexShrink: 0,
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      background: active ? T.text : T.surface,
                      color: active ? '#fff' : T.textMuted,
                      border: `1px solid ${active ? T.text : T.border}`,
                      fontFamily: FONT_SANS, WebkitTapHighlightColor: 'transparent',
                    }}>{tab.label}</button>
                  );
                })}
              </div>

              {/* поиск по элементам */}
              <div style={{ padding: '8px 14px 0', position: 'relative' }}>
                <input
                  value={rtSearch}
                  onChange={e => setRtSearch(e.target.value)}
                  placeholder="Поиск по тексту вопроса..."
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '7px 10px', borderRadius: 8,
                    border: `1px solid ${T.border}`,
                    background: T.surface, color: T.text,
                    fontSize: 13, fontFamily: FONT_SANS, outline: 'none',
                  }}
                />
              </div>

              {/* список элементов */}
              <div style={{ padding: '8px 14px', maxHeight: 280, overflowY: 'auto' }}>
                {rtLoading ? (
                  <div style={{ padding: '12px 0', textAlign: 'center', color: T.textFaint, fontSize: 13 }}>
                    Загрузка...
                  </div>
                ) : rtItems.length === 0 ? (
                  <div style={{ padding: '10px 0', color: T.textMuted, fontSize: 13, textAlign: 'center' }}>
                    Нет данных
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {rtItems
                      .filter(item => !rtSearch.trim() || item.preview.toLowerCase().includes(rtSearch.trim().toLowerCase()))
                      .map(item => {
                        const selected = rtSelectedId === item.id;
                        return (
                          <button
                            key={item.id}
                            onClick={() => {
                              if (selected) { setRtSelectedId(null); setRtTerms([]); return; }
                              setRtSelectedId(item.id);
                              setRtTerms([...item.relatedTerms]);
                              setRtNewTerm('');
                            }}
                            style={{
                              width: '100%', textAlign: 'left',
                              padding: '7px 10px', borderRadius: 8,
                              border: `1px solid ${selected ? T.purple + '66' : T.border}`,
                              background: selected ? T.purpleSoft : T.surface,
                              cursor: 'pointer', fontFamily: FONT_SANS,
                              WebkitTapHighlightColor: 'transparent',
                              display: 'flex', alignItems: 'center', gap: 8,
                            }}
                          >
                            <span style={{
                              fontFamily: FONT_MONO, fontSize: 10, color: T.textFaint,
                              flexShrink: 0, minWidth: 28,
                            }}>#{item.id}</span>
                            <span style={{
                              fontSize: 12.5, color: selected ? T.purple : T.text,
                              flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>{item.preview}</span>
                            {item.relatedTerms.length > 0 && (
                              <span style={{
                                background: T.purpleSoft, color: T.purple,
                                borderRadius: 5, padding: '1px 6px',
                                fontSize: 10.5, fontWeight: 600, flexShrink: 0,
                              }}>{item.relatedTerms.length}</span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* сброс кэша */}
              <div style={{ padding: '0 14px 14px', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={bustCache}
                  disabled={rtBusting}
                  style={{
                    padding: '6px 14px', borderRadius: 8, border: `1px solid ${T.accent}44`,
                    background: T.accentSoft, color: T.accent,
                    fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                    fontFamily: FONT_SANS, WebkitTapHighlightColor: 'transparent',
                    opacity: rtBusting ? 0.6 : 1,
                  }}
                >
                  {rtBusting ? 'Сброс...' : '🔄 Обновить кэш у всех'}
                </button>
              </div>

              {/* редактор терминов выбранного элемента */}
              {rtSelectedId && (
                <div style={{
                  margin: '0 14px 14px',
                  background: T.surface, border: `1px solid ${T.purple}44`,
                  borderRadius: 12, padding: '12px',
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: T.purple,
                    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10,
                  }}>
                    Термины для #{rtSelectedId}
                  </div>

                  {/* текущие термины — чипы с × */}
                  {rtTerms.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                      {rtTerms.map((term, i) => (
                        <span key={i} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          background: T.purpleSoft, color: T.purple,
                          border: `1px solid ${T.purple}33`,
                          borderRadius: 999, padding: '4px 8px 4px 10px',
                          fontSize: 12.5, fontWeight: 500,
                        }}>
                          {term}
                          <button
                            onClick={() => {
                              const next = rtTerms.filter((_, j) => j !== i);
                              setRtTerms(next);
                              saveRtTerms(rtSubject, rtType, rtSelectedId, next);
                            }}
                            disabled={rtSaving}
                            style={{
                              width: 16, height: 16, borderRadius: '50%',
                              background: T.purple + '33', color: T.purple,
                              border: 'none', cursor: 'pointer', padding: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 10, lineHeight: 1, fontWeight: 700,
                              WebkitTapHighlightColor: 'transparent',
                            }}
                          >×</button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: T.textFaint, marginBottom: 10 }}>
                      Терминов пока нет — добавь первый
                    </div>
                  )}

                  {/* ввод нового термина */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      value={rtNewTerm}
                      onChange={e => setRtNewTerm(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && rtNewTerm.trim() && !rtSaving) {
                          const t = rtNewTerm.trim().toLowerCase();
                          if (rtTerms.includes(t)) { showToast('Термин уже есть'); return; }
                          const next = [...rtTerms, t];
                          setRtTerms(next);
                          setRtNewTerm('');
                          saveRtTerms(rtSubject, rtType, rtSelectedId, next);
                        }
                      }}
                      placeholder="Новый термин (Enter для добавления)"
                      style={{
                        flex: 1, minWidth: 0, boxSizing: 'border-box',
                        padding: '7px 10px', borderRadius: 8,
                        border: `1px solid ${T.border}`,
                        background: T.surfaceAlt, color: T.text,
                        fontSize: 13, fontFamily: FONT_SANS, outline: 'none',
                      }}
                    />
                    <ActionBtn
                      variant="info"
                      disabled={rtSaving || !rtNewTerm.trim()}
                      onClick={() => {
                        const t = rtNewTerm.trim().toLowerCase();
                        if (!t) return;
                        if (rtTerms.includes(t)) { showToast('Термин уже есть'); return; }
                        const next = [...rtTerms, t];
                        setRtTerms(next);
                        setRtNewTerm('');
                        saveRtTerms(rtSubject, rtType, rtSelectedId, next);
                      }}
                    >
                      {rtSaving ? '...' : '+ Добавить'}
                    </ActionBtn>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        </>)}

        {adminTab === 'access' && secret && (
          <AdminGroupAccessTab secret={secret} showToast={showToast} />
        )}

        {adminTab === 'lessons' && secret && (
          <AdminCurriculumTab secret={secret} showToast={showToast} />
        )}

        {adminTab === 'students' && (<>

        {/* stat-плитки */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14,
        }}>
          <StatTile label="Всего"   value={total}           accent={T.info} />
          <StatTile label="Блок"    value={blockedCount}    accent={T.danger} />
          <StatTile label="Подозр"  value={suspiciousCount} accent={T.warn} />
          <StatTile label="Микро"   value={microCount}      accent={T.success} />
        </div>

        {/* демо-баннер */}
        <div
          onClick={() => setFilter('demo')}
          style={{
            background: filter === 'demo' ? T.purpleSoft : T.purpleSoft + '88',
            border: `1px solid ${filter === 'demo' ? T.purple + '55' : T.purple + '22'}`,
            borderRadius: 12, padding: '11px 13px',
            display: 'flex', alignItems: 'center', gap: 10,
            marginBottom: 14, cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <div style={{ flex: 1 }}>
            <span style={{ color: T.purple, fontWeight: 700, fontSize: 15 }}>{demoCount}</span>
            <span style={{ color: T.purple, opacity: 0.75, fontSize: 12.5, marginLeft: 6 }}>
              использовали пробный доступ
            </span>
          </div>
          <span style={{ color: T.purple, fontSize: 12, fontWeight: 600 }}>
            {filter === 'demo' ? '✓ активен' : 'фильтр →'}
          </span>
        </div>

        {/* pill-фильтры */}
        <div style={{
          display: 'flex', gap: 7, marginBottom: 12,
          overflowX: 'auto', paddingBottom: 2,
          scrollbarWidth: 'none', msOverflowStyle: 'none',
        } as React.CSSProperties}>
          {[
            { id: 'all' as Filter,        label: 'Все',        count: total,            accent: T.accent  },
            { id: 'blocked' as Filter,    label: 'Блок',       count: blockedCount,     accent: T.danger  },
            { id: 'suspicious' as Filter, label: 'Подозрит.',  count: suspiciousCount,  accent: T.warn    },
            { id: 'unpaid' as Filter,     label: 'Без 💲',     count: unpaidCount,      accent: T.warn    },
            { id: 'demo' as Filter,       label: 'Пробный',    count: demoCount,        accent: T.purple  },
          ].map(tab => {
            const active = filter === tab.id;
            return (
              <button key={tab.id} onClick={() => setFilter(tab.id)} style={{
                padding: '7px 13px', borderRadius: 999,
                fontSize: 13, fontWeight: 600,
                cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto',
                border: `1px solid ${active ? tab.accent : T.border}`,
                background: active ? tab.accent : T.surface,
                color: active ? '#fff' : T.textMuted,
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontFamily: FONT_SANS,
                WebkitTapHighlightColor: 'transparent',
              }}>
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    background: active ? 'rgba(255,255,255,0.22)' : T.chipBg,
                    color: active ? '#fff' : T.textMuted,
                    borderRadius: 8, padding: '1px 7px', minWidth: 18, textAlign: 'center',
                  }}>{tab.count}</span>
                )}
              </button>
            );
          })}
        </div>

     {/* сортировка */}
        <div style={{
          display: 'flex', gap: 6, marginBottom: 10,
          overflowX: 'auto', paddingBottom: 2,
          scrollbarWidth: 'none', msOverflowStyle: 'none',
        } as React.CSSProperties}>
          {([
            {
              id: 'registered' as const,
              label: sortBy === 'registered'
                ? (registeredAsc ? 'Старые сначала' : 'Новые сначала')
                : 'Новые сначала',
            },
            { id: 'lastActivity' as const, label: 'Последняя активность' },
            { id: 'loginCount' as const, label: 'Активность сегодня' },
          ]).map(opt => {
            const active = sortBy === opt.id;
            const arrow  = active
              ? (opt.id === 'registered' && registeredAsc ? '↑ ' : '↓ ')
              : '';
            return (
              <button key={opt.id} onClick={() => handleSortClick(opt.id)} style={{
                padding: '6px 12px', borderRadius: 999,
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                whiteSpace: 'nowrap', flex: '0 0 auto',
                border: `1px solid ${active ? T.accent : T.border}`,
                background: active ? T.accentSoft : T.surface,
                color: active ? T.accent : T.textMuted,
                fontFamily: FONT_SANS,
                WebkitTapHighlightColor: 'transparent',
              }}>
                {arrow}{opt.label}
              </button>
            );
          })}
        </div>

        {/* поиск */}
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <span style={{
            position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
            color: T.textFaint, fontSize: 14, pointerEvents: 'none',
          }}>⌕</span>
          <input
            placeholder="Имя, @username или Telegram ID"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '11px 34px 11px 34px',
              borderRadius: 11, border: `1px solid ${T.border}`,
              background: T.surface, color: T.text, fontSize: 14, outline: 'none',
              fontFamily: FONT_SANS,
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: T.textFaint,
              cursor: 'pointer', fontSize: 20, padding: '4px', lineHeight: 1,
            }}>×</button>
          )}
        </div>

        {loading && users.length === 0 ? (
          <div style={{ textAlign: 'center', color: T.textFaint, padding: '60px 0' }}>Загрузка...</div>
        ) : users.length === 0 ? (
          <div style={{
            textAlign: 'center', color: T.textMuted, padding: '50px 0',
            background: T.surface, borderRadius: 12, border: `1px solid ${T.border}`,
          }}>
            {search ? 'Ничего не найдено' : 'Нет пользователей'}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {users.map(u => (
                <UserCard
                  key={u.tgId} user={u} actioning={actioning}
                  onAction={doAction}
                  expanded={expandedIds.has(u.tgId)}
                  onToggle={() => toggleExpand(u.tgId)}
                  availableSubjects={availableSubjects}
                  onCopy={copyToClipboard}
                />
              ))}
            </div>
            {hasMore && (
              <button
                onClick={loadMoreUsers}
                disabled={refreshing}
                style={{
                  width: '100%', marginTop: 12, padding: '12px',
                  borderRadius: 12, border: `1px solid ${T.border}`,
                  background: T.surface, color: T.textMuted,
                  fontSize: 13, fontWeight: 600, cursor: refreshing ? 'default' : 'pointer',
                  fontFamily: FONT_SANS,
                }}
              >
                {refreshing ? 'Загрузка…' : `Ещё (${users.length} из ${filteredTotal})`}
              </button>
            )}
          </>
        )}

        </>)}

      </div>
    </div>
  );

  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      {!authed ? loginScreen : mainPanel}
    </>
  );
}