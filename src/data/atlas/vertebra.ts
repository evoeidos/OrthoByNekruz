export interface AtlasTerm {
  id: string;
  ru: string;
  la: string;
}

export interface AtlasMarker {
  id: string;
  x: number;
  y: number;
}

export interface AtlasView {
  id: string;
  title: string;
  src: string;
  markers: AtlasMarker[];
}

export interface AtlasPack {
  id: string;
  title: string;
  imageBase: string;
  terms: AtlasTerm[];
  views: AtlasView[];
  /** Лучший ракурс для термина — на него прыгаем по клику в списке */
  preferredView: Record<string, string>;
  primaryViews: string[];
}

export const VERTEBRA_ATLAS: AtlasPack = {
  id: "vertebra",
  title: "Типичный позвонок",
  imageBase: "/atlas/vertebra",
  terms: [
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
  ],
  preferredView: {
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
  },
  primaryViews: ["v07", "v05", "v04", "v08"],
  views: [
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
  ],
};

const PACKS: Record<string, AtlasPack> = {
  vertebra: VERTEBRA_ATLAS,
};

export function getAtlasPack(id: string | undefined): AtlasPack | null {
  if (!id) return null;
  return PACKS[id] ?? null;
}
