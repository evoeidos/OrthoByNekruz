/**
 * Доступ студента к платному контенту предмета: проверки /api/subject-data
 * и вкладки «Занятия» (/api/curriculum).
 */
import { isPreviewModuleTrialExpired } from '@/lib/preview';
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
