// The locales alone, with nothing imported, for the checks that run outside the build.
export const locales = ['en'] as const;
export type Locale = (typeof locales)[number];
