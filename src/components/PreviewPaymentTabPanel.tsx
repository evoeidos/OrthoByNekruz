"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSubject } from '@/lib/subjects';
import { PREVIEW_MODULE_LABELS, normalizePreviewModules, type PreviewModule } from '@/lib/previewModules';
import type { PreviewModuleStatusMap } from '@/lib/previewModuleStatus';
import {
  bioUserHadTest,
  describePreviewPrice,
  formatPriceRub,
  getPaymentModuleRow,
  getPharmaLateExamPromoNote,
  PAYMENT_MODULE_ROW_ORDER,
} from '@/lib/previewPricing';
import { openTgChat } from '@/lib/tgLinks';
import { Copy, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const PAYMENT_BANK = 'Альфа-Банк';
const PAYMENT_CARD_DISPLAY = '2200 1541 2618 5783';
const PAYMENT_CARD_COPY = '2200154126185783';
const PAYMENT_RECIPIENT = 'Amin Guseinov';
const RECEIPT_TG_URL = 'https://t.me/evoeidos';
const RECEIPT_TG_HANDLE = '@evoeidos';

/** Нижняя навигация fixed — контент должен прокручиваться выше неё. */
const NAV_SCROLL_PAD = 'calc(var(--nav-bottom, 12px) + 92px)';

const MODULE_ROW_LABELS: Record<PreviewModule, string> = {
  questions: 'Вопросы',
  tests:     'Тест',
  tasks:     'Задачи',
};

interface PreviewPaymentTabPanelProps {
  subjectId: string;
  module: PreviewModule;
  chosenModules: PreviewModule[];
  grantedModules?: PreviewModule[];
  moduleStatuses?: PreviewModuleStatusMap;
  /** Сохранённый выбор на экране оплаты (с сервера). */
  paymentSelection?: PreviewModule[] | null;
  status: 'awaiting_payment' | 'rejected' | 'receipt_pending';
  checking?: boolean;
  modulesUpdating?: boolean;
  onUpdateModules?: (modules: PreviewModule[]) => void;
  onClaimReceipt?: (modules: PreviewModule[]) => void;
  onBackToPurchased?: () => void;
  onBackToAvailable?: () => void;
  backBusy?: boolean;
}

export const PreviewPaymentTabPanel: React.FC<PreviewPaymentTabPanelProps> = ({
  subjectId,
  module,
  chosenModules,
  grantedModules = [],
  moduleStatuses = {},
  paymentSelection = null,
  status,
  checking = false,
  modulesUpdating = false,
  onUpdateModules,
  onClaimReceipt,
  onBackToPurchased,
  onBackToAvailable,
  backBusy = false,
}) => {
  const { toast } = useToast();
  const [receiptOpen, setReceiptOpen] = useState(false);
  const subjectCfg = getSubject(subjectId);
  const accent = subjectCfg?.color ?? 'hsl(var(--primary))';

  const rowOptions = useMemo(
    () => getPaymentModuleRow(subjectId, grantedModules),
    [subjectId, grantedModules],
  );

  const grantedSet = useMemo(() => new Set(grantedModules), [grantedModules]);

  /** Разделы с истёкшей пробой. */
  const dueModules = useMemo(() => (
    PAYMENT_MODULE_ROW_ORDER.filter(m => {
      if (!chosenModules.includes(m) || grantedSet.has(m)) return false;
      const st = moduleStatuses[m];
      return st === 'awaiting_payment' || st === 'rejected';
    })
  ), [chosenModules, grantedSet, moduleStatuses]);

  /** Разделы не из пробы — можно добавить к покупке. */
  const additionalModules = useMemo(() => (
    PAYMENT_MODULE_ROW_ORDER.filter(m => {
      if (chosenModules.includes(m) || grantedSet.has(m)) return false;
      const opt = rowOptions.find(o => o.id === m);
      return opt?.selectable === true;
    })
  ), [chosenModules, grantedSet, rowOptions]);

  /** Можно включать/выключать в сумму: проба, оплата, отказ, и добавляемые разделы. */
  const toggleableModules = useMemo(() => (
    PAYMENT_MODULE_ROW_ORDER.filter(m => {
      if (grantedSet.has(m)) return false;
      if (chosenModules.includes(m)) {
        const st = moduleStatuses[m];
        return st === 'trial' || st === 'awaiting_payment' || st === 'rejected' || !st;
      }
      const opt = rowOptions.find(o => o.id === m);
      return opt?.selectable === true;
    })
  ), [chosenModules, grantedSet, moduleStatuses, rowOptions]);

  const stillInTrial = useMemo(
    () => chosenModules.filter(m => {
      if (grantedSet.has(m)) return false;
      const st = moduleStatuses[m];
      return st === 'trial' || !st;
    }),
    [chosenModules, grantedSet, moduleStatuses],
  );

  const isPharma = subjectId === 'pharma';

  /** По умолчанию — все разделы из пробы (полная сумма сразу), без «добавить». */
  const defaultPaymentSelection = useMemo(() => {
    const saved = normalizePreviewModules(paymentSelection).filter(m => toggleableModules.includes(m));
    if (saved.length > 0) return saved;
    const fromPreview = toggleableModules.filter(m => chosenModules.includes(m));
    if (fromPreview.length > 0) return fromPreview;
    if (toggleableModules.includes(module)) return [module];
    return dueModules.slice(0, 1);
  }, [paymentSelection, dueModules, module, toggleableModules, chosenModules]);

  const selectionKey = [
    defaultPaymentSelection.join('|'),
    dueModules.join('|'),
    toggleableModules.join('|'),
    (paymentSelection ?? []).join('|'),
  ].join('::');

  const [selected, setSelected] = useState<PreviewModule[]>(defaultPaymentSelection);
  const syncedSelectionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (syncedSelectionKeyRef.current === selectionKey) return;
    syncedSelectionKeyRef.current = selectionKey;
    setSelected(defaultPaymentSelection);
    if (defaultPaymentSelection.length > 0) {
      onUpdateModules?.(defaultPaymentSelection);
    }
  }, [selectionKey, defaultPaymentSelection, onUpdateModules]);

  const modulePhase = useCallback((id: PreviewModule): 'owned' | 'due' | 'trial' => {
    if (grantedSet.has(id)) return 'owned';
    const st = moduleStatuses[id];
    if (st === 'awaiting_payment' || st === 'rejected') return 'due';
    return 'trial';
  }, [grantedSet, moduleStatuses]);

  const bioHadTest = useMemo(
    () => bioUserHadTest([...new Set([...selected, ...grantedModules])], grantedModules),
    [selected, grantedModules],
  );

  const priceSummary = useMemo(
    () => describePreviewPrice(subjectId, selected, { bioHadTest }),
    [subjectId, selected, bioHadTest],
  );

  const persistSelection = useCallback((next: PreviewModule[]) => {
    setSelected(next);
    onUpdateModules?.(next);
  }, [onUpdateModules]);

  const toggleModule = useCallback((id: PreviewModule) => {
    const opt = rowOptions.find(o => o.id === id);
    if (opt?.alreadyOwned || modulesUpdating || checking) return;
    if (!toggleableModules.includes(id)) return;

    const next = selected.includes(id)
      ? selected.filter(m => m !== id)
      : [...selected, id];
    const ordered = PAYMENT_MODULE_ROW_ORDER.filter(m => next.includes(m));
    if (ordered.length === 0) return;

    persistSelection(ordered);
  }, [
    rowOptions, selected, modulesUpdating, checking, persistSelection, toggleableModules,
  ]);

  const copyCard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(PAYMENT_CARD_COPY);
      toast({
        title: 'Номер карты скопирован',
        description: 'Вставь при переводе в Альфа-Банк',
      });
    } catch {
      toast({ variant: 'destructive', title: 'Не удалось скопировать' });
    }
  }, [toast]);

  const openReceiptChat = useCallback(() => {
    openTgChat(RECEIPT_TG_URL);
  }, []);

  const canExit = !!(onBackToPurchased || onBackToAvailable);
  const exitLabel = onBackToPurchased ? 'Выйти' : 'Назад';

  const exitButton = canExit ? (
    <button
      type="button"
      disabled={backBusy || checking}
      onClick={onBackToPurchased ?? onBackToAvailable}
      className="w-full h-11 rounded-xl text-sm font-semibold disabled:opacity-45"
      style={{
        background: 'var(--c-card)',
        border: '1px solid var(--c-border)',
        color: 'var(--c-muted)',
      }}
    >
      {backBusy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : exitLabel}
    </button>
  ) : null;

  if (status === 'receipt_pending') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-4">
        <div className="text-4xl">⏳</div>
        <h2 className="text-lg font-bold" style={{ color: 'var(--c-text)' }}>
          Проверяем оплату
        </h2>
        <p className="text-sm leading-relaxed max-w-xs" style={{ color: 'var(--c-muted)' }}>
          Раздел «{PREVIEW_MODULE_LABELS[module]}» — ждём подтверждения администратора.
        </p>
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-y-auto overscroll-contain"
      style={{ WebkitOverflowScrolling: 'touch', paddingBottom: NAV_SCROLL_PAD }}
    >
      <div className="flex flex-col items-center p-6 pt-8">
        <div className="max-w-sm w-full text-center space-y-5">
        <div className="text-4xl">{status === 'rejected' ? '↩️' : '💳'}</div>
        <div className="space-y-2 px-1">
          <h2 className="text-lg font-bold leading-snug" style={{ color: 'var(--c-text)' }}>
            {status === 'rejected' ? 'Оплата не подтверждена' : 'Выбери разделы и оплати'}
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--c-muted)' }}>
            {status === 'rejected'
              ? 'Нужен новый перевод — отметь разделы, которые хочешь открыть.'
              : stillInTrial.length > 0
                ? 'Не обязательно ждать конца пробы остальных разделов. Отметь что нужно — сумма ниже, после «войти» откроются выбранные.'
                : 'Отметь разделы, переведи сумму и нажми «войти» — откроем именно то, что выбрано.'}
          </p>
        </div>

        {status === 'rejected' && (
          <div
            className="rounded-2xl px-4 py-3.5 text-left"
            style={{
              background: 'var(--c-danger-soft)',
              border: '1px solid hsl(var(--destructive) / 0.35)',
            }}
          >
            <p className="text-[13px] font-bold leading-snug" style={{ color: 'var(--c-danger)' }}>
              Не оплатил — не входи.
            </p>
            <p className="text-[12px] leading-relaxed mt-1.5" style={{ color: 'var(--c-text)' }}>
              Если нажмёшь «войти» без реального перевода, аккаунт заблокируют{' '}
              <span className="font-semibold">навсегда</span>. Это не предупреждение на один раз — бан без разблокировки.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={copyCard}
          className="w-full rounded-2xl px-4 py-3.5 text-left transition-opacity active:opacity-80"
          style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--c-muted)' }}>
                {PAYMENT_BANK}
              </p>
              <p className="text-base font-bold mt-0.5 tabular-nums tracking-wide" style={{ color: 'var(--c-text)' }}>
                {PAYMENT_CARD_DISPLAY}
              </p>
              <p className="text-[12px] mt-1 font-medium" style={{ color: 'var(--c-text)' }}>
                {PAYMENT_RECIPIENT}
              </p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--c-muted)' }}>
                Нажми, чтобы скопировать номер карты
              </p>
            </div>
            <Copy className="w-5 h-5 shrink-0" style={{ color: 'var(--c-primary)' }} />
          </div>
        </button>

        <div className="flex gap-2 w-full">
          {rowOptions.map(opt => {
            const phase = modulePhase(opt.id);
            const on = selected.includes(opt.id);
            const isTrial = phase === 'trial' && chosenModules.includes(opt.id);
            const isDue = phase === 'due';
            const isAdditional = additionalModules.includes(opt.id);
            const isLastSelected = on && selected.length <= 1;
            const canToggle = toggleableModules.includes(opt.id);
            const disabled = opt.alreadyOwned || modulesUpdating || checking
              || isLastSelected
              || !canToggle;
            const unit = opt.unitPriceRub;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={disabled}
                onClick={() => toggleModule(opt.id)}
                className="flex-1 min-w-0 min-h-[52px] rounded-xl text-[11px] font-bold leading-tight px-1 py-1.5 transition-all active:scale-[0.98] disabled:opacity-40 flex flex-col items-center justify-center gap-0.5"
                style={{
                  background: on
                    ? `color-mix(in srgb, ${accent} 18%, var(--c-card))`
                    : 'var(--c-card)',
                  border: `1.5px solid ${on ? accent : isDue ? accent : 'var(--c-border)'}`,
                  color: on ? accent : 'var(--c-muted)',
                }}
              >
                {phase === 'owned' ? (
                  '✓'
                ) : (
                  <>
                    <span>{MODULE_ROW_LABELS[opt.id]}</span>
                    {unit != null && (
                      <span className="text-[10px] font-semibold tabular-nums opacity-90">
                        {formatPriceRub(unit)}
                      </span>
                    )}
                    {isPharma && !opt.alreadyOwned && (
                      <span className="text-[8px] font-semibold uppercase tracking-wide opacity-70">
                        в комплекте
                      </span>
                    )}
                    {isTrial && !isPharma && (
                      <span className="text-[8px] font-semibold uppercase tracking-wide opacity-70">
                        ещё проба
                      </span>
                    )}
                    {isDue && !isPharma && (
                      <span className="text-[8px] font-semibold uppercase tracking-wide opacity-70">
                        проба кончилась
                      </span>
                    )}
                    {isAdditional && (
                      <span className="text-[8px] font-semibold uppercase tracking-wide opacity-70">
                        {on ? 'добавлен' : 'добавить'}
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>

        {isPharma && status !== 'rejected' && (
          <div
            className="rounded-2xl px-4 py-3.5 text-left"
            style={{
              background: `color-mix(in srgb, ${accent} 12%, var(--c-card))`,
              border: `1px solid color-mix(in srgb, ${accent} 28%, var(--c-border))`,
            }}
          >
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--c-text)' }}>
              {getPharmaLateExamPromoNote()}
            </p>
          </div>
        )}

        {priceSummary && (
          <div
            className="rounded-2xl px-4 py-4"
            style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--c-muted)' }}>
              К оплате за выбранное
            </p>
            <div className="flex items-center justify-center gap-2">
              <p className="text-3xl font-bold tabular-nums" style={{ color: accent }}>
                {formatPriceRub(priceSummary.total)}
              </p>
              {modulesUpdating && (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" style={{ color: 'var(--c-muted)' }} />
              )}
            </div>
            <p className="text-xs mt-1.5" style={{ color: 'var(--c-muted)' }}>
              {subjectCfg ? subjectCfg.label : ''}
              {priceSummary.lines.length > 0
                ? `${subjectCfg ? ' · ' : ''}${priceSummary.lines.join(' · ')}`
                : ''}
            </p>
            <p className="text-[11px] mt-2 leading-snug" style={{ color: 'var(--c-muted)' }}>
              После «войти» откроются только отмеченные разделы.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2 text-[15px] leading-relaxed px-1">
          <span style={{ color: 'var(--c-muted)' }}>скинь чек</span>
          <button
            type="button"
            onClick={openReceiptChat}
            className="font-bold underline underline-offset-2 decoration-primary/40"
            style={{ color: 'var(--c-primary)' }}
          >
            {RECEIPT_TG_HANDLE}
          </button>
          <span style={{ color: 'var(--c-muted)' }}>и</span>
          <button
            type="button"
            disabled={checking || modulesUpdating || selected.length === 0}
            onClick={() => setReceiptOpen(true)}
            className="h-9 px-4 rounded-xl text-sm font-bold disabled:opacity-50"
            style={{ background: 'var(--c-primary)', color: 'var(--c-bg)' }}
          >
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'войди'}
          </button>
        </div>

        {exitButton}
        </div>
      </div>

      {receiptOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setReceiptOpen(false)}
        >
          <div
            className="max-w-sm w-full rounded-2xl p-5 space-y-4 text-center"
            style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}
            onClick={e => e.stopPropagation()}
          >
            {status === 'rejected' && (
              <p
                className="text-xs leading-relaxed rounded-xl px-3 py-2.5"
                style={{ background: 'var(--c-danger-soft)', color: 'var(--c-danger)' }}
              >
                Вход без оплаты = перманентный бан. Продолжай только если перевод уже был.
              </p>
            )}
            <p className="text-sm leading-relaxed" style={{ color: 'var(--c-text)' }}>
              Скинул чек в{' '}
              <button
                type="button"
                onClick={openReceiptChat}
                className="font-semibold underline"
                style={{ color: 'var(--c-primary)' }}
              >
                {RECEIPT_TG_HANDLE}
              </button>
              {' '}и перевёл {formatPriceRub(priceSummary?.total ?? 0)}?
            </p>
            <button
              type="button"
              disabled={checking || selected.length === 0}
              onClick={() => {
                setReceiptOpen(false);
                onClaimReceipt?.(selected);
              }}
              className="w-full h-11 rounded-xl text-sm font-bold disabled:opacity-50"
              style={{
                background: status === 'rejected' ? 'var(--c-danger)' : 'var(--c-primary)',
                color: 'var(--c-bg)',
              }}
            >
              {checking
                ? <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                : status === 'rejected' ? 'Да, оплатил — войти' : 'Да, войти'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
