"use client";

import React, { useState, useMemo } from 'react';

interface GlossaryItem {
  term: string;
  definition: string;
}

interface Props {
  text: string;
  glossary: GlossaryItem[];
}

export const TextWithGlossary: React.FC<Props> = ({ text, glossary }) => {
  const [activeWord, setActiveWord] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const escapeRegExp = (str: string) =>
    str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const regex = useMemo(() => {
    if (!glossary.length) return null;
    const terms = glossary
      .filter(g => g.term?.trim() && g.definition?.trim())
      .map(g => escapeRegExp(g.term))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length); // длинные первыми
    if (terms.length === 0) return null;
    return new RegExp(`\\b(${terms.join('|')})\\b`, 'gi');
  }, [glossary]);

  const findDefinition = (word: string) => {
    const found = glossary.find(
      g => g.term.toLowerCase() === word.toLowerCase() && g.definition?.trim()
    );
    return found?.definition;
  };

  // Примерные габариты тултипа: max-w-xs (320px) + запас на паддинги.
  const TOOLTIP_W = 330;
  const TOOLTIP_H = 200;
  const EDGE_GAP  = 8;

  /** Держим тултип внутри экрана — иначе у края он уезжает за границу. */
  const clampToViewport = (x: number, y: number) => {
    if (typeof window === 'undefined') return { x, y };
    const maxX = window.innerWidth  - TOOLTIP_W - EDGE_GAP;
    const maxY = window.innerHeight - TOOLTIP_H - EDGE_GAP;
    return {
      x: Math.max(EDGE_GAP, Math.min(x + 10, Math.max(EDGE_GAP, maxX))),
      y: Math.max(EDGE_GAP, Math.min(y + 10, Math.max(EDGE_GAP, maxY))),
    };
  };

  const handleTermClick = (e: React.MouseEvent, word: string) => {
    e.stopPropagation();
    const def = findDefinition(word);
    if (def) {
      setActiveWord(word);
      setTooltipPos(clampToViewport(e.clientX, e.clientY));
    }
  };

  const closeTooltip = () => setActiveWord(null);

  if (!regex) return <p className="whitespace-pre-wrap text-foreground">{text}</p>;

  // Разбиваем текст на куски
  const parts: { text: string; isTerm: boolean }[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const textCopy = text; // чтобы не мутировать

  // Создаём временную регулярку для поиска (каждый раз новая, но в useMemo сохранена основная)
  const execRegex = new RegExp(regex.source, 'gi');
  while ((match = execRegex.exec(textCopy)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: textCopy.substring(lastIndex, match.index), isTerm: false });
    }
    parts.push({ text: match[0], isTerm: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < textCopy.length) {
    parts.push({ text: textCopy.substring(lastIndex), isTerm: false });
  }

  return (
    <div className="relative">
      <p className="whitespace-pre-wrap text-foreground">
        {parts.map((part, i) =>
          part.isTerm ? (
            <span
              key={i}
              className="text-primary underline decoration-dotted cursor-pointer active:text-primary/70"
              onClick={(e) => handleTermClick(e, part.text)}
              title="Нажми, чтобы увидеть определение"
            >
              {part.text}
            </span>
          ) : (
            <span key={i}>{part.text}</span>
          )
        )}
      </p>

      {/* Тултип с определением */}
      {activeWord && (
        <div
          className="fixed z-50 bg-card border border-border rounded-2xl p-4 shadow-2xl max-w-xs"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
          onClick={closeTooltip}
        >
          <h4 className="text-foreground font-bold mb-1">{activeWord}</h4>
          <p className="text-muted-foreground text-sm">{findDefinition(activeWord)}</p>
          <button
            onClick={closeTooltip}
            className="mt-2 text-xs text-primary underline"
          >
            Закрыть
          </button>
        </div>
      )}
    </div>
  );
};