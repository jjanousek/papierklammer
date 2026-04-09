# Papierklammer Theme: Deep Violet-Indigo

> Theme identifier: `violet-indigo`
> Base hue: violet-shifted blue, saturated, electric
> Text: white with opacity hierarchy
> Mood: powerful, alien, retro-future terminal

---

## Color Variables

```css
[data-theme="violet-indigo"] {
  /* Background ramp (deep violet-indigo) */
  --bg:         #3A28B0;   /* base surface */
  --bg-dark:    #2C1E8A;   /* subtle emphasis, hover states, active tab bg */
  --bg-darker:  #1F1566;   /* strong emphasis, logo bg, exec button bg, tier badges */
  --bg-deep:    #150E45;   /* deepest accent, rarely used */
  --bg-light:   #5040C8;   /* lighter surface if needed */
  --bg-lighter: #6A5CD8;   /* lightest, highlights */

  /* Foreground (white with opacity for hierarchy) */
  --fg:         #FFFFFF;                 /* primary text, values, active items */
  --fg-muted:   rgba(255, 255, 255, 0.70);  /* secondary text, inactive sidebar items */
  --fg-dim:     rgba(255, 255, 255, 0.40);  /* tertiary text, labels, timestamps, keys */

  /* Borders (white with opacity) */
  --border:        rgba(255, 255, 255, 0.16);  /* default dividers */
  --border-strong: rgba(255, 255, 255, 0.30);  /* card outlines, input borders */

  /* Semantic status */
  --alive:  #5AE87A;   /* running, active, success */
  --warn:   #E8D560;   /* tool calls, warnings, pending */
  --dead:   #FF5555;   /* error, failed, disconnected */
}
```

---

## Swatch Reference

| Name    | Hex       | Use                                     |
|---------|-----------|-----------------------------------------|
| deep    | `#150E45` | Deepest accent                          |
| darker  | `#1F1566` | Logo bg, exec button bg, tier badges    |
| dark    | `#2C1E8A` | Active tab bg, command prefix bg        |
| base    | `#3A28B0` | Primary background surface              |
| light   | `#5040C8` | Optional lighter surface                |
| lighter | `#6A5CD8` | Optional highlights                     |

---

## Differences from Rose Theme

### Opacity adjustments

The violet base is darker and more saturated than the rose, so text opacity values shift slightly to maintain readability:

| Role       | Rose theme | Violet theme | Reason                                      |
|------------|------------|--------------|---------------------------------------------|
| --fg-muted | 0.68       | 0.70         | Darker bg needs slightly more opacity        |
| --fg-dim   | 0.40       | 0.40         | Unchanged, sufficient contrast               |
| --border   | 0.18       | 0.16         | Violet is darker so less opacity still reads |
| --border-strong | 0.32  | 0.30         | Same reasoning                               |

### Status color adjustments

The violet theme uses more saturated/electric status colors (`#5AE87A` green, `#E8D560` yellow, `#FF5555` red) because the deep violet background has high saturation and muted tones would look washed out. The rose theme uses softer, warmer status colors (`#78C498` sage green, `#C8A85A` amber gold, `#D47272` soft coral) that harmonize with its warm midtone palette.

### Contrast notes

- White text on `#3A28B0` has a contrast ratio of approximately 7.2:1 (exceeds WCAG AAA)
- `--fg-muted` (70% white) on `#3A28B0` still exceeds 5:1 (WCAG AA)
- `--fg-dim` (40% white) on `#3A28B0` sits around 3:1 (decorative/non-essential text only, which is its intended use for labels and timestamps)

---

## Theme Switching Implementation

### CSS approach

Each theme is a set of CSS custom properties scoped to a `data-theme` attribute on the root element:

```css
/* Default: rose */
:root,
[data-theme="rose"] {
  --bg: #C4878E;
  --bg-dark: #B07078;
  --bg-darker: #8E5A64;
  --bg-deep: #6B3F48;
  --bg-light: #D4A0A6;
  --bg-lighter: #E2BCC0;
  --fg: #FFFFFF;
  --fg-muted: rgba(255, 255, 255, 0.68);
  --fg-dim: rgba(255, 255, 255, 0.40);
  --border: rgba(255, 255, 255, 0.18);
  --border-strong: rgba(255, 255, 255, 0.32);
  --alive: #78C498;
  --warn: #C8A85A;
  --dead: #D47272;
}

[data-theme="violet-indigo"] {
  --bg: #3A28B0;
  --bg-dark: #2C1E8A;
  --bg-darker: #1F1566;
  --bg-deep: #150E45;
  --bg-light: #5040C8;
  --bg-lighter: #6A5CD8;
  --fg: #FFFFFF;
  --fg-muted: rgba(255, 255, 255, 0.70);
  --fg-dim: rgba(255, 255, 255, 0.40);
  --border: rgba(255, 255, 255, 0.16);
  --border-strong: rgba(255, 255, 255, 0.30);
  --alive: #5AE87A;
  --warn: #E8D560;
  --dead: #FF5555;
}
```

### Switching

```js
// Set theme
document.documentElement.setAttribute('data-theme', 'violet-indigo');

// Read current theme
const current = document.documentElement.getAttribute('data-theme') || 'rose';

// Persist preference
localStorage.setItem('papierklammer-theme', theme);
```

### Config panel integration

In the config tab, theme selection should be a simple list with the current theme marked:

```
THEME

> rose              active
  violet-indigo
  [future themes]
```

No preview thumbnails, no color swatches in the picker. Just names. TUI style.

---

## Adding Future Themes

Any new theme only needs to define the same set of CSS custom properties. The full list:

```
--bg
--bg-dark
--bg-darker
--bg-deep
--bg-light
--bg-lighter
--fg
--fg-muted
--fg-dim
--border
--border-strong
--alive
--warn
--dead
```

All components reference only these variables. No component should ever contain a hardcoded color. This makes theming purely a matter of swapping 14 values.

### Checklist for new themes

1. Define all 14 variables
2. Verify white (or chosen --fg) text contrast against --bg is at least 4.5:1
3. Verify --fg-muted contrast against --bg is at least 3:1
4. Verify --alive, --warn, --dead are visually distinct against --bg
5. Verify --border is visible but subtle against --bg
6. Verify --bg-darker is noticeably distinct from --bg (used for logo, buttons)
7. Test with a full pipeline view (5+ agents, mixed states)
