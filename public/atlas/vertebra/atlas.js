const TERMS = [
  { id: "facies-intervertebralis", ru: "Межпозвоночная поверхность", la: "Facies intervertebralis" },
  { id: "corpus", ru: "Тело позвонка", la: "Corpus vertebrae" },
  { id: "epiphysis", ru: "Анулярный эпифиз", la: "Epiphysis anularis" },
  { id: "foramen", ru: "Позвоночное отверстие", la: "Foramen vertebrale" },
  { id: "lamina", ru: "Пластинка дуги позвонка", la: "Lamina arcus vertebrae" },
  { id: "pediculus", ru: "Ножка дуги позвонка", la: "Pediculus arcus vertebrae" },
  { id: "art-proc", ru: "Верхний суставной отросток", la: "Processus articularis superior vertebrae" },
  { id: "art-facies", ru: "Верхняя суставная поверхность", la: "Facies articularis superior vertebrae" },
  { id: "transversus", ru: "Поперечный отросток", la: "Processus transversus vertebrae" },
  { id: "spinosus", ru: "Остистый отросток", la: "Processus spinosus vertebrae" },
  { id: "fovea-sup", ru: "Верхняя рёберная ямка", la: "Fovea costalis superior" },
  { id: "fovea-inf", ru: "Нижняя рёберная ямка", la: "Fovea costalis inferior" },
];

const PREFERRED = {
  "facies-intervertebralis": "v04",
  corpus: "v14",
  epiphysis: "v08",
  foramen: "v11",
  lamina: "v02",
  pediculus: "v07",
  "art-proc": "v03",
  "art-facies": "v09",
  transversus: "v12",
  spinosus: "v04",
  "fovea-sup": "v05",
  "fovea-inf": "v10",
};

const PRIMARY = ["v07", "v05", "v04", "v08"];

const DEFAULT_VIEWS = [
  {
    id: "v02",
    title: "Сверху",
    src: "views/02-superior-lamina.jpg",
    markers: [
      { id: "lamina", x: 49.8, y: 64.5 },
      { id: "corpus", x: 51.06, y: 57.34 },
    ],
  },
  {
    id: "v03",
    title: "Сверху · суставной",
    src: "views/03-superior-articular.jpg",
    markers: [
      { id: "art-proc", x: 36.5, y: 48 },
      { id: "corpus", x: 35.67, y: 56.55 },
    ],
  },
  {
    id: "v04",
    title: "Сзади",
    src: "views/04-postero-spinosus.jpg",
    markers: [
      { id: "spinosus", x: 47.6, y: 66.59 },
      { id: "transversus", x: 74.52, y: 59.19 },
      { id: "facies-intervertebralis", x: 45.67, y: 46.68 },
      { id: "corpus", x: 53.17, y: 45.54 },
    ],
  },
  {
    id: "v05",
    title: "Косо",
    src: "views/05-oblique-pediculus.jpg",
    markers: [
      { id: "epiphysis", x: 34.52, y: 51.35 },
      { id: "lamina", x: 65.1, y: 54.17 },
      { id: "art-proc", x: 57.79, y: 49.68 },
      { id: "transversus", x: 77.6, y: 43.07 },
      { id: "spinosus", x: 80.67, y: 64.38 },
      { id: "fovea-sup", x: 41.63, y: 53.29 },
      { id: "fovea-inf", x: 42.98, y: 60.07 },
      { id: "corpus", x: 34.9, y: 56.28 },
      { id: "facies-intervertebralis", x: 42.21, y: 48.71 },
    ],
  },
  {
    id: "v07",
    title: "Сверху · обзор",
    src: "views/07-superior-epiphysis.jpg",
    markers: [
      { id: "fovea-inf", x: 44.13, y: 60.25 },
      { id: "fovea-sup", x: 42.6, y: 53.64 },
      { id: "spinosus", x: 82.98, y: 64.65 },
      { id: "transversus", x: 77.21, y: 42.54 },
      { id: "art-proc", x: 56.63, y: 49.68 },
      { id: "pediculus", x: 52.02, y: 54.52 },
      { id: "lamina", x: 65.67, y: 54.26 },
      { id: "foramen", x: 63.17, y: 49.5 },
      { id: "epiphysis", x: 32.02, y: 51.09 },
      { id: "corpus", x: 34.71, y: 56.19 },
      { id: "facies-intervertebralis", x: 41.83, y: 49.24 },
    ],
  },
  {
    id: "v08",
    title: "Сбоку",
    src: "views/08-lateral-fovea-sup.jpg",
    markers: [
      { id: "facies-intervertebralis", x: 45.67, y: 46.77 },
      { id: "epiphysis", x: 35.67, y: 45.18 },
      { id: "foramen", x: 46.63, y: 54.61 },
      { id: "lamina", x: 51.63, y: 57.6 },
      { id: "pediculus", x: 57.02, y: 53.46 },
      { id: "art-proc", x: 59.13, y: 55.84 },
      { id: "transversus", x: 73.94, y: 59.19 },
      { id: "spinosus", x: 47.4, y: 66.67 },
    ],
  },
  {
    id: "v09",
    title: "Суставная поверхность",
    src: "views/09-superior-facies-art.jpg",
    markers: [{ id: "art-facies", x: 61, y: 46 }],
  },
  {
    id: "v10",
    title: "Нижняя рёберная ямка",
    src: "views/10-lateral-fovea-inf.jpg",
    markers: [{ id: "fovea-inf", x: 44, y: 61 }],
  },
  {
    id: "v11",
    title: "Позвоночное отверстие",
    src: "views/11-superior-foramen.jpg",
    markers: [{ id: "foramen", x: 50, y: 54 }],
  },
  {
    id: "v12",
    title: "Поперечный отросток",
    src: "views/12-superior-transversus.jpg",
    markers: [{ id: "transversus", x: 78, y: 48 }],
  },
  {
    id: "v13",
    title: "Сбоку · тело",
    src: "views/13-lateral-corpus.jpg",
    markers: [{ id: "corpus", x: 39.29, y: 21.96 }],
  },
  {
    id: "v14",
    title: "Спереди · тело",
    src: "views/14-antero-corpus.jpg",
    markers: [{ id: "corpus", x: 50, y: 62 }],
  },
];

const termById = Object.fromEntries(TERMS.map(t => [t.id, t]));
const adminAllowed = new URLSearchParams(location.search).has("admin");
const STORAGE_KEY = "atlas.vertebra.v2";

function loadState() {
  if (!adminAllowed) return structuredClone(DEFAULT_VIEWS);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_VIEWS);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== DEFAULT_VIEWS.length) {
      return structuredClone(DEFAULT_VIEWS);
    }
    return parsed;
  } catch {
    return structuredClone(DEFAULT_VIEWS);
  }
}

let views = loadState();
let viewIndex = Math.max(0, views.findIndex(v => v.id === PRIMARY[0]));
let activeTermId = TERMS[0].id;
let admin = false;
let pendingTermId = TERMS[0].id;

const els = {
  tabs: document.getElementById("tabs"),
  terms: document.getElementById("terms"),
  stage: document.getElementById("stage"),
  photo: document.getElementById("photo"),
  dots: document.getElementById("dots"),
  captionRu: document.getElementById("caption-ru"),
  captionLa: document.getElementById("caption-la"),
  adminBtn: document.getElementById("admin-btn"),
  config: document.getElementById("config"),
  configPre: document.getElementById("config-pre"),
  adminHint: document.getElementById("admin-hint"),
  pending: document.getElementById("pending-term"),
  pendingWrap: document.getElementById("pending-wrap"),
  adminActions: document.getElementById("admin-actions"),
};

if (adminAllowed) els.adminActions.hidden = false;

function save() {
  if (!adminAllowed) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
  renderConfig();
}

function currentView() {
  return views[viewIndex];
}

function viewHas(termId, view = currentView()) {
  return view.markers.some(m => m.id === termId);
}

function jumpToTerm(termId) {
  if (viewHas(termId)) return;
  const preferredId = PREFERRED[termId];
  const preferred = views.findIndex(v => v.id === preferredId && viewHas(termId, v));
  if (preferred >= 0) {
    viewIndex = preferred;
    return;
  }
  const any = views.findIndex(v => viewHas(termId, v));
  if (any >= 0) viewIndex = any;
}

function tabViews() {
  if (admin) return views;
  const currentId = currentView().id;
  const ids = PRIMARY.includes(currentId) ? PRIMARY : [...PRIMARY, currentId];
  return ids.map(id => views.find(v => v.id === id)).filter(Boolean);
}

function renderTabs() {
  const currentId = currentView().id;
  els.tabs.innerHTML = tabViews().map(v => (
    `<button class="tab ${v.id === currentId ? "active" : ""}" data-id="${v.id}">${v.title}</button>`
  )).join("");
}

function renderTerms() {
  els.terms.innerHTML = TERMS.map(t => {
    const here = viewHas(t.id);
    return `<button class="term ${t.id === activeTermId ? "active" : ""}" data-id="${t.id}">
      ${t.la}<small>${t.ru}${here || admin ? "" : " · другая проекция"}</small>
    </button>`;
  }).join("");
}

function renderCaption() {
  const t = termById[activeTermId];
  els.captionRu.textContent = t ? t.ru : "Выбери точку или термин";
  els.captionLa.textContent = t ? t.la : "";
}

function renderDots() {
  const view = currentView();
  els.dots.innerHTML = view.markers.map(m => (
    `<button class="dot ${m.id === activeTermId ? "active" : ""}" data-id="${m.id}" style="left:${m.x}%;top:${m.y}%" title="${termById[m.id]?.la || m.id}"></button>`
  )).join("");
}

function renderConfig() {
  if (!adminAllowed) return;
  const view = currentView();
  const payload = {
    view: view.id,
    title: view.title,
    src: view.src,
    markers: view.markers.map(m => ({
      id: m.id,
      x: Number(m.x.toFixed(2)),
      y: Number(m.y.toFixed(2)),
      ru: termById[m.id]?.ru || "",
      la: termById[m.id]?.la || "",
    })),
  };
  els.configPre.textContent = JSON.stringify(payload, null, 2);
  els.pending.textContent = termById[pendingTermId]?.la || pendingTermId;
}

function showView() {
  const view = currentView();
  els.photo.src = view.src;
  els.stage.classList.toggle("study", !admin);
  els.adminHint.hidden = !admin;
  els.pendingWrap.hidden = !admin;
  if (!view.markers.some(m => m.id === activeTermId) && view.markers[0] && admin) {
    activeTermId = view.markers[0].id;
  }
  renderTabs();
  renderTerms();
  renderDots();
  renderCaption();
  renderConfig();
}

function setActive(id) {
  activeTermId = id;
  pendingTermId = id;
  if (!admin) jumpToTerm(id);
  showView();
}

els.tabs.addEventListener("click", e => {
  const btn = e.target.closest("[data-id]");
  if (!btn) return;
  const next = views.findIndex(v => v.id === btn.dataset.id);
  if (next < 0) return;
  viewIndex = next;
  showView();
});

els.terms.addEventListener("click", e => {
  const btn = e.target.closest("[data-id]");
  if (!btn) return;
  pendingTermId = btn.dataset.id;
  setActive(btn.dataset.id);
});

els.dots.addEventListener("click", e => {
  const btn = e.target.closest("[data-id]");
  if (!btn) return;
  e.stopPropagation();
  if (admin && e.altKey) {
    const view = currentView();
    view.markers = view.markers.filter(m => m.id !== btn.dataset.id);
    save();
    showView();
    return;
  }
  setActive(btn.dataset.id);
});

els.stage.addEventListener("click", e => {
  if (!admin) return;
  if (e.target.closest(".dot")) return;
  const layer = document.getElementById("photo-layer") || els.stage;
  const rect = layer.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  const view = currentView();
  const existing = view.markers.find(m => m.id === pendingTermId);
  if (existing) {
    existing.x = x;
    existing.y = y;
  } else {
    view.markers.push({ id: pendingTermId, x, y });
  }
  activeTermId = pendingTermId;
  save();
  showView();
});

if (adminAllowed) {
  els.adminBtn.addEventListener("click", () => {
    admin = !admin;
    els.adminBtn.classList.toggle("active", admin);
    els.adminBtn.textContent = admin ? "Admin Mode: вкл" : "Admin Mode";
    els.config.classList.toggle("open", admin);
    showView();
  });

  document.getElementById("copy-btn").addEventListener("click", async () => {
    await navigator.clipboard.writeText(els.configPre.textContent);
    document.getElementById("copy-btn").textContent = "Скопировано";
    setTimeout(() => { document.getElementById("copy-btn").textContent = "Копировать конфиг"; }, 1200);
  });

  document.getElementById("reset-btn").addEventListener("click", () => {
    if (!confirm("Сбросить разметку этой вкладки к исходной?")) return;
    views[viewIndex] = structuredClone(DEFAULT_VIEWS[viewIndex]);
    save();
    showView();
  });

  document.getElementById("export-all-btn").addEventListener("click", async () => {
    const all = views.map(view => ({
      view: view.id,
      title: view.title,
      src: view.src,
      markers: view.markers.map(m => ({
        id: m.id,
        x: Number(m.x.toFixed(2)),
        y: Number(m.y.toFixed(2)),
        ru: termById[m.id]?.ru || "",
        la: termById[m.id]?.la || "",
      })),
    }));
    await navigator.clipboard.writeText(JSON.stringify(all, null, 2));
    document.getElementById("export-all-btn").textContent = "Весь атлас скопирован";
    setTimeout(() => { document.getElementById("export-all-btn").textContent = "Копировать все вкладки"; }, 1400);
  });
}

showView();
