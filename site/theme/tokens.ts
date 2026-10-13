// The phax identity tokens, the single source of the site's palette: the
// generator renders site/generated/theme.css from themeCss(), and the contrast
// test reads THEMES, so a value cannot pass the test while shipping something
// else. Dark is the default theme (site/theme/appearance.ts). Bright gold on
// neutral graphite, the golden path: gold is an accent only (rules, focus
// rings, the logo, highlights); light links are bronze; warnings are
// vermilion, never gold. A gold accent must stand out from the background, so
// the light theme's is a deeper ochre gold; large gold surfaces (the primary
// button, the phases, the glow) take the fill instead, the bright gold in both
// themes, with dark text on it.

export type ThemeName = "dark" | "light";

/** What a token is used for, which sets the contrast it must reach. */
export type TokenRole =
  | "background"
  | "running text"
  | "secondary"
  | "link"
  | "gold accent"
  | "gold fill"
  | "text on fill"
  | "warning";

export type TokenName =
  | "bg"
  | "bgSoft"
  | "text1"
  | "text2"
  | "link"
  | "brand"
  | "fill"
  | "fillText"
  | "warning";

export type Theme = Readonly<Record<TokenName, string>>;

export const TOKEN_ROLES: Readonly<Record<TokenName, TokenRole>> = {
  bg: "background",
  bgSoft: "background",
  text1: "running text",
  text2: "secondary",
  link: "link",
  brand: "gold accent",
  fill: "gold fill",
  fillText: "text on fill",
  warning: "warning",
};

export const THEMES: Readonly<Record<ThemeName, Theme>> = {
  dark: {
    bg: "#0F0F11",
    bgSoft: "#18181B",
    text1: "#EDEDEF",
    text2: "#A1A1AA",
    link: "#E9C46A",
    brand: "#E2B33C",
    fill: "#E2B33C",
    fillText: "#0F0F11",
    warning: "#E5604A",
  },
  light: {
    bg: "#F5F5F4",
    bgSoft: "#EAEAE8",
    text1: "#18181B",
    text2: "#57575E",
    link: "#5A4206",
    brand: "#A87A0A",
    fill: "#E2B33C",
    fillText: "#18181B",
    warning: "#B83A22",
  },
};

/** The gold accent of each theme: the logo's stroke colour in that theme. */
export const GOLD_DARK = THEMES.dark.brand;
export const GOLD_LIGHT = THEMES.light.brand;
export const GOLD_TOKENS: ReadonlyArray<string> = [
  ...new Set([GOLD_DARK, GOLD_LIGHT, THEMES.dark.fill, THEMES.light.fill]),
];

/** The light theme's link colour. */
export const BRONZE = THEMES.light.link;

/** The @fontsource files the theme CSS imports: latin subset, bundled by Rspress. */
const FONT_IMPORTS: ReadonlyArray<string> = [
  "@fontsource/ibm-plex-sans/latin-400.css",
  "@fontsource/ibm-plex-sans/latin-600.css",
  "@fontsource/ibm-plex-mono/latin-400.css",
];

/**
 * Rspress v2's theme selectors. Its own variables sit in `:where(…)` (no
 * specificity) and its callout variables under `:root` and `.dark`; these
 * selectors outrank both.
 */
export const THEME_SELECTORS: Readonly<Record<ThemeName, string>> = {
  light: "html:not(.rp-dark)",
  dark: "html.rp-dark",
};

const FONT_FAMILIES = {
  "--rp-font-family-base":
    '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  "--rp-font-family-mono": '"IBM Plex Mono", Menlo, Monaco, Consolas, "Courier New", monospace',
};

/** Rspress's variables for one theme, `--name` → value, in output order. */
function themeVariables(theme: Theme): ReadonlyArray<readonly [string, string]> {
  const callout = (kind: "warning" | "danger"): ReadonlyArray<readonly [string, string]> => [
    [`--rp-container-${kind}-text`, theme.warning],
    [`--rp-container-${kind}-border`, `${theme.warning}66`],
    [`--rp-container-${kind}-bg`, `${theme.warning}1a`],
    [`--rp-container-${kind}-code-bg`, `${theme.warning}1a`],
  ];
  return [
    ["--rp-c-bg", theme.bg],
    ["--rp-c-bg-alt", theme.bg],
    ["--rp-c-bg-soft", theme.bgSoft],
    ["--rp-c-bg-mute", theme.bgSoft],
    ["--rp-c-text-0", theme.text1],
    ["--rp-c-text-1", theme.text1],
    ["--rp-c-text-2", theme.text2],
    ["--rp-c-link", theme.link],
    ["--rp-c-brand", theme.brand],
    ["--rp-c-brand-light", theme.brand],
    ["--rp-c-brand-lighter", theme.brand],
    ["--rp-c-brand-dark", theme.brand],
    ["--rp-c-brand-darker", theme.brand],
    ["--rp-c-brand-tint", `${theme.fill}29`],
    ["--phax-c-fill", theme.fill],
    ["--phax-c-fill-text", theme.fillText],
    // The home's hero title and primary button fill with the gold, and its
    // background glows gold from the top right, across most of the hero,
    // where Rspress's default is a purple gradient.
    ["--rp-home-hero-title-bg", theme.brand],
    [
      "--rp-home-background-bg",
      `radial-gradient(80% 85% at 100% 0%, ${theme.fill}2e 0%, ${theme.fill}12 45%, transparent 100%)`,
    ],
    ["--phax-c-warning", theme.warning],
    // The warning callout and the caution/danger callouts (Rspress styles
    // caution with the danger variables) all warn in terracotta.
    ...callout("warning"),
    ...callout("danger"),
  ];
}

function block(selector: string, variables: ReadonlyArray<readonly [string, string]>): string {
  return [`${selector} {`, ...variables.map(([name, value]) => `  ${name}: ${value};`), "}"].join(
    "\n",
  );
}

/** site/generated/theme.css: fonts, both themes' variables, and the gold accents. */
export function themeCss(): string {
  return [
    "/* Generated from site/theme/tokens.ts by pnpm site:build. */",
    ...FONT_IMPORTS.map((path) => `@import "${path}";`),
    "",
    block(":root", Object.entries(FONT_FAMILIES)),
    "",
    block(THEME_SELECTORS.light, themeVariables(THEMES.light)),
    "",
    block(THEME_SELECTORS.dark, themeVariables(THEMES.dark)),
    "",
    block(":focus-visible", [["outline", "2px solid var(--rp-c-brand)"]]),
    "",
    block(".rp-doc hr", [["border-color", "var(--rp-c-brand)"]]),
    "",
  ].join("\n");
}
