/**
 * Доступ студента к платному контенту предмета — общая проверка для
 * /api/subject-data и ответов к тестам в занятиях (/api/curriculum).
 */
import { isPreviewExpired, isPreviewModuleTrialExpired } from '@/lib/preview';
import { userHasModuleDataAccess } from '@/lib/previewModuleStatus';

export type ModuleDataType = 'questions' | 'tests' | 'tasks' | 'glossary';

export function userHasSubject(user: any, subjectId: string): boolean {
  if (!user) return false;
  if (user.subjects && typeof user.subjects === 'object') {
    return user.subjects[subjectId] === true;
  }
  // Legacy
  if (subjectId === 'ortho') return !!user.activatedKey;
  if (subjectId === 'micro') return user.micro === true;
  return false;
}

/** Причина отказа в доступе к разделу или null, если доступ есть. */
export function moduleAccessError(
  user: any,
  subjectId: string,
  dataType: ModuleDataType,
  tgId: string,
): string | null {
  if (!userHasModuleDataAccess(user, subjectId, dataType)) return 'No access to module';
  if (
    user?.previewStatus === 'active'
    && user?.previewChosenSubject === subjectId
    && dataType !== 'glossary'
    && user.previewModuleStatuses?.[dataType] === 'trial'
    && isPreviewModuleTrialExpired(user, dataType, tgId)
  ) {
    return 'Preview module expired';
  }
  return null;
}

/** Всё, что проверяет /api/subject-data перед выдачей раздела, одним вызовом. */
export function canReadSubjectModule(
  user: any,
  subjectId: string,
  dataType: ModuleDataType,
  tgId: string,
): boolean {
  if (!user || user.blocked === true) return false;
  if (user.previewStatus === 'active' && isPreviewExpired(user, Date.now(), tgId)) return false;
  if (!userHasSubject(user, subjectId)) return false;
  return moduleAccessError(user, subjectId, dataType, tgId) === null;
}
