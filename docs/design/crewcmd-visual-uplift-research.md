# CrewCMD Visual Uplift Research

Date: 2026-05-08

## Objective

Make CrewCMD feel calm, premium, and durable enough to live in all day across every surface: chat, dashboard, task board, projects, automations, team, skills, blueprints, settings, agent profiles, admin tooling, and the Capacitor mobile app. Chat is the clearest example because it combines navigation, agent identity, long-form reading, command input, and live operational status, but the design language needs to become app-wide.

The immediate pain shown in the May 8 screenshots:

- The dark palette reads cold because teal, cyan, green, and blue carry too much of the interface.
- Agent identity colors compete with core UI hierarchy.
- The sidebar and agent menu feel visually busy because active states, uppercase labels, dots, pills, borders, icon styles, and mono text all compete at once.
- The current type system leans too heavily on Manrope plus JetBrains Mono for navigation and labels, which makes operational UI feel more game-like than executive-grade.

## Current Implementation Notes

The app already has the right technical foundation: CSS variables in `src/app/globals.css`, Tailwind utility styling, and semantic names such as `--bg-primary`, `--bg-surface`, `--text-secondary`, `--accent`, and `--border-subtle`.

The issue is less architecture than taste and token discipline:

- Dark mode is built around near-black plus teal/blue ambient color: `--accent: #63b7aa`, `--bg-ambient-left: rgba(80,210,198,.07)`, and `--bg-ambient-right: rgba(109,131,255,.06)`.
- Navigation active state uses border, filled background, colored text, left bar, and right dot at the same time.
- `AgentTreeSelector` uses each agent's raw `agent.color` directly for callsigns and the trigger button, so the menu becomes a rainbow list.
- `src/app/chat/page.tsx` also uses `agentColor` for borders, glows, labels, typing indicators, status effects, and agent mode panels.
- Many app surfaces share the same vocabulary of rounded cards, borders, uppercase labels, mono metadata, accent-tinted actions, and agent-color-driven panels. The redesign needs a shared token/component pass, not a one-off chat patch.
- The mobile shell uses separate files under `apps/mobile/web/`, so the Capacitor app needs parallel token and interaction treatment rather than inheriting every web polish automatically.
- There is no installed component primitive layer such as Radix, Base UI, React Aria, shadcn/ui, or lucide. The sidebar uses inline SVG icons.

## Design Language Direction

Use a "quiet command workspace" direction: not cyberpunk, not dashboard marketing, and not playful agent roster. It should feel closer to Linear, GitHub, Slack Enterprise, Superhuman, Notion, and modern Atlassian tooling: restrained surfaces, excellent spacing, readable type, subtle interaction states, and color only when it carries meaning.

This direction applies globally:

- Dashboard: analytical, dense, and credible; no neon grid or over-glowing metric cards.
- Task board: operational and scan-friendly; status and priority are semantic, not decorative.
- Projects: calm project-room feel with clear hierarchy and fewer bordered containers.
- Automations: confidence and safety first; schedules, approvals, and run states should be legible at a glance.
- Team and agents: identity is polished but restrained; avoid rainbow rosters and casual emoji dependence.
- Skills and blueprints: catalog-like, with strong search/filter ergonomics.
- Settings/admin: conservative enterprise controls; high trust, low ornament.
- Mobile: native-feeling, thumb-friendly, and fast, with less chrome than desktop.

Recommended principles:

1. Neutral-first dark mode
   Dark mode should be warm-neutral charcoal, not cyan-black. Use accent color sparingly for selected state, focus rings, links, and primary actions. Apple, Atlassian, GitHub Primer, Fluent, Carbon, Spectrum, and Radix all converge on mode-aware tokens and restrained semantic color.

2. One active-state signal
   A selected navigation item should use one or two cues, not five. Prefer a low-contrast selected surface plus a small indicator or stronger text. Remove the trailing dot from normal selected nav.

3. Agent identity as metadata, not branding
   Keep agent colors as small chips, avatar rings, or status markers. Do not color the entire callsign, trigger, message chrome, glow, and menu row. The app brand and interaction hierarchy should remain stable regardless of selected agent.

4. Typography should disappear
   Replace broad uppercase and tracking-heavy labels with title case navigation, normal letter spacing, and limited mono usage. Reserve monospace for code, IDs, logs, model names, command output, and version strings.

5. Dense but breathable
   This is an all-day professional tool. The layout should support scanning without feeling cramped. Keep the sidebar stable, use 8px spacing rhythm, and tune row heights rather than adding decorative cards.

## Palette Proposal

This is a direction, not final production tokens:

```css
[data-theme="dark"] {
  --bg-primary: #0d0d0f;
  --bg-secondary: #121214;
  --bg-tertiary: #18181b;
  --bg-elevated: rgba(20, 20, 23, 0.96);
  --bg-surface: rgba(28, 28, 32, 0.72);
  --bg-surface-strong: rgba(32, 32, 36, 0.96);
  --bg-surface-hover: rgba(39, 39, 44, 0.86);

  --border-subtle: rgba(245, 245, 245, 0.07);
  --border-medium: rgba(245, 245, 245, 0.12);
  --border-strong: rgba(245, 245, 245, 0.18);

  --text-primary: #f2f0ec;
  --text-secondary: #b9b4ad;
  --text-tertiary: #817c75;

  --accent: #d7b56d;
  --accent-hover: #e2c37f;
  --accent-soft: rgba(215, 181, 109, 0.10);
  --accent-medium: rgba(215, 181, 109, 0.18);
  --accent-strong: rgba(215, 181, 109, 0.28);

  --success: #7fb685;
  --warning: #d7b56d;
  --danger: #d68177;
  --info: #9aa8c7;
}
```

Rationale:

- Warm charcoal and stone text reduce the cold blue/green feel.
- Muted amber as accent feels premium and operational without becoming beige-dominant.
- Status colors are desaturated. They can still signal state without looking like neon labels.
- Ambient radial teal/blue glows should be removed from chat surfaces or reduced to nearly invisible neutral elevation.

## Typography Proposal

Preferred options:

- Conservative: system UI stack for app chrome, JetBrains Mono only for code/logs.
- Premium web: Inter Variable or Geist Sans for app chrome, JetBrains Mono only for code/logs.
- Keep Manrope only if its weight/spacing is tuned down and uppercase usage is removed.

Concrete changes:

- `--font-sans`: `Inter`, `Geist`, or `system-ui`; avoid stylized display feeling in dense app chrome.
- Nav items: 13px, 500 weight, title case, `letter-spacing: 0`.
- Section labels: 11px, 600 weight, small caps only if very subtle; no wide tracking.
- Agent callsigns: use normal sans for list rows; mono only in compact technical badges.

## Sidebar Redesign Notes

The sidebar should become a calm navigation rail:

- Remove all-uppercase nav labels.
- Remove selected trailing dot.
- Replace selected state with `bg-surface-hover`, stronger text, and one 2px left indicator.
- Reduce border prominence around selected items.
- Move workspace selector into a simpler button with less border contrast.
- Make the user footer flatter; current card-within-sidebar treatment feels bulky.
- Replace inline SVGs with `lucide-react` for consistent stroke, sizing, and icon language.
- Keep collapsed sidebar, but make it feel like a first-class rail rather than a compressed full sidebar.

## Agent Selector Redesign Notes

The current menu is the most visually problematic surface.

Recommended structure:

- Trigger: avatar/emoji + callsign + chevron, neutral text. Use agent color only as a 2px side strip or small ring.
- Dropdown: command-menu style with search, grouped rows, and keyboard navigation.
- Agent row: avatar, callsign, role, status. Color appears only in avatar ring/chip.
- Status: use semantic status text or small muted dot, not bright green for every online agent.
- Sessions tab: keep, but make it a segmented control with neutral selected state.
- Avoid emoji as the main visual identity long term. They make the roster feel casual. Use generated or abstract initials/avatars later if needed.

## Page-Level Redesign Notes

App shell:

- Remove or dramatically reduce the global grid background. It currently makes every page feel like a technical demo. Use a plain neutral canvas, then let focused panels carry structure.
- Establish clear elevation rules: base canvas, sidebar/topbar, page surface, popover/modal. Do not style every section as a floating card.
- Standardize page gutters and max widths by page type: chat immersive, dashboards dense, forms constrained.

Dashboard:

- Use muted metric modules and compact charts. Avoid oversized card borders and saturated accents.
- Use one chart accent family plus semantic red/amber/green only when data requires it.
- Prioritize repeated daily scanning over presentation polish.

Task board, projects, and automations:

- Make tables, kanban lanes, and lists feel like productivity tooling: consistent row heights, soft separators, clear hover/focus, restrained pills.
- Use status and priority tokens with explicit roles. Do not encode everything through arbitrary colors.
- Keep action buttons visually quiet until destructive, primary, or blocked states need attention.

Team and agents:

- Replace rainbow callsign styling with neutral names, subtle avatar identity, and semantic state indicators.
- Use agent color only for tiny identity affordances: 2px strip, ring, chip, or mini swatch.
- Profile pages should feel like professional staff dossiers, not character cards.

Skills and blueprints:

- Catalog cards should be functional and compact: title, provider/category, sync status, primary action, last updated. Avoid decorative heavy cards.
- Filters and search should look reusable across catalog-like pages.

Settings and admin:

- Move toward enterprise settings patterns: left subnav, clear sections, calm form controls, explicit danger zones.
- Remove playful or heavily branded treatments from critical controls.

## Mobile and Capacitor Notes

The Capacitor app should not be a squeezed desktop UI. It needs the same tokens and taste, but a mobile interaction model:

- Respect safe areas and bottom reach. Primary chat input, voice controls, and session/agent switching need thumb-friendly placement.
- Use a bottom navigation or compact top app bar for core destinations instead of exposing the full desktop sidebar pattern.
- Keep touch targets at least 44px high for primary controls.
- Avoid dense popover menus on mobile. Agent/session switching should use a full-height sheet or command sheet with search.
- Reduce background texture even more than desktop. On small screens, grids and ambient glows consume attention and battery without improving orientation.
- Use native-feeling loading, offline, reconnecting, and push-notification states. The mobile app will often be used in interrupted sessions.
- Keep chat composer ergonomics central: stable height, no jumpy keyboard overlap, clear attachment/voice/send affordances, and readable long messages.
- Mirror design tokens between `src/app/globals.css` and `apps/mobile/web/styles.css` or create a generated shared token source so web and Capacitor do not drift.

## Reusable Component Strategy

Do not import a fully styled enterprise component library. CrewCMD already has a distinct product surface and Tailwind setup.

Recommended path:

1. Add a small internal UI primitive layer in `src/components/ui/`.
   Start with `Button`, `IconButton`, `NavItem`, `Menu`, `Popover`, `Tabs`, `Badge`, `Avatar`, `Tooltip`, `ScrollArea`, and `CommandList`.

2. Use `lucide-react` for icons.
   This gives immediate consistency with low dependency risk.

3. For accessible popovers/menus/dialogs, choose either Base UI or Radix primitives.
   Base UI is attractive for long-term headless primitives; Radix remains proven and pairs well with Tailwind. The design should remain CrewCMD-owned either way.

4. Treat shadcn/ui as a reference/accelerator, not a design language.
   It is useful because it copies component source into the repo and uses Tailwind/Radix patterns, but its default aesthetic is too recognizable unless heavily retuned.

5. Avoid Material UI, Fluent React, Carbon React, and React Spectrum as app-wide component libraries.
   They are excellent systems, but too opinionated for CrewCMD's bespoke chat/workspace identity. Use their token and accessibility thinking, not their visual skin.

## Research References

- Apple Human Interface Guidelines: dark mode emphasizes adaptive semantic colors and foreground contrast rather than simple inversion. https://developer.apple.com/design/human-interface-guidelines/dark-mode
- Atlassian Design System: color tokens support light/dark themes, neutral ramps, interaction-state tokens, and WCAG contrast requirements. https://atlassian.design/foundations/color
- Atlassian Design Tokens: tokens make dark mode, responsive design, and customization possible through system-level changes. https://atlassian.design/foundations/tokens/design-tokens/
- Atlassian Spacing: 8px base unit supports consistency and future density options. https://atlassian.design/foundations/spacing
- GitHub Primer color usage: base colors should feed functional/component tokens, not be used directly in code; semantic colors have explicit roles. https://primer-docs-preview.github.com/product/getting-started/foundations/color-usage/
- GitHub Primer theming: Primer supports multiple color schemes including light, dark, and dark dimmed. https://primer.style/product/getting-started/react/theming/
- Microsoft Fluent 2 color: neutral, shared, and brand palettes have distinct purposes; shared colors should be used sparingly for accents/status. https://fluent2.microsoft.design/color
- IBM Carbon color: component tokens reference theme values so themes can change without editing every component. https://v10.carbondesignsystem.com/guidelines/color/overview/
- Adobe Spectrum Web Components: theme attributes manage system, color, and scale through design tokens. https://opensource.adobe.com/spectrum-web-components/tools/styles/
- Radix Themes dark mode: light/dark appearance can be controlled at the theme layer. https://www.radix-ui.com/themes/docs/theme/dark-mode
- Radix Colors usage: 12-step color scales provide dark/light CSS variables for backgrounds, borders, and text states. https://www.radix-ui.com/colors/docs/overview/usage
- Base UI: headless accessible React primitives that do not impose styling and can be used with Tailwind. https://base-ui.com/react/overview/about
- shadcn/ui: accessible Tailwind/Radix component source that can be copied into the repo and owned. https://ui.shadcn.com/docs/components

## First Reviewable Implementation Slice

Keep the first implementation PR to three files or fewer and make it app-wide at the token/shell level:

1. `src/app/globals.css`
   Retune dark tokens to warm charcoal, remove teal/blue ambient dominance, desaturate semantic status colors, reduce global grid/ambient treatment.

2. `src/components/sidebar.tsx`
   Simplify nav active state, remove uppercase labels, remove trailing dot, reduce footer/card emphasis.

3. `src/components/app-shell.tsx` or `src/components/chat/agent-tree-selector.tsx`
   If the priority is every page first, update app shell and global background behavior. If the priority is the most visible pain first, neutralize the agent selector. Do not do both in the same first PR if the diff gets noisy.

Verification:

- `pnpm lint:check`
- `pnpm typecheck`
- `git diff --check`
- Manual visual QA in dark and light modes at desktop and mobile widths.
- Capacitor smoke path for the mobile shell after any `apps/mobile/web/` change.

## Follow-On PRs

1. Add `lucide-react` and replace sidebar/menu inline SVGs.
2. Introduce `src/components/ui/` primitives for button, icon button, tabs, menu, badge, tooltip, and scroll area.
3. Retune shared page/card/table/form styles across dashboard, task board, projects, automations, settings, and catalog pages.
4. Retune chat message surfaces and composer for all-day readability.
5. Introduce a command-menu agent/session switcher with search and keyboard navigation.
6. Bring `apps/mobile/web/styles.css` into the same token language and redesign the mobile navigation/composer.
7. Build a small visual regression checklist with Playwright screenshots for chat, sidebar, dashboard, agent profile, and mobile widths.

## Risk

Risk level: low for this research artifact; medium for implementation because theme changes affect every screen. The safest route is to retune dark mode and navigation first, then migrate reusable components in narrow slices.
