/**
 * App-specific PrismButton presets. Register once at app load (see layout.tsx import).
 * Default presets (e.g. pillGradient, pillMonochrome, boxButtons) live in @prism/ui.
 */
import { registerPrismButtonPresets } from "@ui";

registerPrismButtonPresets({
  // Example: override or add app-specific presets.
  // "cta-primary": { color: "blue", paint: "backgroundDark", size: "large" },
  // "nav-action": { line: "none", paint: "backgroundNone", font: "serif" },
});
