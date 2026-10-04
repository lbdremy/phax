// WCAG 2 colour arithmetic for `#RRGGBB` tokens: relative luminance, contrast
// ratio and hue. The contrast test and nothing else reads it.

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** The red, green and blue channels of `#RRGGBB`, each 0–255. */
function channels(hex: string): readonly [number, number, number] {
  const match = HEX.exec(hex);
  if (match === null) throw new Error(`${hex} is not a #RRGGBB colour`);
  return [
    Number.parseInt(match[1] ?? "", 16),
    Number.parseInt(match[2] ?? "", 16),
    Number.parseInt(match[3] ?? "", 16),
  ];
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance, 0 (black) to 1 (white). */
function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex);
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** WCAG 2 contrast ratio between two colours, 1 to 21, order-independent. */
export function contrastRatio(left: string, right: string): number {
  const [light, dark] = [relativeLuminance(left), relativeLuminance(right)].toSorted(
    (a, b) => b - a,
  ) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** The HSL hue of a colour in degrees, 0 ≤ hue < 360; 0 for a grey. */
export function hue(hex: string): number {
  const [red, green, blue] = channels(hex).map((channel) => channel / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(red, green, blue);
  const delta = max - Math.min(red, green, blue);
  if (delta === 0) return 0;
  const sector =
    max === red
      ? ((green - blue) / delta) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return (sector * 60 + 360) % 360;
}

/** The shortest angle between two hues, 0 to 180 degrees. */
export function hueDistance(left: number, right: number): number {
  const distance = Math.abs(left - right) % 360;
  return distance > 180 ? 360 - distance : distance;
}
