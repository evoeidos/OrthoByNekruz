# -*- coding: utf-8 -*-
"""Сборка src/data/bioxim_tests.json из сборника тестов по биохимии КрасГМУ.

Источник: «Биологическая химия: сборник тестовых заданий с эталонами ответов»
(КрасГМУ, 2010, издание для лечебного дела) — темы по разделам, ключи ответов
в конце документа. Банк общий для всех факультетов.

Номера вопросов и вариантов в .doc — автонумерация Word, в XML их нет.
Перед запуском открой .doc в Word и преврати нумерацию в текст, затем сохрани
как .docx (PowerShell):

    $w = New-Object -ComObject Word.Application
    $d = $w.Documents.Open("...\\Сборник тестовых заданий с эталонами ответов.doc")
    $d.ConvertNumbersToText(); $d.SaveAs2("...\\bioxim_num.docx", 16); $w.Quit()

Запуск:
    python scripts/build_bioxim_tests.py path/to/bioxim_num.docx [--key-check other_num.docx]

--key-check — второй сборник (например, для педиатров): ключи одинаковых
вопросов сверяются, расхождения печатаются.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "src" / "data" / "bioxim_tests.json"

SECTIONS = [
    "Ферменты",
    "Биологическое окисление",
    "Углеводный обмен",
    "Липидный обмен",
    "Белковый обмен",
    "Азотистый обмен",
    "Витамины",
    "Биохимия регуляций",
    "Водно-минеральный обмен",
    "Биохимия органов и тканей",
]

# Опечатки в ключе: (раздел, номер вопроса) → ответ. Ответ взят из того же
# вопроса в сборнике для педиатров (--key-check).
# Обратные расхождения (Белковый обмен 110, 113) — ошибка педиатрического
# ключа, здесь ключ верный: остаток гликогенных аминокислот идёт в а, в, г;
# тромбин действует на фибриноген.
KEY_FIXES: dict[tuple[str, int], int] = {
    ("Биологическое окисление", 19): 4,  # в ключе «42»; изоцитратдегидрогеназа
    ("Витамины", 37): 4,                 # в ключе «1) Д»; антигеморрагический — К
}

# Символы шрифта Symbol → Unicode
SYMBOL = {
    "a": "α", "b": "β", "g": "γ", "d": "δ", "e": "ε", "k": "κ", "l": "λ", "m": "μ",
    "p": "π", "s": "σ", "w": "ω", "D": "Δ", "W": "Ω", "S": "Σ", "c": "χ", "y": "ψ",
    "f": "φ", "q": "θ", "n": "ν", "r": "ρ", "t": "τ", "h": "η", "z": "ζ", "x": "ξ",
    "®": "→", "¬": "←", "«": "↔", "­": "↑", "¯": "↓",
    "³": "≥", "£": "≤", "±": "±", "´": "×", "°": "°",
    "»": "≈", "¹": "≠", "·": "·",
}

RUN_TOKEN = re.compile(
    r'<w:t(?: [^>]*)?>([^<]*)</w:t>'
    r'|<w:sym [^>]*w:char="([0-9A-Fa-f]+)"[^>]*/>'
    r'|<w:(tab|br|noBreakHyphen)/>'
)


def sym_char(code: str) -> str:
    c = int(code, 16)
    if c >= 0xF000:
        c -= 0xF000
    ch = chr(c)
    if ch not in SYMBOL:
        raise SystemExit(f"нет замены для символа Symbol {code}")
    return SYMBOL[ch]


def run_text(run: str) -> str:
    font = re.search(r'<w:rFonts [^>]*w:ascii="([^"]+)"', run)
    symbol_font = bool(font and font.group(1) == "Symbol")
    out = []
    for m in RUN_TOKEN.finditer(run):
        if m.group(1) is not None:
            t = html.unescape(m.group(1))
            if symbol_font:
                t = "".join(SYMBOL.get(ch, ch) for ch in t)
            # Символ Symbol, записанный кодом U+F0xx прямо в текст
            t = re.sub(r"[-]", lambda c: sym_char(f"{ord(c.group()):X}"), t)
            out.append(t)
        elif m.group(2):
            out.append(sym_char(m.group(2)))
        else:
            out.append({"tab": "\t", "br": " ", "noBreakHyphen": "-"}[m.group(3)])
    return "".join(out)


def read_paragraphs(docx: Path) -> list[str]:
    xml = zipfile.ZipFile(docx).read("word/document.xml").decode("utf-8")
    body = xml[xml.index("<w:body>"):]
    paras = []
    for p in re.findall(r"<w:p[ >].*?</w:p>|<w:p/>", body, flags=re.S):
        paras.append("".join(run_text(r) for r in re.findall(r"<w:r[ >].*?</w:r>", p, flags=re.S)))
    return paras


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def clean_item(s: str) -> str:
    """Вариант или пункт а)…: без «;»/«,» в конце, как в перечислении."""
    return clean(s).rstrip(";,").rstrip()


Q_RE = re.compile(r"^\s*(\d{2,3})\.\s*(.*)$")
OPT_RE = re.compile(r"^\s*(\d)\s*\)\s*(.*)$")
# «3соматотропин» — скобку потеряли в исходнике
OPT_NO_PAREN_RE = re.compile(r"^\s*(\d)([А-Яа-яЁё].*)$")
SUB_RE = re.compile(r"^\s*([а-еa])\s*\)\s*(.*)$")  # «a)» латиницей тоже встречается
COMBO_RE = re.compile(r"^\s*Выберите (одну )?правильную комбинацию", re.I)
INSTRUCTION_RE = re.compile(r"^\s*Выберите из предложенных", re.I)


def split_inline_options(num: int, text: str) -> list[tuple[int, str]]:
    """«1) a  2) b 3) c» в одной строке → отдельные варианты (по порядку номеров)."""
    out = []
    while True:
        m = re.search(rf"\s{num + 1}\)\s*", text)
        if not m:
            out.append((num, text))
            return out
        out.append((num, text[:m.start()]))
        num, text = num + 1, text[m.end():]


def split_sections(paras: list[str]) -> tuple[dict[str, list[str]], list[str]]:
    """Тело документа по разделам и строки раздела «Ответы»."""
    # Оглавление: «Ферменты\t4» — с номером страницы; заголовки в теле — без.
    starts = []
    for name in SECTIONS + ["Ответы"]:
        idx = [i for i, p in enumerate(paras) if clean(p) == name]
        if not idx:
            raise SystemExit(f"не найден заголовок раздела «{name}»")
        starts.append((idx[0], name))
    if [n for _, n in sorted(starts)] != SECTIONS + ["Ответы"]:
        raise SystemExit("разделы идут не в том порядке")
    bodies = {}
    for (i, name), (j, _) in zip(starts, starts[1:]):
        bodies[name] = paras[i + 1:j]
    return bodies, paras[starts[-1][0] + 1:]


def parse_questions(section: str, lines: list[str], warn) -> list[dict]:
    out: list[dict] = []
    cur: dict | None = None
    for raw in lines:
        line = raw.replace(" ", " ")
        # пустые строки и случайные значки вроде одиночного «±»
        if not re.search(r"\w", line) or INSTRUCTION_RE.match(line):
            continue
        if m := Q_RE.match(line):
            cur = {"num": int(m.group(1)), "stem": [clean(m.group(2))], "subs": [], "combo": None, "options": []}
            out.append(cur)
            continue
        if cur is None:
            warn(f"{section}: строка до первого вопроса: {line!r}")
            continue
        opts = cur["options"]
        m = OPT_RE.match(line)
        if not m and (m2 := OPT_NO_PAREN_RE.match(line)) and int(m2.group(1)) == len(opts) + 1:
            warn(f"{section} {cur['num']:03d}: вариант без скобки {line.strip()!r}")
            m = m2
        if m:
            opts.extend(list(o) for o in split_inline_options(int(m.group(1)), m.group(2)))
        elif not opts and (m := SUB_RE.match(line)):
            cur["subs"].append(f"{m.group(1).replace('a', 'а')}) {clean_item(m.group(2))}")
        elif not opts and COMBO_RE.match(line):
            cur["combo"] = clean(line).rstrip(":") + ":"
        elif opts:
            # Варианты в сборнике не переносятся на новый абзац: абзац без
            # номера после вариантов — следующий вариант, номер потерян.
            warn(f"{section} {cur['num']:03d}: вариант без номера {line.strip()!r} → {len(opts) + 1})")
            opts.append([len(opts) + 1, line])
        elif cur["subs"]:
            cur["subs"][-1] = clean_item(cur["subs"][-1] + " " + line)
        else:
            cur["stem"].append(clean(line))
    for i, q in enumerate(out, 1):
        if q["num"] != i:
            warn(f"{section}: вопрос №{q['num']} на позиции {i}")
        nums = [n for n, _ in q["options"]]
        if nums != list(range(1, len(nums) + 1)):
            # «1) 2) 3) 5)» — опечатка в нумерации; ключ указывает позицию
            warn(f"{section} {q['num']:03d}: номера вариантов {nums} → по порядку")
        q["options"] = [clean_item(t) for _, t in q["options"]]
        if len(q["options"]) < 2:
            warn(f"{section} {q['num']:03d}: меньше двух вариантов")
        if q["subs"] and not q["combo"]:
            warn(f"{section} {q['num']:03d}: пункты а), б)… без «выберите комбинацию»")
    return out


def parse_key(lines: list[str], warn) -> dict[str, list[int]]:
    """Ключ по разделам: ответы по порядку вопросов."""
    key: dict[str, list[int]] = {}
    section = None
    for raw in lines:
        line = clean(raw)
        if not line:
            continue
        if line in SECTIONS:
            section = line
            key[section] = []
            continue
        if section is None:
            continue
        pairs = re.findall(r"(\d{1,3})\s*[-–]\s*(\d+)", line)
        for num, ans in pairs:
            expected = len(key[section]) + 1
            if int(num) != expected:
                warn(f"ключ «{section}»: «{num} - {ans}» на месте №{expected:03d}")
            key[section].append(int(ans))
    return key


def build(docx: Path, warn, fixes: dict[tuple[str, int], int]) -> list[dict]:
    bodies, key_lines = split_sections(read_paragraphs(docx))
    key = parse_key(key_lines, warn)
    result = []
    for section in SECTIONS:
        questions = parse_questions(section, bodies[section], warn)
        answers = key.get(section, [])
        if len(answers) != len(questions):
            warn(f"«{section}»: вопросов {len(questions)}, ответов в ключе {len(answers)}")
        for i, q in enumerate(questions):
            ans = fixes.get((section, q["num"]), answers[i] if i < len(answers) else None)
            options = [f"{n}) {t}" for n, t in enumerate(q["options"], 1)]
            text = clean(" ".join(q["stem"]))
            if q["subs"]:
                text = "\n".join([text, *q["subs"], q["combo"] or "Выберите правильную комбинацию ответов:"])
            correct = options[ans - 1] if ans and 1 <= ans <= len(options) else ""
            if not correct:
                warn(f"{section} {q['num']:03d}: ответ {ans} вне вариантов 1..{len(options)}")
            result.append({
                "id": f"{len(result) + 1:03d}",
                "original_number": str(q["num"]),
                "theme": section,
                "question": text,
                "options": options,
                "correct": correct,
            })
    return result


def norm(s: str) -> str:
    """Для сверки двух сборников: без нумерации, регистра, пробелов и знаков."""
    s = re.sub(r"^\s*(?:\d\)|[а-е]\))\s*", "", s.lower().replace("ё", "е"))
    return re.sub(r"[^a-zа-я0-9α-ω]+", "", s)


def check_key(tests: list[dict], other: list[dict]) -> None:
    """Сверка ключей с другим сборником по тексту вопроса и верного варианта."""
    index: dict[str, list[dict]] = {}
    for t in other:
        index.setdefault(norm(t["question"]), []).append(t)
    same = diff = missing = 0
    for t in tests:
        twins = index.get(norm(t["question"]))
        if not twins:
            missing += 1
            continue
        mine = norm(t["correct"])
        theirs = {norm(o["correct"]) for o in twins}
        if mine in theirs:
            same += 1
            continue
        # Тот же вопрос с другими вариантами (переставлены/изменены) — не сравнить
        if not any(mine in {norm(x) for x in o["options"]} for o in twins):
            missing += 1
            continue
        diff += 1
        print(f"РАСХОЖДЕНИЕ {t['theme']} {int(t['original_number']):03d}: {t['question'][:70]!r}\n"
              f"    здесь: {t['correct']!r}; там: {[o['correct'] for o in twins]!r}")
    print(f"сверка ключей: совпало {same}, расходится {diff}, не с чем сравнить {missing}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("docx", type=Path)
    ap.add_argument("--key-check", type=Path)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    warnings: list[str] = []
    tests = build(args.docx, warnings.append, KEY_FIXES)

    if args.key_check:
        # Второй сборник — без правок ключа: сверяем исходные ключи
        check_key(tests, build(args.key_check, lambda _w: None, {}))

    for w in warnings:
        print("WARN:", w)
    by_theme: dict[str, int] = {}
    for t in tests:
        by_theme[t["theme"]] = by_theme.get(t["theme"], 0) + 1
    for theme, n in by_theme.items():
        print(f"{n:4d}  {theme}")
    print(f"всего: {len(tests)}")
    if not args.dry_run:
        DEST.write_text(json.dumps(tests, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"записано: {DEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
