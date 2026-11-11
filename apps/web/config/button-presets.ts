/**
 * App-specific PrismButton presets. Register once at app load (see page.tsx import).
 * Default presets (e.g. pillGradient, pillMonochrome, boxButtons) live in @prism/ui.
 *
 * ONE BUTTON COLOUR — BLUE (Robin's pick, 2026-11-11). Every button in the
 * app is blue: solid blue fill for primary/apply/danger, blue outline with
 * light-blue text for secondary (default/ghost). Disabled buttons keep their
 * blue fill faded by PrismButton's own opacity (0.33) — never grey. The
 * deep-orange Apply accent and the red danger accent are retired from
 * buttons; queue/swap badges keep their existing amber/green/blue fills
 * (those are state badges, not buttons).
 *
 * Sideline tuning (deliberate, documented):
 * - All presets disable the GSAP hover grow and the Lucide stroke-draw
 *   entrance: on a phone there is no hover, and grow/reveal motion risks
 *   layout shift and late-rendering controls. The 0.25s colour transition
 *   stays (disableMotion is NOT set).
 * - Paint is `backgroundDark` (saturated 800 fill, 100 text) instead of
 *   Prism's default `background` (pale 100 fill): the pale fill reads
 *   washed-out on the dark sideline screen. The secondary presets
 *   (default/ghost) use `backgroundNone` + `inverted` instead: a
 *   non-inverted ghost's 800-shade text is dark-on-dark here, and
 *   `inverted` flips text/border to the 100 shade (#bbdefb) — a blue
 *   outline with blue text on charcoal. Caveat, documented in Prism's own
 *   code: on hover / toggled the ghost fill becomes the 100 tint while
 *   the text stays 100, so it reads light-on-light — but there is no
 *   hover on a phone and PBtn never uses `toggled`, so it cannot occur
 *   on the sideline.
 * - `sm-apply` uses size `large` (21px label, ~57px tall) — the spec's
 *   56px Apply button. Other kinds use size `regular` with a 16px
 *   font-size override in PBtn: Prism's regular 14px is below the
 *   sideline legibility floor, and `large`'s 21px is too big for dense
 *   button rows.
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
    color: { palette: "default", swatchPrimary: "blue" },
    paint: "backgroundDark",
    shape: "pill",
    size: "large",
    spacing: "regular",
    disableGrow: true,
    disableIconMotion: true,
  },
  "sm-danger": {
    color: { palette: "default", swatchPrimary: "blue" },
    paint: "backgroundDark",
    shape: "pill",
    size: "regular",
    spacing: "comfortable",
    disableGrow: true,
    disableIconMotion: true,
  },
  "sm-ghost": {
    color: { palette: "default", swatchPrimary: "blue" },
    paint: "backgroundNone",
    inverted: true,
    shape: "pill",
    size: "regular",
    spacing: "comfortable",
    disableGrow: true,
    disableIconMotion: true,
  },
  "sm-default": {
    color: { palette: "default", swatchPrimary: "blue" },
    // Blue outline with blue text, like the ghost: secondary actions
    // (Edit lineup, Suggest rotation, Export roster, …) are outline
    // buttons, not solid pills — solid blue is reserved for primary
    // actions so the two stay distinguishable by treatment, not hue.
    paint: "backgroundNone",
    inverted: true,
    shape: "pill",
    size: "regular",
    spacing: "comfortable",
    disableGrow: true,
    disableIconMotion: true,
  },
});
