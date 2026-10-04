// Dark first. Rspress v2 has its own option for it: `themeConfig.darkMode:
// 'dark'` makes dark the default while keeping the theme toggle, and Rspress
// injects an inline head script that applies the stored preference
// (localStorage `rspress-theme-appearance`: light, dark or auto) and falls
// back to dark when none is stored. No script of ours is needed; this module
// names the option and exposes Rspress's script so the test can run it.
import { getInlineThemeScript } from "@rspress/core/dist/node/constants.js";

/** site/rspress.config.ts's `themeConfig.darkMode`. */
export const DARK_MODE = "dark";

/** Where Rspress stores the reader's theme choice. */
export const APPEARANCE_KEY = "rspress-theme-appearance";

/** The inline script Rspress puts in every page's head for DARK_MODE. */
export function appearanceScript(): string {
  return getInlineThemeScript(DARK_MODE);
}
