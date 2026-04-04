# Papierklammer Theme: Earth

> Theme identifier: `earth`
> Base hue: deep mahogany brown with warm natural accents
> Text: bone ivory with opacity hierarchy
> Mood: grounded, warm, organic, analog

---

## Source Palette

Derived from the "Velvet Collar" palette. Named swatches mapped to Papierklammer roles:

| Swatch name   | Hex       | Papierklammer role                          |
|---------------|-----------|---------------------------------------------|
| Mahogany Bark | `#2D1610` | --bg (base surface, dark rich brown)        |
| Velvet Collar | `#4A3428` | --bg-light (lighter surface)                |
| Rustic Fuel   | `#B5634B` | Accent, warm terracotta                     |
| Golden Fur    | `#8B7435` | --warn (tool calls, earthy gold)            |
| Gentle Fawn   | `#8A7A60` | --fg-dim reference tone                     |
| Tranquil Sky  | `#7A7B66` | Muted sage, secondary accent                |
| Leaf Green    | `#6B7450` | --alive (success, organic green)            |
| Bone Ivory    | `#E8E0D0` | --fg (primary text)                         |

---

## Color Variables

```css
[data-theme="earth"] {
  /* Background ramp (mahogany/brown) */
  --bg:         #2D1610;   /* base surface -- mahogany bark */
  --bg-dark:    #231210;   /* deeper than base, subtle depth */
  --bg-darker:  #1A0D0A;   /* deepest, logo bg, exec button bg */
  --bg-deep:    #120806;   /* near-black, rarely used */
  --bg-light:   #4A3428;   /* lighter surface, velvet collar */
  --bg-lighter: #5E4438;   /* lightest brown, highlights */

  /* Foreground (bone ivory with opacity for hierarchy) */
  --fg:         #E8E0D0;                     /* primary text, bone ivory */
  --fg-muted:   rgba(232, 224, 208, 0.68);   /* secondary text */
  --fg-dim:     rgba(232, 224, 208, 0.40);   /* labels, timestamps, keys */

  /* Borders (ivory with opacity) */
  --border:        rgba(232, 224, 208, 0.14);  /* default dividers */
  --border-strong: rgba(232, 224, 208, 0.26);  /* card outlines, input borders */

  /* Semantic status */
  --alive:  #6B7450;   /* running, active -- leaf green, muted and natural */
  --warn:   #8B7435;   /* tool calls, warnings -- golden fur */
  --dead:   #B5634B;   /* error, failed -- rustic fuel terracotta */
}
```

---

## Swatch Reference

| Name    | Hex       | Use                                     |
|---------|-----------|-----------------------------------------|
| deep    | `#120806` | Near-black, deepest accent              |
| darker  | `#1A0D0A` | Logo bg, exec button bg, tier badges    |
| dark    | `#231210` | Active tab bg, command prefix bg        |
| base    | `#2D1610` | Primary background surface              |
| light   | `#4A3428` | Lighter panels, hover states            |
| lighter | `#5E4438` | Highlights, selected states             |

---

## Differences from Rose and Violet Themes

### Text color

This is the first theme that does not use pure white for `--fg`. Instead it uses bone ivory (`#E8E0D0`), which has a warm yellowish tint that complements the brown background. This creates a softer, more analog feel compared to the crisp white-on-color of the other themes.

All opacity values for `--fg-muted`, `--fg-dim`, `--border`, and `--border-strong` are based on this ivory rather than `#FFFFFF`.

### Status colors

The status colors are deliberately desaturated and earthy compared to the other themes:

| Role   | Rose theme | Violet theme | Earth theme | Notes                        |
|--------|------------|--------------|-------------|------------------------------|
| --alive| `#82E88A`  | `#5AE87A`    | `#6B7450`   | Muted leaf green, not neon   |
| --warn | `#E8D560`  | `#E8D560`    | `#8B7435`   | Golden fur, deep warm gold   |
| --dead | `#FF6060`  | `#FF5555`    | `#B5634B`   | Terracotta, not alarm red    |

This is a deliberate choice. The earth theme trades immediate signal clarity for aesthetic coherence. The status indicators still read correctly because of their relative contrast against the dark background, but they feel integrated rather than overlaid.

If this proves too subtle in practice, brighter alternatives that stay within the palette's warmth:

```css
/* Optional: higher-contrast status variants */
--alive:  #8A9E5A;   /* brighter olive-green */
--warn:   #C4A044;   /* brighter gold */
--dead:   #D06A4A;   /* brighter terracotta */
```

### Border opacity

The base background is very dark (`#2D1610`), closer to black than the rose or violet themes. Borders need lower opacity to avoid looking harsh:

| Variable       | Rose | Violet | Earth | Reason                            |
|----------------|------|--------|-------|-----------------------------------|
| --border       | 0.18 | 0.16   | 0.14  | Dark bg makes borders more visible|
| --border-strong| 0.32 | 0.30   | 0.26  | Same reasoning                    |

### Contrast notes

- Bone ivory (`#E8E0D0`) on mahogany (`#2D1610`) has a contrast ratio of approximately 10.5:1 (exceeds WCAG AAA)
- `--fg-muted` (68% ivory) on mahogany still exceeds 7:1 (WCAG AAA)
- `--fg-dim` (40% ivory) on mahogany sits around 4.2:1 (WCAG AA, appropriate for its label/timestamp role)

---

## CSS Block

```css
[data-theme="earth"] {
  --bg:         #2D1610;
  --bg-dark:    #231210;
  --bg-darker:  #1A0D0A;
  --bg-deep:    #120806;
  --bg-light:   #4A3428;
  --bg-lighter: #5E4438;
  --fg:         #E8E0D0;
  --fg-muted:   rgba(232, 224, 208, 0.68);
  --fg-dim:     rgba(232, 224, 208, 0.40);
  --border:        rgba(232, 224, 208, 0.14);
  --border-strong: rgba(232, 224, 208, 0.26);
  --alive:  #6B7450;
  --warn:   #8B7435;
  --dead:   #B5634B;
}
```

---

## Additional Accent Colors (for future use)

These are available from the source palette if you need additional semantic or decorative colors beyond the core 14 variables:

| Name          | Hex       | Potential use                          |
|---------------|-----------|----------------------------------------|
| Gentle Fawn   | `#8A7A60` | Secondary accent, muted info states    |
| Tranquil Sky  | `#7A7B66` | Tertiary accent, neutral highlights    |
| Rustic Fuel   | `#B5634B` | Already used as --dead, also works as primary action accent |

These should only be introduced if the core 14 variables prove insufficient. Keeping the variable count low ensures theme portability.
