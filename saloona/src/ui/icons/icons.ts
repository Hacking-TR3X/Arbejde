/**
 * Saloona's own icon set.
 *
 * Every icon is drawn on a 24 x 24 grid with about 2 px padding and is rendered by
 * Icon.svelte with a 2 px stroke, round caps and round joins, `currentColor` and no fill.
 * Each entry is one or more SVG path `d` strings. Circles and dots are written as arcs,
 * so the component only ever renders `<path>`.
 *
 * Keylines: circle r = 9 (3..21), square 16 x 16 (4..20), portrait 14 x 18 (5..19 x 3..21).
 * Add new icons here, never inline SVG in a screen.
 */
export const ICONS = {
  /** Snart tid (tab) */
  clock: ['M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0', 'M12 7v5l3 2'],

  /** Kunder (tab) */
  people: [
    'M12.5 8a3.5 3.5 0 1 1-7 0a3.5 3.5 0 1 1 7 0',
    'M3 20a6 6 0 0 1 12 0',
    'M15.5 4.5a3.5 3.5 0 0 1 0 7',
    'M17.5 14.4a6 6 0 0 1 3.5 5.6'
  ],

  plus: ['M12 5v14', 'M5 12h14'],

  /** Indtjening (tab) */
  chart: ['M3.5 20h17', 'M7 16.5v-5', 'M12 16.5V4.5', 'M17 16.5v-8'],

  /** Mere (tab) */
  more: [
    'M4 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
    'M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
    'M18 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0'
  ],

  /** Ring */
  phone: [
    'M8.6 4H6a2 2 0 0 0-2 2c.5 7.7 6.3 13.5 14 14a2 2 0 0 0 2-2v-2.6a1 1 0 0 0-.7-.95l-3.3-1.1a1 1 0 0 0-1.05.25l-1.45 1.45a12 12 0 0 1-5.5-5.5l1.45-1.45a1 1 0 0 0 .25-1.05L9.55 4.7A1 1 0 0 0 8.6 4z'
  ],

  /** SMS */
  message: [
    'M7 17v3.5l4.5-3.5H18a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3z'
  ],

  search: ['M17 10.5a6.5 6.5 0 1 1-13 0a6.5 6.5 0 1 1 13 0', 'M15.5 15.5L20 20'],

  back: ['M15 6l-6 6 6 6'],
  forward: ['M9 6l6 6-6 6'],
  down: ['M6 9l6 6 6-6'],

  close: ['M6 6l12 12', 'M18 6L6 18'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],

  trash: [
    'M4 7h16',
    'M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2',
    'M6 7l.9 12.1a2 2 0 0 0 2 1.9h6.2a2 2 0 0 0 2-1.9L18 7',
    'M10 11v6',
    'M14 11v6'
  ],

  /** Rediger */
  edit: [
    'M4 20l1-4.5L15.8 4.7A2.475 2.475 0 0 1 19.3 8.2L8.5 19z',
    'M13.3 7.2l3.5 3.5'
  ],

  calendar: [
    'M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
    'M8 3v4',
    'M16 3v4',
    'M4 10h16'
  ],

  /** App-lås */
  lock: [
    'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z',
    'M8 11V8a4 4 0 0 1 8 0v3',
    'M12 15v2'
  ],

  /** Gem backup */
  download: [
    'M12 4v11',
    'M7.5 10.5L12 15l4.5-4.5',
    'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3'
  ],

  /** Hent backup */
  upload: [
    'M12 15V4',
    'M7.5 8.5L12 4l4.5 4.5',
    'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3'
  ],

  share: [
    'M20 5.5a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0',
    'M9 12a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0',
    'M20 18.5a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0',
    'M8.65 10.73l6.7-3.96',
    'M8.65 13.27l6.7 3.96'
  ],

  /** Påmindelse */
  bell: [
    'M6 10a6 6 0 0 1 12 0v4.5l1.5 2.5h-15L6 14.5z',
    'M10 19.5a2 2 0 0 0 4 0'
  ],

  /**
   * Udseende: a circle with the right half filled. The fill is a serpentine stroke
   * (radii 7, 5, 3, 1) that closes up at stroke width 2. Kept in one path so the
   * rasterizer draws no hairline seams between the rings.
   */
  appearance: [
    'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0M12 3v18M12 5a7 7 0 0 1 0 14v-2a5 5 0 0 0 0-10v2a3 3 0 0 1 0 6v-2a1 1 0 0 0 0-2'
  ],

  /** Privatliv */
  shield: ['M12 3.5l7 2.5v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6z'],

  info: ['M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0', 'M12 11v5.5', 'M12 7.75h.01'],

  /** Fortryd */
  undo: ['M9 14L4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],

  note: [
    'M14 20H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v9z',
    'M14 20v-3a2 2 0 0 1 2-2h3',
    'M9 9h6',
    'M9 12.5h4'
  ],

  /**
   * The Saloona mark at UI size: upright open shears, the right blade passing under the
   * left one. Same construction as the launcher icon and splash. Use sparingly (empty
   * states, Om Saloona), not as decoration.
   */
  scissors: [
    'M10 17.5a3 3 0 1 1-6 0a3 3 0 1 1 6 0',
    'M20 17.5a3 3 0 1 1-6 0a3 3 0 1 1 6 0',
    'M8.68 15.02L16.5 3.5',
    'M15.32 15.02L13.52 12.37M10.48 7.9L7.5 3.5'
  ]
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICONS;

/** All icon names, in declaration order. Handy for previews and tests. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];
