// The sidebar of the examples' pages: every example by category, as three.js lists them.
import { EXAMPLES } from '../../examples/index.ts';
import { localePath } from '../i18n/index.ts';

export function exampleSidebar() {
  const categories = [...new Set(EXAMPLES.map((e) => e.category))];
  return [
    { label: 'All examples', link: localePath('en', '/examples/') },
    ...categories.map((c) => ({
      label: c,
      items: EXAMPLES.filter((e) => e.category === c).map((e) => ({
        label: e.title,
        link: localePath('en', `/examples/${e.id}/`),
      })),
    })),
  ];
}
