// Built-in theme templates. Each palette drives BOTH the app chrome (via the
// CSS custom properties that index.css defines) and the xterm terminal
// colours, so picking a template restyles the whole app.
//
// `ansi` is the classic 16-colour order:
// [black, red, green, yellow, blue, magenta, cyan, white,
//  brBlack, brRed, brGreen, brYellow, brBlue, brMagenta, brCyan, brWhite]

export const THEMES = [
  {
    id: 'dracula', name: 'Dracula', dark: true,
    bg: '#282a36', surface: '#343746', fg: '#f8f8f2', mutedFg: '#8a94c1',
    primary: '#bd93f9', primaryFg: '#282a36',
    ansi: ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
           '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'],
  },
  {
    id: 'nord', name: 'Nord', dark: true,
    bg: '#2e3440', surface: '#3b4252', fg: '#d8dee9', mutedFg: '#8b96ab',
    primary: '#88c0d0', primaryFg: '#2e3440',
    ansi: ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
           '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4'],
  },
  {
    id: 'monokai', name: 'Monokai', dark: true,
    bg: '#272822', surface: '#3e3d32', fg: '#f8f8f2', mutedFg: '#a59f85',
    primary: '#a6e22e', primaryFg: '#272822',
    ansi: ['#272822', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f8f8f2',
           '#75715e', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f9f8f5'],
  },
  {
    id: 'solarized-dark', name: 'Solarized Dark', dark: true,
    bg: '#002b36', surface: '#073642', fg: '#93a1a1', mutedFg: '#657b83',
    primary: '#268bd2', primaryFg: '#fdf6e3',
    ansi: ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
           '#586e75', '#cb4b16', '#859900', '#b58900', '#268bd2', '#6c71c4', '#93a1a1', '#fdf6e3'],
  },
  {
    id: 'solarized-light', name: 'Solarized Light', dark: false,
    bg: '#fdf6e3', surface: '#eee8d5', fg: '#586e75', mutedFg: '#93a1a1',
    primary: '#268bd2', primaryFg: '#fdf6e3',
    ansi: ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
           '#586e75', '#cb4b16', '#859900', '#b58900', '#268bd2', '#6c71c4', '#93a1a1', '#fdf6e3'],
  },
  {
    id: 'gruvbox-dark', name: 'Gruvbox Dark', dark: true,
    bg: '#282828', surface: '#3c3836', fg: '#ebdbb2', mutedFg: '#928374',
    primary: '#fabd2f', primaryFg: '#282828',
    ansi: ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984',
           '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2'],
  },
  {
    id: 'gruvbox-light', name: 'Gruvbox Light', dark: false,
    bg: '#fbf1c7', surface: '#ebdbb2', fg: '#3c3836', mutedFg: '#7c6f64',
    primary: '#b57614', primaryFg: '#fbf1c7',
    ansi: ['#fbf1c7', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#7c6f64',
           '#928374', '#9d0006', '#79740e', '#b57614', '#076678', '#8f3f71', '#427b58', '#3c3836'],
  },
  {
    id: 'one-dark', name: 'One Dark', dark: true,
    bg: '#282c34', surface: '#31353f', fg: '#abb2bf', mutedFg: '#5c6370',
    primary: '#61afef', primaryFg: '#282c34',
    ansi: ['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
           '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff'],
  },
  {
    id: 'tokyo-night', name: 'Tokyo Night', dark: true,
    bg: '#1a1b26', surface: '#24283b', fg: '#c0caf5', mutedFg: '#565f89',
    primary: '#7aa2f7', primaryFg: '#1a1b26',
    ansi: ['#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
           '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5'],
  },
  {
    id: 'catppuccin-mocha', name: 'Catppuccin Mocha', dark: true,
    bg: '#1e1e2e', surface: '#313244', fg: '#cdd6f4', mutedFg: '#7f849c',
    primary: '#cba6f7', primaryFg: '#1e1e2e',
    ansi: ['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de',
           '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8'],
  },
  {
    id: 'catppuccin-latte', name: 'Catppuccin Latte', dark: false,
    bg: '#eff1f5', surface: '#dce0e8', fg: '#4c4f69', mutedFg: '#8c8fa1',
    primary: '#8839ef', primaryFg: '#eff1f5',
    ansi: ['#5c5f77', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#acb0be',
           '#6c6f85', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#bcc0cc'],
  },
  {
    id: 'ayu-dark', name: 'Ayu Dark', dark: true,
    bg: '#0a0e14', surface: '#131721', fg: '#b3b1ad', mutedFg: '#626a73',
    primary: '#e6b450', primaryFg: '#0a0e14',
    ansi: ['#01060e', '#ea6c73', '#91b362', '#f9af4f', '#53bdfa', '#fae994', '#90e1c6', '#c7c7c7',
           '#686868', '#f07178', '#c2d94c', '#ffb454', '#59c2ff', '#ffee99', '#95e6cb', '#ffffff'],
  },
  {
    id: 'night-owl', name: 'Night Owl', dark: true,
    bg: '#011627', surface: '#0b2942', fg: '#d6deeb', mutedFg: '#637777',
    primary: '#82aaff', primaryFg: '#011627',
    ansi: ['#011627', '#ef5350', '#22da6e', '#addb67', '#82aaff', '#c792ea', '#21c7a8', '#ffffff',
           '#575656', '#ef5350', '#22da6e', '#ffeb95', '#82aaff', '#c792ea', '#7fdbca', '#ffffff'],
  },
  {
    id: 'cobalt2', name: 'Cobalt2', dark: true,
    bg: '#193549', surface: '#1f4662', fg: '#ffffff', mutedFg: '#8ba7bf',
    primary: '#ffc600', primaryFg: '#193549',
    ansi: ['#000000', '#ff628c', '#3ad900', '#ffc600', '#0088ff', '#fb94ff', '#80fcff', '#ffffff',
           '#0050a4', '#ff628c', '#3ad900', '#ffc600', '#0088ff', '#fb94ff', '#80fcff', '#ffffff'],
  },
  {
    id: 'synthwave-84', name: "Synthwave '84", dark: true,
    bg: '#262335', surface: '#34294f', fg: '#f0eff1', mutedFg: '#848bbd',
    primary: '#ff7edb', primaryFg: '#262335',
    ansi: ['#262335', '#fe4450', '#72f1b8', '#fede5d', '#03edf9', '#ff7edb', '#03edf9', '#f0eff1',
           '#848bbd', '#fe4450', '#72f1b8', '#fede5d', '#03edf9', '#ff7edb', '#03edf9', '#ffffff'],
  },
  {
    id: 'github-dark', name: 'GitHub Dark', dark: true,
    bg: '#0d1117', surface: '#161b22', fg: '#c9d1d9', mutedFg: '#8b949e',
    primary: '#58a6ff', primaryFg: '#0d1117',
    ansi: ['#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4',
           '#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#f0f6fc'],
  },
  {
    id: 'github-light', name: 'GitHub Light', dark: false,
    bg: '#ffffff', surface: '#f6f8fa', fg: '#24292f', mutedFg: '#57606a',
    primary: '#0969da', primaryFg: '#ffffff',
    ansi: ['#24292e', '#d73a49', '#22863a', '#b08800', '#0366d6', '#6f42c1', '#1b7c83', '#6a737d',
           '#959da5', '#cb2431', '#28a745', '#dbab09', '#2188ff', '#8a63d2', '#3192aa', '#d1d5da'],
  },
  {
    id: 'everforest-dark', name: 'Everforest Dark', dark: true,
    bg: '#2d353b', surface: '#3d484d', fg: '#d3c6aa', mutedFg: '#859289',
    primary: '#a7c080', primaryFg: '#2d353b',
    ansi: ['#475258', '#e67e80', '#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6', '#83c092', '#d3c6aa',
           '#475258', '#e67e80', '#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6', '#83c092', '#d3c6aa'],
  },
  {
    id: 'rose-pine', name: 'Rosé Pine', dark: true,
    bg: '#191724', surface: '#26233a', fg: '#e0def4', mutedFg: '#908caa',
    primary: '#c4a7e7', primaryFg: '#191724',
    ansi: ['#26233a', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4',
           '#6e6a86', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4'],
  },
  {
    id: 'zenburn', name: 'Zenburn', dark: true,
    bg: '#3f3f3f', surface: '#4f4f4f', fg: '#dcdccc', mutedFg: '#9fafaf',
    primary: '#f0dfaf', primaryFg: '#3f3f3f',
    ansi: ['#4d4d4d', '#705050', '#60b48a', '#dfaf8f', '#506070', '#dc8cc3', '#8cd0d3', '#dcdccc',
           '#709080', '#dca3a3', '#c3bf9f', '#f0dfaf', '#94bff3', '#ec93d3', '#93e0e3', '#ffffff'],
  },
];

// The stock looks, exposed as styles like everything else. `builtin: true`
// means "don't override the index.css tokens" — the palette fields below
// only exist so the picker can draw a swatch.
export const DEFAULT_THEMES = [
  {
    id: 'default-dark', name: 'Default Dark', dark: true, builtin: true,
    bg: '#18181b', surface: '#27272a', fg: '#fafafa', mutedFg: '#a1a1aa',
    primary: '#e4e4e7', primaryFg: '#18181b',
    ansi: ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
           '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff'],
  },
  {
    id: 'default-light', name: 'Default Light', dark: false, builtin: true,
    bg: '#ffffff', surface: '#f4f4f5', fg: '#18181b', mutedFg: '#71717a',
    primary: '#18181b', primaryFg: '#fafafa',
    ansi: ['#383a42', '#e45649', '#50a14f', '#c18401', '#4078f2', '#a626a4', '#0184bc', '#fafafa',
           '#a0a1a7', '#e45649', '#50a14f', '#c18401', '#4078f2', '#a626a4', '#0184bc', '#ffffff'],
  },
];

export function getTheme(id) {
  return [...DEFAULT_THEMES, ...THEMES].find((t) => t.id === id) ?? null;
}

// CSS text applied through an adopted stylesheet — adopted sheets sit after
// index.css in the cascade, so these `:root` values win over the built-in
// `:root` / `.dark` tokens at equal specificity. Background and sidebar keep
// the glass color-mix so Liquid Glass transparency still works on templates.
export function themeCssText(t) {
  return `:root {
  --background: color-mix(in srgb, ${t.bg} var(--glass-bg-alpha, 100%), transparent);
  --foreground: ${t.fg};
  --card: ${t.surface};
  --card-foreground: ${t.fg};
  --popover: ${t.surface};
  --popover-foreground: ${t.fg};
  --primary: ${t.primary};
  --primary-foreground: ${t.primaryFg};
  --secondary: color-mix(in srgb, ${t.surface} 90%, ${t.fg});
  --secondary-foreground: ${t.fg};
  --muted: color-mix(in srgb, ${t.surface} 90%, ${t.fg});
  --muted-foreground: ${t.mutedFg};
  --accent: color-mix(in srgb, ${t.surface} 86%, ${t.fg});
  --accent-foreground: ${t.fg};
  --destructive: ${t.ansi[9]};
  --border: color-mix(in srgb, ${t.fg} 14%, transparent);
  --input: color-mix(in srgb, ${t.fg} 18%, transparent);
  --ring: ${t.mutedFg};
  --chart-1: ${t.ansi[12]};
  --chart-2: ${t.ansi[10]};
  --chart-3: ${t.ansi[11]};
  --chart-4: ${t.ansi[13]};
  --chart-5: ${t.ansi[9]};
  --sidebar: color-mix(in srgb, ${t.surface} var(--glass-bg-alpha, 100%), transparent);
  --sidebar-foreground: ${t.fg};
  --sidebar-primary: ${t.primary};
  --sidebar-primary-foreground: ${t.primaryFg};
  --sidebar-accent: color-mix(in srgb, ${t.surface} 86%, ${t.fg});
  --sidebar-accent-foreground: ${t.fg};
  --sidebar-border: color-mix(in srgb, ${t.fg} 14%, transparent);
  --sidebar-ring: ${t.mutedFg};
}`;
}

const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];

// Default terminal colours when no template is selected. Dark mode keeps
// xterm's stock palette; light mode needs dark text on the light app
// background (One Light-ish), or the terminal is white-on-white.
const LIGHT_DEFAULT_XTERM = {
  background: '#00000000',
  foreground: '#383a42',
  cursor: '#383a42',
  cursorAccent: '#fafafa',
  selectionBackground: '#4078f255',
  black: '#383a42', red: '#e45649', green: '#50a14f', yellow: '#c18401',
  blue: '#4078f2', magenta: '#a626a4', cyan: '#0184bc', white: '#fafafa',
  brightBlack: '#a0a1a7', brightRed: '#e45649', brightGreen: '#50a14f',
  brightYellow: '#c18401', brightBlue: '#4078f2', brightMagenta: '#a626a4',
  brightCyan: '#0184bc', brightWhite: '#ffffff',
};

// xterm theme. Background stays transparent — the terminal container is
// painted with the app's --background, so the template (and Liquid Glass)
// shows through. Built-in styles keep xterm's stock palette in dark and the
// light palette above in light.
export function xtermThemeFor(theme) {
  if (!theme || theme.builtin) {
    return !theme || theme.dark ? { background: '#00000000' } : LIGHT_DEFAULT_XTERM;
  }
  const colors = Object.fromEntries(ANSI_KEYS.map((key, i) => [key, theme.ansi[i]]));
  return {
    background: '#00000000',
    foreground: theme.fg,
    cursor: theme.primary,
    cursorAccent: theme.bg,
    selectionBackground: `${theme.primary}55`,
    ...colors,
  };
}

// Template offered to users from Settings → Custom CSS. Everything here is
// optional: uncomment and change only what you want to override.
export const CUSTOM_CSS_TEMPLATE = `/*
 * Custom theme for the SSH client.
 *
 * Load this file from Settings -> Custom CSS. Its contents are stored by the
 * app and reapplied on every launch (re-load the file after editing it).
 * These rules are applied AFTER the built-in theme and after any selected
 * template, so anything you set here wins.
 *
 * Notes:
 * - The terminal background is the app's --background (the terminal itself
 *   is transparent), so overriding --background restyles the terminal too.
 * - Terminal text/ANSI colours are canvas-rendered by xterm and can't be
 *   changed from CSS — pick a template for those.
 * - To keep macOS Liquid Glass transparency working, wrap background colours
 *   in the color-mix shown below instead of using a plain colour.
 */

:root {
  /* ── Core surfaces ─────────────────────────────────────────────── */
  /* --background: color-mix(in srgb, #1e1e2e var(--glass-bg-alpha, 100%), transparent); */
  /* --foreground: #cdd6f4; */
  /* --card: #313244; */
  /* --card-foreground: #cdd6f4; */
  /* --popover: #313244; */
  /* --popover-foreground: #cdd6f4; */

  /* ── Interactive colours ───────────────────────────────────────── */
  /* --primary: #cba6f7; */
  /* --primary-foreground: #1e1e2e; */
  /* --secondary: #45475a; */
  /* --secondary-foreground: #cdd6f4; */
  /* --muted: #45475a; */
  /* --muted-foreground: #7f849c; */
  /* --accent: #45475a; */
  /* --accent-foreground: #cdd6f4; */
  /* --destructive: #f38ba8; */

  /* ── Lines and focus rings ─────────────────────────────────────── */
  /* --border: color-mix(in srgb, #cdd6f4 14%, transparent); */
  /* --input: color-mix(in srgb, #cdd6f4 18%, transparent); */
  /* --ring: #7f849c; */

  /* ── Sidebar ───────────────────────────────────────────────────── */
  /* --sidebar: color-mix(in srgb, #313244 var(--glass-bg-alpha, 100%), transparent); */
  /* --sidebar-foreground: #cdd6f4; */
  /* --sidebar-primary: #cba6f7; */
  /* --sidebar-primary-foreground: #1e1e2e; */
  /* --sidebar-accent: #45475a; */
  /* --sidebar-accent-foreground: #cdd6f4; */
  /* --sidebar-border: color-mix(in srgb, #cdd6f4 14%, transparent); */
  /* --sidebar-ring: #7f849c; */

  /* ── Misc ──────────────────────────────────────────────────────── */
  /* --radius: 0.625rem; */
}

/* You can also target any part of the UI with regular CSS, e.g.:
.custom-scrollbar::-webkit-scrollbar-thumb { background-color: #cba6f7; }
*/
`;
