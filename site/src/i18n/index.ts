// Locales, and the two things every page of the site's own needs from them: the copy and the
// path. English is the source text; a later locale is a translation typed against it, so a
// missing string is a build error. Starlight's own chrome reads its own translations.
import { en } from './en.ts';
import { locales, type Locale } from './locales.ts';

export { locales, type Locale };
export const defaultLocale: Locale = 'en';

export type Copy = typeof en;

export const copies: Record<Locale, Copy> = { en };

export const copyFor = (locale: Locale): Copy => copies[locale];

/** The path of a locale-neutral route ('/', '/examples/') in a given locale. */
export function localePath(locale: Locale, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  const p = path.endsWith('/') || /\.[a-z0-9]+$/i.test(path) ? path : `${path}/`;
  return locale === defaultLocale ? p : `/${locale}${p}`;
}
