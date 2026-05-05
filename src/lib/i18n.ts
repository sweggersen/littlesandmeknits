export const languages = {
  nb: 'Norsk',
  en: 'English',
} as const;

export type Lang = keyof typeof languages;

export const defaultLang: Lang = 'nb';

export const ui = {
  nb: {
    'nav.shop': 'Oppskrifter',
    'nav.projects': 'Prosjekter',
    'nav.about': 'Om oss',
    'nav.studio': 'Studio',
    'nav.login': 'Logg inn',
    'nav.cart': 'Handlekurv',
    'nav.search': 'Søk i oppskrifter…',

    'home.hero.title': 'Strikk noe de vil arve.',
    'home.hero.subtitle': 'Moderne oppskrifter for små.',
    'home.hero.cta': 'Se oppskriftene',

    'home.featured.title': 'Utvalgte oppskrifter',
    'home.featured.subtitle': 'Plagg jeg har skrevet, til de små du er glad i.',

    'home.story.title': 'Hei, jeg er Littles and Me',
    'home.story.body': 'Jeg designer strikkeoppskrifter til mine egne små — og deler dem med deg. Hver oppskrift er testet av meg, på mine barn, før den når deg.',
    'home.story.cta': 'Les mer',

    'home.tools.title': 'Strikk smartere',
    'home.tools.subtitle': 'Verktøy som hjelper deg fra plan til ferdig plagg.',
    'home.tools.counter': 'Maskeradeteller',
    'home.tools.gauge': 'Strikkfasthet',
    'home.tools.stash': 'Garnlager',
    'home.tools.cta': 'Åpne studio',

    'home.projects.title': 'Siste prosjekter',
    'home.projects.cta': 'Se alle prosjekter',

    'home.instagram.title': 'Følg med på Instagram',
    'home.instagram.cta': '@littlesandmeknits',

    'home.newsletter.title': 'Nyhetsbrev',
    'home.newsletter.body': 'Få beskjed når nye oppskrifter slippes. Ingen spam.',
    'home.newsletter.placeholder': 'din@epost.no',
    'home.newsletter.cta': 'Meld meg på',

    'shop.title': 'Oppskrifter',
    'shop.subtitle': 'Alle oppskriftene mine, samlet på ett sted.',
    'shop.filter.all': 'Alle',
    'shop.filter.sweaters': 'Gensere',
    'shop.filter.accessories': 'Tilbehør',
    'shop.filter.blankets': 'Tepper',
    'shop.filter.sets': 'Sett',
    'shop.filter.age': 'Alder',
    'shop.filter.difficulty': 'Vanskelighetsgrad',
    'shop.filter.weight': 'Garnvekt',
    'shop.empty': 'Ingen oppskrifter ennå.',

    'pattern.buy': 'Kjøp oppskrift',
    'pattern.materials': 'Materialer',
    'pattern.description': 'Beskrivelse',
    'pattern.sizes': 'Størrelser',
    'pattern.reviews': 'Anmeldelser',
    'pattern.difficulty': 'Vanskelighetsgrad',
    'pattern.yarnWeight': 'Garnvekt',
    'pattern.gauge': 'Strikkfasthet',
    'pattern.needles': 'Pinner',
    'pattern.related': 'Du vil kanskje også like',

    'projects.title': 'Prosjekter',
    'projects.subtitle': 'Plagg jeg har strikket selv.',

    'about.title': 'Om Littles and Me',

    'footer.studio': 'Studio',
    'footer.studio.projects': 'Mine prosjekter',
    'footer.studio.stash': 'Garnlager',
    'footer.connect': 'Følg oss',
    'footer.instagram': 'Instagram',
    'footer.newsletter': 'Nyhetsbrev',
    'footer.support': 'Kontakt',
    'footer.legal.privacy': 'Personvern',
    'footer.legal.terms': 'Vilkår',
    'footer.tagline': 'Strikket med kjærlighet · Laget i Norge',

    'difficulty.beginner': 'Nybegynner',
    'difficulty.intermediate': 'Mellom',
    'difficulty.advanced': 'Avansert',

    'weight.lace': 'Lace',
    'weight.fingering': 'Tynt (Fingering)',
    'weight.sport': 'Mellomtynt (Sport)',
    'weight.dk': 'Mellomtykt (DK)',
    'weight.worsted': 'Tykt (Worsted)',
    'weight.aran': 'Aran',
    'weight.bulky': 'Veldig tykt (Bulky)',
  },
  en: {
    'nav.shop': 'Patterns',
    'nav.projects': 'Projects',
    'nav.about': 'About',
    'nav.studio': 'Studio',
    'nav.login': 'Log in',
    'nav.cart': 'Cart',
    'nav.search': 'Search patterns…',

    'home.hero.title': 'Knits your littles will treasure.',
    'home.hero.subtitle': 'Modern patterns for the smallest among us.',
    'home.hero.cta': 'Browse patterns',

    'home.featured.title': 'Featured patterns',
    'home.featured.subtitle': "Patterns I've written, for the little ones you love.",

    'home.story.title': "Hi, I'm Littles and Me",
    'home.story.body': "I design knitting patterns for my own little ones — and share them with you. Every pattern is tested by me, on my own children, before it reaches you.",
    'home.story.cta': 'Read more',

    'home.tools.title': 'Knit smarter',
    'home.tools.subtitle': 'Tools that take you from plan to finished garment.',
    'home.tools.counter': 'Row counter',
    'home.tools.gauge': 'Gauge calculator',
    'home.tools.stash': 'Yarn stash',
    'home.tools.cta': 'Open studio',

    'home.projects.title': 'Latest projects',
    'home.projects.cta': 'See all projects',

    'home.instagram.title': 'Follow on Instagram',
    'home.instagram.cta': '@littlesandmeknits',

    'home.newsletter.title': 'Newsletter',
    'home.newsletter.body': "Get notified when new patterns drop. No spam.",
    'home.newsletter.placeholder': 'your@email.com',
    'home.newsletter.cta': 'Sign me up',

    'shop.title': 'Patterns',
    'shop.subtitle': 'All my patterns, in one place.',
    'shop.filter.all': 'All',
    'shop.filter.sweaters': 'Sweaters',
    'shop.filter.accessories': 'Accessories',
    'shop.filter.blankets': 'Blankets',
    'shop.filter.sets': 'Sets',
    'shop.filter.age': 'Age',
    'shop.filter.difficulty': 'Difficulty',
    'shop.filter.weight': 'Yarn weight',
    'shop.empty': 'No patterns yet.',

    'pattern.buy': 'Buy pattern',
    'pattern.materials': 'Materials',
    'pattern.description': 'Description',
    'pattern.sizes': 'Sizes',
    'pattern.reviews': 'Reviews',
    'pattern.difficulty': 'Difficulty',
    'pattern.yarnWeight': 'Yarn weight',
    'pattern.gauge': 'Gauge',
    'pattern.needles': 'Needles',
    'pattern.related': 'You might also like',

    'projects.title': 'Projects',
    'projects.subtitle': 'Pieces I have knitted myself.',

    'about.title': 'About Littles and Me',

    'footer.studio': 'Studio',
    'footer.studio.projects': 'My projects',
    'footer.studio.stash': 'Yarn stash',
    'footer.connect': 'Connect',
    'footer.instagram': 'Instagram',
    'footer.newsletter': 'Newsletter',
    'footer.support': 'Contact',
    'footer.legal.privacy': 'Privacy',
    'footer.legal.terms': 'Terms',
    'footer.tagline': 'Knitted with love · Made in Norway',

    'difficulty.beginner': 'Beginner',
    'difficulty.intermediate': 'Intermediate',
    'difficulty.advanced': 'Advanced',

    'weight.lace': 'Lace',
    'weight.fingering': 'Fingering',
    'weight.sport': 'Sport',
    'weight.dk': 'DK',
    'weight.worsted': 'Worsted',
    'weight.aran': 'Aran',
    'weight.bulky': 'Bulky',
  },
} satisfies Record<Lang, Record<string, string>>;

export type UIKey = keyof typeof ui.nb;

export function getLangFromUrl(url: URL): Lang {
  const segments = url.pathname.split('/').filter(Boolean);
  const first = segments[0];
  if (first && first in languages) return first as Lang;
  return defaultLang;
}

export function useTranslations(lang: Lang) {
  return function t(key: UIKey): string {
    return ui[lang][key] ?? ui[defaultLang][key];
  };
}

export function localizedPath(lang: Lang, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (lang === defaultLang) return clean;
  return `/${lang}${clean === '/' ? '' : clean}`;
}
