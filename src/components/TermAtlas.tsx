"use client";

import React, { useMemo, useState } from "react";
import { getAtlasPack, type AtlasPack, type AtlasTerm } from "@/data/atlas/vertebra";

type Mode = "look" | "find" | "cards";

function shuffle<T>(list: T[]): T[] {
  const next = [...list];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function viewById(pack: AtlasPack, id: string) {
  return pack.views.find(v => v.id === id) ?? pack.views[0];
}

function viewHasTerm(pack: AtlasPack, viewId: string, termId: string) {
  return viewById(pack, viewId).markers.some(m => m.id === termId);
}

function resolveView(pack: AtlasPack, termId: string, currentId: string) {
  if (viewHasTerm(pack, currentId, termId)) return currentId;
  const preferred = pack.preferredView[termId];
  if (preferred && viewHasTerm(pack, preferred, termId)) return preferred;
  return pack.views.find(v => v.markers.some(m => m.id === termId))?.id ?? currentId;
}

function termById(pack: AtlasPack, id: string): AtlasTerm | undefined {
  return pack.terms.find(t => t.id === id);
}

function cardChoices(pack: AtlasPack, correctId: string): AtlasTerm[] {
  const correct = termById(pack, correctId);
  if (!correct) return [];
  const others = shuffle(pack.terms.filter(t => t.id !== correctId)).slice(0, 3);
  return shuffle([correct, ...others]);
}

export function TermAtlas({
  atlasId,
  accent,
}: {
  atlasId: string;
  accent: string;
}) {
  const pack = getAtlasPack(atlasId);
  if (!pack) return null;

  return <AtlasBoard pack={pack} accent={accent} />;
}

function AtlasBoard({ pack, accent }: { pack: AtlasPack; accent: string }) {
  const startView = pack.primaryViews[0] ?? pack.views[0].id;
  const [mode, setMode] = useState<Mode>("look");
  const [viewId, setViewId] = useState(startView);
  const [activeId, setActiveId] = useState(pack.terms[0].id);
  const [queue, setQueue] = useState<string[]>(() => shuffle(pack.terms.map(t => t.id)));
  const [score, setScore] = useState({ ok: 0, done: 0 });
  const [feedback, setFeedback] = useState<"ok" | "bad" | null>(null);
  const [choices, setChoices] = useState<AtlasTerm[]>(() => cardChoices(pack, pack.terms[0].id));

  const view = viewById(pack, viewId);
  const active = termById(pack, activeId);
  const targetId = queue[0];
  const target = targetId ? termById(pack, targetId) : undefined;
  const finished = mode !== "look" && queue.length === 0;

  const primary = useMemo(
    () => pack.views.filter(v => pack.primaryViews.includes(v.id)),
    [pack],
  );

  function startRound(nextMode: Mode) {
    const nextQueue = shuffle(pack.terms.map(t => t.id));
    const first = nextQueue[0];
    setMode(nextMode);
    setQueue(nextQueue);
    setScore({ ok: 0, done: 0 });
    setFeedback(null);
    if (first) {
      setViewId(resolveView(pack, first, startView));
      setActiveId(first);
      setChoices(cardChoices(pack, first));
    }
  }

  function selectTerm(termId: string) {
    if (mode !== "look") return;
    setActiveId(termId);
    setViewId(resolveView(pack, termId, viewId));
  }

  function advance(correct: boolean) {
    setFeedback(correct ? "ok" : "bad");
    const nextQueue = queue.slice(1);
    window.setTimeout(() => {
      setScore(s => ({ ok: s.ok + (correct ? 1 : 0), done: s.done + 1 }));
      setQueue(nextQueue);
      setFeedback(null);
      const next = nextQueue[0];
      if (next) {
        setActiveId(next);
        setViewId(resolveView(pack, next, viewId));
        setChoices(cardChoices(pack, next));
      }
    }, 700);
  }

  function onDot(termId: string) {
    if (mode === "look") {
      setActiveId(termId);
      return;
    }
    if (mode === "find" && targetId && !feedback) {
      advance(termId === targetId);
    }
  }

  function onCard(termId: string) {
    if (mode !== "cards" || !targetId || feedback) return;
    advance(termId === targetId);
  }

  const highlightId = mode === "look" ? activeId : (feedback ? targetId : undefined);

  return (
    <div
      className="flex flex-col gap-2.5 rounded-2xl px-3 py-3"
      style={{
        background: "color-mix(in srgb, var(--c-bg) 55%, var(--c-card))",
        border: "1px solid var(--c-border)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: accent }}
        >
          Атлас · {pack.title}
        </span>
        <div className="flex gap-1">
          {([
            ["look", "Смотреть"],
            ["find", "Найди"],
            ["cards", "Карточки"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => (id === "look" ? setMode("look") : startRound(id))}
              className="text-[11px] font-bold px-2.5 py-1 rounded-full"
              style={mode === id
                ? { background: accent, color: "#fff" }
                : { color: "var(--c-muted)", border: "1px solid var(--c-border)" }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "look" ? (
        <p className="text-[12px] leading-snug" style={{ color: "var(--c-muted)" }}>
          Нажми латинское слово — откроется ракурс и точка на кости.
        </p>
      ) : finished ? (
        <p className="text-[13px] font-semibold" style={{ color: accent }}>
          {score.ok} из {score.done}. {score.ok === score.done ? "Все на месте." : "Повтори ошибки ещё раз."}
        </p>
      ) : mode === "find" ? (
        <p className="text-[13px] leading-snug">
          Найди на снимке:{" "}
          <span className="font-bold italic" style={{ color: accent }}>{target?.la}</span>
        </p>
      ) : (
        <p className="text-[13px] leading-snug">
          Как по-русски:{" "}
          <span className="font-bold italic" style={{ color: accent }}>{target?.la}</span>
        </p>
      )}

      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {primary.map(v => (
          <button
            key={v.id}
            type="button"
            onClick={() => { if (mode === "look") setViewId(v.id); }}
            className="flex-shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full"
            style={v.id === viewId
              ? { background: `color-mix(in srgb, ${accent} 22%, transparent)`, color: accent, border: `1px solid ${accent}` }
              : { color: "var(--c-muted)", border: "1px solid var(--c-border)" }}
          >
            {v.title}
          </button>
        ))}
        {!pack.primaryViews.includes(viewId) && (
          <span
            className="flex-shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full"
            style={{ background: `color-mix(in srgb, ${accent} 22%, transparent)`, color: accent, border: `1px solid ${accent}` }}
          >
            {view.title}
          </span>
        )}
      </div>

      <div
        className="relative mx-auto w-full overflow-hidden rounded-xl"
        style={{
          maxWidth: 360,
          aspectRatio: "3 / 4",
          background: "#111",
          border: "1px solid var(--c-border)",
        }}
      >
        <div
          className="absolute left-0 w-full"
          style={{ top: "-22%", height: "164%" }}
        >
          <img
            src={`${pack.imageBase}/${view.src}`}
            alt={view.title}
            className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
            draggable={false}
          />
          {view.markers.map(m => {
            const on = m.id === highlightId;
            return (
              <button
                key={m.id}
                type="button"
                aria-label={termById(pack, m.id)?.la ?? m.id}
                onClick={() => onDot(m.id)}
                className="absolute rounded-full"
                style={{
                  left: `${m.x}%`,
                  top: `${m.y}%`,
                  width: 22,
                  height: 22,
                  marginLeft: -11,
                  marginTop: -11,
                  border: on ? "2px solid #fff" : "2px solid rgba(255,255,255,.75)",
                  background: on
                    ? (feedback === "bad" ? "rgba(220,70,70,.7)" : `color-mix(in srgb, ${accent} 70%, transparent)`)
                    : "rgba(240,138,61,.35)",
                  boxShadow: on ? `0 0 0 2px ${accent}` : "0 0 0 1px rgba(0,0,0,.35)",
                }}
              >
                <span
                  className="block rounded-full"
                  style={{
                    width: 8,
                    height: 8,
                    margin: "5px auto 0",
                    background: "#fff",
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>

      {mode === "look" && active && (
        <div className="text-center">
          <div className="text-[16px] font-extrabold leading-tight">{active.ru}</div>
          <div className="text-[13px] italic" style={{ color: "var(--c-muted)" }}>{active.la}</div>
        </div>
      )}

      {mode === "look" && (
        <div className="flex flex-col gap-1 max-h-[220px] overflow-y-auto">
          {pack.terms.map(t => {
            const here = viewHasTerm(pack, viewId, t.id);
            const on = t.id === activeId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTerm(t.id)}
                className="text-left rounded-xl px-2.5 py-1.5"
                style={on
                  ? { background: `color-mix(in srgb, ${accent} 16%, transparent)`, border: `1px solid ${accent}` }
                  : { border: "1px solid var(--c-border)", opacity: here ? 1 : 0.72 }}
              >
                <div className="text-[13px] font-semibold leading-snug">{t.la}</div>
                <div className="text-[11px]" style={{ color: "var(--c-muted)" }}>
                  {t.ru}{here ? "" : " · другая проекция"}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {mode === "cards" && !finished && (
        <div className="grid grid-cols-1 gap-1.5">
          {choices.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => onCard(t.id)}
              className="text-left rounded-xl px-3 py-2 text-[13px] font-semibold"
              style={{
                border: `1px solid ${feedback && t.id === targetId ? accent : "var(--c-border)"}`,
                background: feedback && t.id === targetId
                  ? `color-mix(in srgb, ${accent} 18%, transparent)`
                  : "var(--c-card)",
              }}
            >
              {t.ru}
            </button>
          ))}
        </div>
      )}

      {mode !== "look" && !finished && (
        <div className="text-[11px] text-center" style={{ color: "var(--c-muted)" }}>
          {score.done + 1} / {pack.terms.length}
          {feedback === "ok" ? " · верно" : feedback === "bad" ? " · нет, смотри точку" : ""}
        </div>
      )}

      {finished && (
        <button
          type="button"
          onClick={() => startRound(mode)}
          className="text-[12px] font-bold px-3 py-1.5 rounded-full self-center"
          style={{ background: accent, color: "#fff" }}
        >
          Ещё раз
        </button>
      )}
    </div>
  );
}
