// The phax identity tokens, the single source of the site's palette: the
// generator renders site/generated/theme.css from themeCss(), and the contrast
// test reads THEMES, so a value cannot pass the test while shipping something
// else. Dark is the default theme (site/theme/appearance.ts). Gold is an
// accent only (rules, focus rings, the logo, highlights); light links are
// bronze; warnings are terracotta, never gold.

export type ThemeName = "dark" | "light";

/** What a token is used for, which sets the contrast it must reach. */
export type TokenRole =
  | "background"
  | "running text"
  | "secondary"
  | "link"
  | "gold accent"
  | "warning";

export type TokenName = "bg" | "bgSoft" | "text1" | "text2" | "link" | "brand" | "warning";

export type Theme = Readonly<Record<TokenName, string>>;

export const TOKEN_ROLES: Readonly<Record<TokenName, TokenRole>> = {
  bg: "background",
  bgSoft: "background",
  text1: "running text",
  text2: "secondary",
  link: "link",
  brand: "gold accent",
  warning: "warning",
};

export const THEMES: Readonly<Record<ThemeName, Theme>> = {
  dark: {
    bg: "#15130E",
    bgSoft: "#1E1B14",
    text1: "#EDE6D6",
    text2: "#A89F8A",
    link: "#C2A160",
    brand: "#B39257",
    warning: "#D96A4F",
  },
  light: {
    bg: "#F7F3EA",
    bgSoft: "#EFE9DC",
    text1: "#1E1A12",
    text2: "#5C5546",
    link: "#5E4720",
    brand: "#9A7A3E",
    warning: "#A33B22",
  },
};

/** The old-gold accent of each theme: the logo's stroke colour in that theme. */
export const GOLD_DARK = THEMES.dark.brand;
export const GOLD_LIGHT = THEMES.light.brand;
export const GOLD_TOKENS: ReadonlyArray<string> = [GOLD_DARK, GOLD_LIGHT];

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
    ["--rp-c-brand-tint", `${theme.brand}29`],
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
