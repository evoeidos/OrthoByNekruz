# -*- coding: utf-8 -*-
"""Сборка тестов по гигиене по факультетам: src/data/hyg_tests_<факультет>.json.

Источник: «Гигиена: сборник тестовых заданий с эталонами ответов» (КрасГМУ,
кафедра гигиены, 2022) — отдельное издание для каждой специальности:
31.05.01 Лечебное дело, 31.05.02 Педиатрия, 31.05.03 Стоматология.
10 разделов, ключ («Эталоны ответов») — таблица в конце каждого раздела.

Запуск (нужен PyMuPDF):
    python scripts/build_hyg_tests.py \\
        --therapeutic "Сборник ..._Лечебное дело_2022.pdf" \\
        --pediatrics  "Сбоник ..._Педиатрия_2022.pdf" \\
        --stomatology "Сборник ..._Стоматология_2022.pdf" [--dry-run]

Каждый сборник разбирается отдельно; в конце издания сверяются друг с другом
(текст вопросов, варианты, ключ) и расхождения печатаются.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data"
FACULTIES = ("therapeutic", "pediatrics", "stomatology")

# Названия разделов в оглавлении набраны капсом, у раздела 2 опечатка
# («Гигиена воздуха воздушной среды»).
SECTIONS = {
    1: "Введение в дисциплину «Гигиена»",
    2: "Гигиена воздушной среды",
    3: "Гигиена освещения",
    4: "Гигиена воды и водоснабжения",
    5: "Гигиена почвы и санитарная очистка территорий",
    6: "Гигиена лечебно-профилактических учреждений",
    7: "Гигиена питания",
    8: "Гигиена детей и подростков",
    9: "Гигиена труда",
    10: "Радиационная гигиена",
}

# Опечатки вёрстки (во всех изданиях, кроме отмеченных).
TEXT_FIXES = {
    # Педиатрия: слово разорвано переносом строки без дефиса
    "МИКРОКЛИМАТИЧЕСКИМ И УСЛОВИЯМИ": "МИКРОКЛИМАТИЧЕСКИМИ УСЛОВИЯМИ",
    # Автонумерация Word съела букву: «ОЗЕЛЕНЕНИЕ УЧАСТК1) 60 %»
    "ОЗЕЛЕНЕНИЕ УЧАСТК1) 60 %": "ОЗЕЛЕНЕНИЕ УЧАСТКА 60 %",
    # Градус набран после буквы: «(СО)» с надстрочной «О»
    "(С°)": "(°С)",
    "БОЕ/³": "БОЕ/м³",
}

SUP = str.maketrans("0123456789-+", "⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺")
SUB = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")
MAIN_SIZE = 13.0  # основной текст — 14 pt; меньше — индексы и номера страниц


def small_text(text: str, sup: bool) -> str:
    """Верхний/нижний индекс: м³, 10⁻⁴, °С, В₁₂, ПДКм.р."""
    t = text.strip()
    if sup:
        if t in ("О", "o", "0", "о"):
            return "°"  # градус набран надстрочной «О»/нулём
        return t.translate(SUP)
    if t.isdigit():
        return t.translate(SUB)
    if len(t) == 2 and t.isalpha():
        return ".".join(t.lower()) + "."  # ПДК с индексом МР/СС → ПДКм.р.
    return t


def page_lines(page: fitz.Page) -> list[list[dict]]:
    """Строки страницы: спаны с одной базовой линией, слева направо.

    Выровненный по ширине текст PyMuPDF режет на отдельные строки по словам,
    поэтому строки собираются заново по координатам.
    """
    spans = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for s in line["spans"]:
                if not s["text"].strip():
                    continue
                spans.append({
                    "text": s["text"],
                    "x0": s["bbox"][0],
                    "x1": s["bbox"][2],
                    "y": s["origin"][1],
                    "small": s["size"] < MAIN_SIZE,
                    "sup": bool(s["flags"] & 1),
                    "bold": "Bold" in s["font"],
                })
    lines: list[list[dict]] = []
    for s in sorted((s for s in spans if not s["small"]), key=lambda s: (s["y"], s["x0"])):
        if lines and abs(lines[-1][0]["y"] - s["y"]) < 2:
            lines[-1].append(s)
        else:
            lines.append([s])
    alone: list[list[dict]] = []
    for s in (s for s in spans if s["small"]):
        near = [ln for ln in lines if abs(ln[0]["y"] - s["y"]) < 7]
        if near:
            min(near, key=lambda ln: abs(ln[0]["y"] - s["y"])).append(s)
        elif s["text"].strip() != str(page.number + 1):  # номер страницы — пропускаем
            s["small"] = False  # мелкий шрифт на титуле и в выходных данных
            alone.append([s])
    lines = sorted(lines + alone, key=lambda ln: ln[0]["y"])
    for ln in lines:
        ln.sort(key=lambda s: s["x0"])
    return lines


def line_text(spans: list[dict]) -> str:
    out = ""
    prev = None
    for s in spans:
        t = small_text(s["text"], s["sup"]) if s["small"] else s["text"]
        if prev is not None and not s["small"] and s["x0"] - prev["x1"] > 1 and not out.endswith(" "):
            out += " "
        out += t
        prev = s
    return re.sub(r"\s+", " ", out).strip()


def read_lines(pdf: Path) -> list[tuple[str, bool]]:
    """(текст строки, вся строка жирная) по всему сборнику."""
    doc = fitz.open(pdf)
    result = []
    for page in doc:
        for ln in page_lines(page):
            result.append((line_text(ln), all(s["bold"] for s in ln if not s["small"])))
    return result


SECTION_RE = re.compile(r"^РАЗДЕЛ (\d+)\.")
QUESTION_RE = re.compile(r"^(\d+)(\.?)\s*(.*)$")
OPTION_RE = re.compile(r"^(\d{1,2})\)\s*(.*)$")


def is_caps(text: str) -> bool:
    """Вопросы набраны капсом — так их не спутать с переносом варианта."""
    letters = [c for c in text if c.isalpha()]
    return len(letters) >= 2 and sum(c.isupper() for c in letters) / len(letters) > 0.8


def parse_key(lines: list[tuple[str, bool]], where: str) -> dict[int, int]:
    """Таблица «Эталоны ответов»: жирная строка номеров, под ней строка ответов."""
    key: dict[int, int] = {}
    header: list[int] | None = None
    for text, bold in lines:
        nums = text.split()
        if not all(n.isdigit() for n in nums):
            raise SystemExit(f"{where}: в ключе не число: {text!r}")
        if bold:
            if header is not None:
                raise SystemExit(f"{where}: две строки номеров подряд: {text!r}")
            header = [int(n) for n in nums]
        else:
            if header is None or len(header) != len(nums):
                raise SystemExit(f"{where}: строка ответов не под строкой номеров: {text!r}")
            for q, a in zip(header, nums):
                if q in key:
                    raise SystemExit(f"{where}: вопрос {q} в ключе дважды")
                key[q] = int(a)
            header = None
    if header is not None:
        raise SystemExit(f"{where}: строка номеров без ответов")
    return key


def parse(pdf: Path, warn) -> list[dict]:
    lines = read_lines(pdf)
    # Строки «РАЗДЕЛ N.» есть и в оглавлении — задания идут после «ТЕСТОВЫЕ ЗАДАНИЯ»
    body_at = next(i for i, (t, _b) in enumerate(lines) if t == "ТЕСТОВЫЕ ЗАДАНИЯ")
    starts = [i for i, (t, _b) in enumerate(lines) if i > body_at and SECTION_RE.match(t)]
    nums = [int(SECTION_RE.match(lines[i][0]).group(1)) for i in starts]
    if nums != list(SECTIONS):
        raise SystemExit(f"{pdf.name}: разделы {nums}, ожидались {list(SECTIONS)}")

    tests: list[dict] = []
    for n, (start, end) in enumerate(zip(starts, starts[1:] + [len(lines)]), 1):
        body = [t for t, _b in lines[start + 1:end]]
        key_at = next((i for i, t in enumerate(body) if t == "ЭТАЛОНЫ ОТВЕТОВ"), None)
        if key_at is None:
            raise SystemExit(f"{pdf.name}: раздел {n} без эталонов ответов")
        key_lines = lines[start + 1 + key_at + 1:end]
        # Выходные данные типографии в конце книги — не ключ
        key_lines = [(t, b) for t, b in key_lines if not re.match(r"^(Типография|Подписано|\d{6},)", t)]
        key = parse_key(key_lines, f"{pdf.name} раздел {n}")

        questions: list[dict] = []
        cur = None
        for text in body[:key_at]:
            m = QUESTION_RE.match(text)
            expected = len(questions) + 1
            new_question = m and (cur is None or len(cur["options"]) >= 2) and (
                # «20 ИСТОЧНИКОМ…» — номер без точки
                int(m.group(1)) == expected and (m.group(2) or is_caps(m.group(3)))
                # «251. К МИКОТОКСИКОЗАМ…» вместо 151 — опечатка в номере
                or cur is not None and len(cur["options"]) >= 4 and m.group(2) and is_caps(m.group(3))
            )
            if new_question:
                if int(m.group(1)) != expected or not m.group(2):
                    warn(f"{pdf.name} раздел {n}: вопрос {expected} напечатан как {text[:40]!r}")
                cur = {"num": expected, "stem": [m.group(3)], "options": []}
                questions.append(cur)
                continue
            if cur is None:
                continue  # заголовок раздела
            m = OPTION_RE.match(text)
            if m:
                k = int(m.group(1))
                if k != len(cur["options"]) + 1:
                    warn(f"{pdf.name} раздел {n} №{cur['num']}: вариант {len(cur['options']) + 1} "
                         f"напечатан как {text[:40]!r}")
                cur["options"].append([m.group(2)])
                continue
            if cur["options"]:
                cur["options"][-1].append(text)
            else:
                cur["stem"].append(text)

        for q in questions:
            where = f"{pdf.name} раздел {n} №{q['num']}"
            stem = clean(" ".join(q["stem"]))
            options = [f"{i}) {clean(' '.join(o))}" for i, o in enumerate(q["options"], 1)]
            if not stem:
                warn(f"{where}: пустой вопрос")
            if len(options) != 5:
                warn(f"{where}: вариантов {len(options)}")
            ans = key.get(q["num"])
            correct = options[ans - 1] if ans and 1 <= ans <= len(options) else ""
            if ans is None:
                warn(f"{where}: нет в ключе")
            elif not correct:
                warn(f"{where}: ответ {ans} вне вариантов 1..{len(options)}")
            tests.append({
                "id": f"{len(tests) + 1:03d}",
                "original_number": str(q["num"]),
                "theme": f"{n}. {SECTIONS[n]}",
                "question": stem,
                "options": options,
                "correct": correct,
            })
        extra = sorted(set(key) - {q["num"] for q in questions})
        if extra:
            warn(f"{pdf.name} раздел {n}: в ключе лишние номера {extra}")
    return tests


def clean(s: str) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    for wrong, right in TEXT_FIXES.items():
        s = s.replace(wrong, right)
    # Перенос составного слова по дефису: «ХОЗЯЙСТВЕННО-» + «ПИТЬЕВОГО».
    # Цифры не трогаем: «1- ТЕРАПЕВТИЧЕСКОЕ» так и набрано.
    s = re.sub(r"([^\W\d])- ([^\W\d])", r"\1-\2", s)
    return s


def compare(a_name: str, a: list[dict], b_name: str, b: list[dict]) -> int:
    """Сверка двух изданий: тот же порядок, текст, варианты и ключ."""
    diffs = 0
    if len(a) != len(b):
        print(f"РАСХОЖДЕНИЕ {a_name}/{b_name}: тестов {len(a)} и {len(b)}")
        return 1
    for x, y in zip(a, b):
        for field in ("theme", "original_number", "question", "options", "correct"):
            if x[field] != y[field]:
                diffs += 1
                print(f"РАСХОЖДЕНИЕ {a_name}/{b_name} id={x['id']} {field}:\n"
                      f"    {a_name}: {x[field]!r}\n    {b_name}: {y[field]!r}")
    return diffs


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    for f in FACULTIES:
        ap.add_argument(f"--{f}", type=Path, required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    built: dict[str, list[dict]] = {}
    for f in FACULTIES:
        warnings: list[str] = []
        built[f] = parse(getattr(args, f), warnings.append)
        for w in warnings:
            print("WARN:", w)
        by_theme: dict[str, int] = {}
        for t in built[f]:
            by_theme[t["theme"]] = by_theme.get(t["theme"], 0) + 1
        print(f"── {f}: {len(built[f])} тестов, без ответа {sum(1 for t in built[f] if not t['correct'])}")
        for theme, n in by_theme.items():
            print(f"{n:4d}  {theme}")

    base = FACULTIES[0]
    diffs = sum(compare(base, built[base], f, built[f]) for f in FACULTIES[1:])
    print(f"расхождений между изданиями: {diffs}")

    if not args.dry_run:
        for f in FACULTIES:
            dest = DATA / f"hyg_tests_{f}.json"
            dest.write_text(json.dumps(built[f], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"записано: {dest.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
