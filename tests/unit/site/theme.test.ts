import { describe, expect, it } from "vitest";
import { APPEARANCE_KEY, appearanceScript } from "../../../site/theme/appearance.js";
import { contrastRatio, hue, hueDistance } from "../../../site/theme/contrast.js";
import {
  BRONZE,
  GOLD_TOKENS,
  THEMES,
  THEME_SELECTORS,
  TOKEN_ROLES,
  themeCss,
  type Theme,
  type ThemeName,
  type TokenName,
  type TokenRole,
} from "../../../site/theme/tokens.js";

const THEME_NAMES: ReadonlyArray<ThemeName> = ["dark", "light"];

const MINIMUM: Partial<Record<TokenRole, number>> = {
  "running text": 7,
  link: 7,
  secondary: 4.5,
  "gold accent": 3,
};

function tokensWithRole(role: TokenRole): ReadonlyArray<TokenName> {
  return (Object.keys(TOKEN_ROLES) as Array<TokenName>).filter(
    (name) => TOKEN_ROLES[name] === role,
  );
}

/** The `--name: value` declarations of `selector`'s block in `css`. */
function declarations(css: string, selector: string): ReadonlyMap<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("}", start));
  return new Map(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1] ?? "", match[2] ?? ""]),
  );
}

describe("contrast", () => {
  it("computes WCAG 2 ratios and hues", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    expect(hue("#FF0000")).toBe(0);
    expect(hue("#00FF00")).toBe(120);
    expect(hueDistance(350, 10)).toBe(20);
  });
});

describe.each(THEME_NAMES)("the %s theme", (name) => {
  const theme: Theme = THEMES[name];
  const backgrounds = tokensWithRole("background");

  it.each(Object.entries(MINIMUM))("keeps every %s token at its minimum ratio", (role, minimum) => {
    for (const token of tokensWithRole(role as TokenRole)) {
      for (const background of backgrounds) {
        const ratio = contrastRatio(theme[token], theme[background]);
        expect(ratio, `${name} ${token} on ${background}`).toBeGreaterThanOrEqual(minimum ?? 0);
      }
    }
  });

  it("warns in a hue at least 20° from every gold token, never in gold", () => {
    expect(GOLD_TOKENS).not.toContain(theme.warning);
    for (const gold of GOLD_TOKENS) {
      expect(hueDistance(hue(theme.warning), hue(gold))).toBeGreaterThanOrEqual(20);
    }
  });

  it("renders the warning, caution and danger callouts in the warning token", () => {
    const variables = declarations(themeCss(), THEME_SELECTORS[name]);
    const callouts = [...variables].filter(([variable]) =>
      /^--rp-container-(?:warning|danger)-/.test(variable),
    );
    expect(callouts.map(([variable]) => variable)).toEqual(
      expect.arrayContaining(["--rp-container-warning-text", "--rp-container-danger-text"]),
    );
    for (const [variable, value] of callouts) {
      expect(value.slice(0, 7), variable).toBe(theme.warning);
    }
  });

  it("sets the link and brand variables to the theme's tokens", () => {
    const variables = declarations(themeCss(), THEME_SELECTORS[name]);
    expect(variables.get("--rp-c-link")).toBe(theme.link);
    expect(variables.get("--rp-c-brand")).toBe(theme.brand);
    expect(variables.get("--rp-c-text-1")).toBe(theme.text1);
    expect(variables.get("--rp-c-bg")).toBe(theme.bg);
  });
});

describe("the light theme", () => {
  it("links in bronze and never uses gold for running text or links", () => {
    expect(THEMES.light.link).toBe(BRONZE);
    for (const token of [...tokensWithRole("running text"), ...tokensWithRole("link")]) {
      expect(GOLD_TOKENS).not.toContain(THEMES.light[token]);
    }
    const variables = declarations(themeCss(), THEME_SELECTORS.light);
    for (const variable of ["--rp-c-text-0", "--rp-c-text-1", "--rp-c-text-2", "--rp-c-link"]) {
      expect(GOLD_TOKENS, variable).not.toContain(variables.get(variable));
    }
  });
});

describe("themeCss", () => {
  it("bundles the fonts locally and loads no http(s) URL", () => {
    const css = themeCss();
    expect(css).toContain('@import "@fontsource/ibm-plex-sans/latin-400.css";');
    expect(css).toContain('@import "@fontsource/ibm-plex-sans/latin-600.css";');
    expect(css).toContain('@import "@fontsource/ibm-plex-mono/latin-400.css";');
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/url\(\s*["']?\/\//);
  });
});

interface FakePage {
  readonly classes: Set<string>;
  readonly colorScheme: string;
}

/** Runs Rspress's appearance script against fake storage, matchMedia and document. */
function loadPage(stored: string | null, systemPrefersDark: boolean): FakePage {
  const classes = new Set<string>();
  const style = { colorScheme: "" };
  const window = {
    matchMedia: (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" && systemPrefersDark,
    }),
  };
  const localStorage = {
    getItem: (key: string) => (key === APPEARANCE_KEY ? stored : null),
  };
  const document = {
    documentElement: {
      classList: {
        toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      },
      style,
    },
  };
  new Function("window", "localStorage", "document", appearanceScript())(
    window,
    localStorage,
    document,
  );
  return { classes, colorScheme: style.colorScheme };
}

describe("dark first", () => {
  it("renders dark with no stored preference while the system prefers light", () => {
    const page = loadPage(null, false);
    expect(page.classes).toEqual(new Set(["dark", "rp-dark"]));
    expect(page.colorScheme).toBe("dark");
  });

  it("keeps a stored light preference", () => {
    const page = loadPage("light", true);
    expect(page.classes).toEqual(new Set());
    expect(page.colorScheme).toBe("light");
  });

  it("loads nothing from another origin", () => {
    expect(appearanceScript()).not.toMatch(/https?:\/\/|src=/);
  });
});
