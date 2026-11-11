/**
 * App-specific PrismButton presets. Register once at app load (see layout.tsx import).
 * Default presets (e.g. pillGradient, pillMonochrome, boxButtons) live in @prism/ui.
 *
 * Sideline tuning (deliberate, documented):
 * - All presets disable the GSAP hover grow and the Lucide stroke-draw
 *   entrance: on a phone there is no hover, and grow/reveal motion risks
 *   layout shift and late-rendering controls. The 0.25s colour transition
 *   stays (disableMotion is NOT set).
 * - Paint is `backgroundDark` (saturated 800 fill, 100 text) instead of
 *   Prism's default `background` (pale 100 fill): the pale fill reads
 *   washed-out on the dark sideline screen. The one exception is the
 *   ghost preset, which stays `backgroundNone` but `inverted` (see below)
 *   — a non-inverted ghost's 800-shade text is dark-on-dark here.
 * - `sm-apply` uses size `large` (21px label, ~57px tall) — the spec's
 *   56px Apply button. Other kinds use size `regular` with a 16px
 *   font-size override in PBtn: Prism's regular 14px is below the
 *   sideline legibility floor, and `large`'s 21px is too big for dense
 *   button rows.
 * - Colours follow Prism's house idiom: blue is the primary accent
 *   (Prism's default swatchPrimary), deep-orange marks the Apply action,
 *   red marks danger, blue-grey is the neutral/ghost family. Green is
 *   reserved for the field and for success/on states.
 */
import { registerPrismButtonPresets } from "@ui";

registerPrismButtonPresets({
  "sm-primary": {
    color: { palette: "default", swatchPrimary: "blue" },
    paint: "backgroundDark",
    shape: "pill",
    size: "regular",
    spacing: "comfortable",
    disableGrow: true,
    disableIconMotion: true,
  },
  "sm-apply": {
    color: { palette: "default", swatchPrimary: "deep-orange" },
    paint: "backgroundDark",
    shape: "pill",
    size: "large",
    spacing: "regular",
    disableGrow: true,
    disableIconMotion: true,
  },
  "sm-danger": {
    color: { palette: "default", swatchPrimary: "red" },
    paint: "backgroundDark",
    shape: "pill",
    size: "regular",
    spacing: "comfortable",
    disableGrow: true,
    disableIconMotion: true,
  },
  "sm-ghost": {
    color: { palette: "default", swatchPrimary: "blue-grey" },
    paint: "backgroundNone",
    // `inverted` is what makes a ghost readable on a dark page: Prism's
    // ghost text is the family's 800 shade by default (dark-on-dark here),
    // and `inverted` flips it to the 100 shade (#cfd8dc) with a matching
    // light border. Caveat, documented in Prism's own code: on hover /
    // toggled the ghost fill becomes the 100 tint while the text stays
    // 100, so it reads light-on-light — but there is no hover on a phone
    // and PBtn never uses `toggled`, so it cannot occur on the sideline.
    inverted: true,
    shape: "pill",
    size: "regular",
    spacing: "comfortable",
    disableGrow: true,
    disableIconMotion: true,
  },
  "sm-default": {
    color: { palette: "default", swatchPrimary: "blue-grey" },
    // `backgroundDark`, not the default `background`: the pale 100 fill
    // is fine on Prism's white page, but the workhorse secondary buttons
    // (Edit lineup, Suggest rotation, …) need a solid dark-grey pill
    // with light text to stay readable on charcoal.
    paint: "backgroundDark",
    shape: "pill",
    size: "regular",
    spacing: "comfortable",
    disableGrow: true,
    disableIconMotion: true,
  },
});
