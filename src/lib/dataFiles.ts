// ТОЛЬКО ДЛЯ СЕРВЕРА: загрузка JSON предметов из src/data.
//
// Раньше было require(`../../data/${fileName}`). Для такого require webpack
// собирает ВСЮ папку src/data (вместе с programs/ — ещё 13 МБ планов кафедр)
// в один серверный чанк на ~24 МБ, и первый запрос контента после деплоя
// синхронно разбирал его целиком — сервер замирал на несколько секунд для
// всех студентов. Динамический import() даёт по чанку на файл: грузится
// только запрошенный предмет, один раз за жизнь процесса.
import { getAllDataFileNames } from '@/lib/subjects';

const cache = new Map<string, Promise<unknown | null>>();

/** JSON из src/data по имени из конфига предметов; null — файла нет или имя не из списка. */
export function loadDataFile(fileName: string): Promise<unknown | null> {
  if (!fileName || !getAllDataFileNames().includes(fileName)) return Promise.resolve(null);
  let pending = cache.get(fileName);
  if (!pending) {
    pending = import(
      /* webpackInclude: /\.json$/ */
      /* webpackExclude: /[\\/](programs|atlas)[\\/]/ */
      `../data/${fileName}`
    )
      .then(mod => (mod as { default?: unknown }).default ?? mod)
      .catch(() => {
        cache.delete(fileName);
        return null;
      });
    cache.set(fileName, pending);
  }
  return pending;
}
