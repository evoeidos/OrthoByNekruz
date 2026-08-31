'use client';

import { LessonsDesignPreview } from '@/components/LessonsTab';
import { normalizeLesson } from '@/lib/curriculum';
import pedSem1 from '@/data/programs/anat-pediatrics-1-sem1.json';

export default function LessonsPreviewPage() {
  const firstLesson = normalizeLesson(pedSem1[0], 1) ?? undefined;
  return <LessonsDesignPreview firstLesson={firstLesson} />;
}
