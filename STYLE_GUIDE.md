# UI Style Guide

This guide documents the visual language already used by the application. It is a reference for extending the interface without introducing a second, competing style.

## 1. Design direction

The interface is a compact desktop utility: quiet, functional, and information-dense. It should feel native to a technical workflow rather than like a marketing site or analytics dashboard.

The visual foundation is:

- shadcn/ui with the `new-york` style
- Tailwind CSS utilities in JSX
- the neutral shadcn color scale, expressed through semantic CSS variables
- Lucide icons
- dark mode by default
- restrained animation used to explain state changes

Prefer flat surfaces, thin borders, small radii, and clear type hierarchy. Avoid gradients, glass effects, neon accents, oversized cards, decorative shadows, and ornamental motion.

## 2. Sources of truth

- `components.json` defines the shadcn style, icon set, aliases, and neutral base color.
- `src/renderer/index.css` owns theme tokens, third-party CSS imports, keyframes, and animation utilities.
- `src/renderer/components/ui/` contains the reusable shadcn primitives.
- Feature components use Tailwind utility classes in JSX.

All hand-written CSS must remain in `src/renderer/index.css`. Do not create another stylesheet, add a `<style>` block, or import CSS from JavaScript or JSX. Third-party CSS must be imported from `index.css`.

## 3. Color

Use semantic color utilities rather than raw color values. This preserves contrast and keeps light and dark themes aligned.

| Purpose | Use |
| --- | --- |
| App canvas | `bg-background text-foreground` |
| Raised surface | `bg-card text-card-foreground` |
| Quiet surface | `bg-muted` or `bg-muted/40` |
| Secondary text | `text-muted-foreground` |
| Hover or selection | `bg-accent text-accent-foreground` |
| Primary action | `bg-primary text-primary-foreground` |
| Dividers | `border-border`, usually shortened to `border` |
| Errors and dangerous actions | `text-destructive`, `bg-destructive/10` |
| Sidebar | `bg-sidebar text-sidebar-foreground` and sidebar-specific tokens |

Status colors may use direct Tailwind colors when their meaning is conventional and local:

- connected or complete: `emerald-500`
- file download or remote folder: `sky-400`
- error: prefer the semantic `destructive` token

Do not introduce a brand accent color unless the theme tokens are intentionally revised across both light and dark modes.

The terminal canvas is the one deliberate exception to semantic surfaces. It may use a fixed near-black color so terminal rendering remains stable across themes.

## 4. Typography

Use the system sans-serif stack supplied by the browser and Tailwind. Terminal output, fingerprints, paths, and logs use `font-mono`.

The normal desktop hierarchy is compact:

| Content | Classes |
| --- | --- |
| Main label or row title | `text-sm font-medium` |
| Supporting text | `text-xs text-muted-foreground` |
| Body or empty-state copy | `text-sm text-muted-foreground` |
| Section eyebrow or count | `text-xs font-medium uppercase tracking-wider text-muted-foreground` |
| Dialog title | use the existing shadcn `SheetTitle`, `DialogTitle`, or `CardTitle` |
| Technical output | `font-mono text-xs` or `text-[11px]` for dense logs |

Use sentence case for titles, buttons, labels, and messages. Uppercase is reserved for small section eyebrows and the compact application wordmark.

Truncate variable-length host names, paths, and labels with `min-w-0` on the parent and `truncate` on the text element.

## 5. Spacing and sizing

The application uses a 4 px spacing grid through Tailwind.

- compact inline gap: `gap-1` or `gap-1.5`
- normal control or row gap: `gap-2` or `gap-2.5`
- grouped content gap: `gap-3` or `gap-4`
- panel padding: `p-4`
- compact toolbar padding: `px-4 py-3`
- compact rows: `px-3 py-1.5` to `px-3 py-2.5`
- sidebar width: `w-56`
- top tab bar height: `h-11`
- normal icon: `size-4`
- small icon: `size-3.5`
- empty-state icon container: `size-12`

Use `flex-1`, `min-w-0`, and `min-h-0` deliberately in nested layouts so panes scroll instead of overflowing the window.

## 6. Shape, borders, and elevation

Use the theme radius scale rather than arbitrary values.

- controls and navigation items: `rounded-md`
- rows and grouped lists: `rounded-lg`
- prominent empty-state icon containers: `rounded-xl`
- status indicators: `rounded-full`

Borders are the primary way to separate surfaces. Prefer `border`, `border-b`, or `border-t` over shadows. A collection of related rows should usually be one `rounded-lg border bg-card` container with dividers between rows.

Shadows belong to shadcn primitives where already defined. Do not add large decorative shadows to feature components.

## 7. Layout patterns

### Application shell

The main window is a full-height flex column with a fixed tab bar and a flexible content region. Content views are mounted within the same region so terminal and SFTP state can survive tab changes.

### Sidebar

The sidebar is a fixed-width, bordered surface. Navigation uses compact full-width buttons. The active item uses `bg-sidebar-accent`, while inactive items use muted text and a subtle hover background.

### Toolbars

Panel toolbars use `flex items-center gap-3 border-b px-4 py-3`. Put search or primary context on the left and the primary action on the right. Do not turn every toolbar into a large page header.

### Lists

Rows should contain:

1. a small icon container;
2. a flexible text block with a primary and secondary line;
3. contextual actions revealed on hover when discoverability is not critical;
4. an optional trailing status or chevron.

Keep list rows flat and compact. Use a shared bordered container for grouped data instead of making every row a floating card.

### Empty states

Center empty states within the available panel. Use one muted icon container, one short title, one supporting sentence, and at most one or two actions. Empty states should explain the next step without decorative illustration.

### Forms and sheets

Connection and key forms open in right-side sheets. Use:

- `SheetHeader` with `border-b`
- a scrollable form with `flex flex-1 flex-col gap-4 overflow-y-auto p-4`
- field groups with `flex flex-col gap-2`
- a full-width primary submit button at the bottom
- inline validation using `text-sm text-destructive`

Use the shared `Input`, `Label`, `Button`, `Tabs`, `Sheet`, and `Dialog` primitives rather than rebuilding their states.

## 8. Buttons and icon actions

Use the shared `Button` component for labeled actions.

- default: the single primary action in a region
- `outline`: secondary or cancel actions
- `ghost`: low-emphasis actions
- `destructive`: confirmed destructive actions
- `size="sm"`: compact actions inside panels and status views
- `size="icon"`: square icon-only controls

For very small row actions, a plain button may use `rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground`. Destructive icon actions change to `hover:text-destructive`.

Every icon-only button must have an accessible label through visible text, `title`, or `aria-label`.

## 9. Interaction states

Every interactive control needs visible hover, keyboard focus, disabled, and busy behavior.

- reuse the focus ring behavior built into shadcn primitives
- disable controls while their action is running
- use `Loader2` with `animate-spin` for indeterminate work
- keep errors close to the control or region that caused them
- use confirmation before deleting stored hosts or keys
- reveal secondary row actions with `group-hover` only when the row itself remains understandable without them

Use `cursor-pointer` only for elements that perform an action. File rows that primarily display data use `cursor-default`.

## 10. Motion

Motion communicates progress; it is not decoration. Existing motion patterns are:

- `animate-spin` for ongoing indeterminate work
- `animate-rise-in` for newly loaded rows and log entries
- `animate-step-pop` for completed steps
- `animate-connector` for progress through a sequence
- `animate-sonar` for an active connection attempt
- `progress-stripes` for an in-progress file transfer
- `shimmer-text` for the currently active connection step

Do not apply these animations to static navigation, ordinary cards, or page chrome. New keyframes belong in the custom animations section at the bottom of `index.css` and should respect `prefers-reduced-motion` when the motion is nonessential.

## 11. Writing style

Interface copy is direct and calm.

- buttons use verbs: “New Host”, “Connect”, “Retry”, “Import Key”
- empty-state titles state the condition: “No hosts yet”
- supporting copy explains the next step in one sentence
- errors say what failed and, when useful, how to recover
- use an ellipsis (`…`) for an action actively in progress

Do not use hype, jokes, or brand language in operational screens.

## 12. Accessibility

- use semantic buttons and form labels
- preserve shadcn focus rings
- never communicate status by color alone; pair color with an icon, label, or shape
- maintain readable contrast through semantic theme tokens
- add `sr-only` text where an icon has no visible label
- keep target sizes at least `size-8` for toolbar controls when space permits
- do not remove outlines unless an equivalent focus-visible treatment exists

## 13. Implementation checklist

Before merging a UI change, verify that it:

- uses an existing shadcn primitive where one fits;
- uses semantic color tokens instead of hard-coded decorative colors;
- matches the compact spacing and type scale;
- works at narrow desktop window sizes without clipping;
- keeps long host names, paths, and messages from breaking layout;
- includes empty, loading, error, disabled, and connected states as applicable;
- uses Lucide icons at the established sizes;
- adds no stylesheet, `<style>` block, or JSX CSS import;
- limits animation to meaningful state changes;
- passes `npm run build`.

## 14. Reference examples

Compact toolbar:

```jsx
<div className="flex items-center gap-3 border-b px-4 py-3">
  <div className="relative flex-1">
    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    <Input className="pl-8" placeholder="Find a host…" />
  </div>
  <Button className="shrink-0">
    <Plus className="size-4" /> New Host
  </Button>
</div>
```

Grouped list row:

```jsx
<div className="overflow-hidden rounded-lg border bg-card">
  <button className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-muted/50">
    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <Server className="size-4" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium">Demo server</span>
      <span className="block truncate text-xs text-muted-foreground">demo@example.com</span>
    </span>
  </button>
</div>
```

Inline error:

```jsx
<p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
  Connection failed. Check the host and try again.
</p>
```
