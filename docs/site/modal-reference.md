# Landing page reference measurements

The Forge landing page (`/`) borrows the layout system, type metrics, spacing and
motion of a public infrastructure landing page studied on 2026-10-29. This file records
what was measured, so every value on the landing page (`/`) can be traced to a number. No logos,
illustrations, images, icons, fonts or copy were taken from it; only measurements.

Method: Playwright (headless Chromium 1234 shell, playwright-core 1.55) at 1440x900,
1280x900, 1600x900, 1024x900, 768x900 and 390x844. Values come from
`getComputedStyle`, `getBoundingClientRect`, `document.getAnimations()`, the page's
`@keyframes` rules and a wrapped `IntersectionObserver` constructor that logged every
observer option. Screenshots, frame sequences and the two Playwright videos are in the
session scratchpad under `site/modal`, `site/modal-motion`.

All y values are document coordinates at 1440 wide.

## Layout grid

| Token | Value |
| --- | --- |
| Container max width | 1546px, centered (content 1418px at 1600) |
| Container side padding | 64px at >= 1024, 32px at 768, 24px at 390 |
| Content width at 1440 | 1312px |
| Columns | 24 at >= 1024 (35.5px each at 1440), gap 20px; 3 columns below |
| Header | sticky, 64px + 1px bottom hairline; 36px announcement bar above it on load |
| Header surface | page color at 90% alpha, `backdrop-filter: blur(20px)`, hairline 5% |
| Section vertical padding | 144px top and bottom (desktop); 120px for the light bands; 56px hero top |
| Hero | pt 56 below header; h1 top 157, sub top 229 (24 gap), CTAs top 309 (32 gap), CTA gap 8px |
| Hero logo strip | y 995, 44px tall, label column 160px + 1px vertical divider, marquee to the right |
| Eyebrow -> h2 | eyebrow (20px tall) then 16px, h2 |
| h2 -> content | 80px |
| Product grid | sticky side nav cols 1-3 (`top: 96px`), text cols 4-11 (424px), visual cols 13-24 (646 x 498) |
| Product sub-blocks | 499-518px tall, 200px apart; h3 +0, lead +32, features +120, button +447 |
| Feature pairs | 2 columns 202px wide (cols 4-7, 8-11), rows 124px apart |
| Platform columns | 3 columns, 1px left hairline, number top-left, drawing ~300px, h3 + p below |
| Capacity columns | 4 columns, 1px left hairline, 16px icon + h3, p |
| Enterprise | h2 left (cols 1-8), paragraph right (cols 17-24), 3 cards 424px wide, 80px below |
| Customers card | 1312 x 498, radius 7, 1px border 3% black on the light band |
| Logo tiles | 4 x 2, 313 x 144, gap 20, radius 7 |
| Blog cards | 3 x 424px, 16:9 image, title, two-line excerpt, tag chip |
| Breakpoints used | <= 600 mobile, ~768 tablet (pad 32, hamburger), >= 1024 desktop |

## Section order (1440)

| # | Section | y | height | background |
| --- | --- | --- | --- | --- |
| 0 | Announcement bar | 0 | 36 | accent |
| 1 | Header | 36 | 65 | page, sticky |
| 2 | Hero + logo strip | 101 | 1039 | `#040804` with full-bleed canvas art (1440 x 1080) |
| 3 | Product (sticky side nav, 4 sub-blocks) | 1140 | 3063 | page |
| 4 | Platform (3 numbered columns) | 4203 | 1163 | `#131412`, top hairline 5% |
| 5 | Capacity (large visual + 4 columns) | 5366 | 1127 | `#10120f` |
| 6 | Enterprise (3 product cards) | 6493 | 1072 | page |
| 7 | Customers (quote carousel + logo tiles) | 7565 | 1142 | light `#e3e5e1` |
| 8 | Blog (3 cards) | 8707 | 819 | light `#dadeD7` |
| 9 | Final CTA | 9670 | 640 | `#040804` |
| 10 | Footer | 10422 | 615 | `#040804` |

## Type scale

Display face: a licensed grotesk ("ABC Diatype"). Body fallback: Inter Variable. Mono:
DM Mono / Fira Mono. **Substitution on Forge:** Geist (open source, SIL OFL, via
`next/font/google`) for display and text; IBM Plex Mono (already self-hosted by Forge) for code.

| Role | Size / line-height | Weight | Letter-spacing | Color (dark source) |
| --- | --- | --- | --- | --- |
| h1 (desktop) | 45 / 48 | 500 | -0.45px (-1%) | `#e3e5e1`, accent span `#7fee64` |
| h1 (<= 768) | 37 / 40 | 500 | -0.37px | same |
| h2 (desktop) | 38 / 44 | 500 | -0.38px | `#e3e5e1` |
| h2 (<= 768) | 31 / 36 | 500 | -0.31px | same |
| CTA h2 | 45 / 48 | 500 | -0.45px | same |
| Hero sub / product lead | 18 / 24 | 400 | normal | `#a8aba6` |
| h3 (product, platform) | 18 / 24 | 400 | normal | `#e3e5e1` |
| h3 (capacity, enterprise) | 16 / 24 | 400 | normal | `#e3e5e1` |
| h4 feature | 15 / 22 | 400 | 0.15px | `#e3e5e1` |
| Feature body | 15 / 22 | 400 | 0.15px | `#a8aba6` |
| Column body | 16 / 24 | 400 | normal | `#a8aba6` |
| Eyebrow | 13 / 20 | 500 | 0.39px (3%) | accent, 20px icon tile left, 8px gap |
| Quote | 28 / 36 | 400 | normal | `#10120f` on light |
| Nav link | 15 / 22 | 400 | 0.15px | `#a8aba6`, hover `#ffffff` |
| Footer heading / link | 15 / 22 | 400 | normal | `#e3e5e1` / `#a8aba6` |
| Mobile menu row | 19px, 60px tall rows, 1px hairlines | 400 | | |

## Components

| Component | Measured |
| --- | --- |
| Primary pill button | 36px tall, padding 6px 16px, radius 48px, 16px/24 weight 500, bg `#e3e5e1`, text `#10120f`, inset 1px 5% ring; hover bg `#ffffff` |
| Secondary pill button | same box, weight 400, bg 5% white, hover 10% white |
| Header buttons | 32px tall, padding 4px 12px |
| Nav link | 32px tall, padding 0 12px, radius 48px; hover bg 5% white + white text |
| Side nav item | 34px tall, padding 4px 12px 4px 10px, radius 48px, 16px text; active bg 5% white, inactive text `#a8aba6` |
| Panel / card | radius 7px, 1px border 3% (white on dark, black on light), bg one step off the page |
| Code card | radius 10px, 1px border 5%, bg one step lighter than the panel |
| Focus | `outline: 2px solid`, offset 2px, only on `:focus-visible` |
| Hairlines | 5-7% alpha of the foreground |

## Motion spec

Easing tokens: `out-quart = cubic-bezier(0.165, 0.84, 0.44, 1)`,
`standard = cubic-bezier(0.4, 0, 0.2, 1)`. `html { scroll-behavior: auto }`; in-page
jumps are JavaScript-smoothed (measured 1250 -> 2765 in ~550ms, decelerating).

| element | trigger | property | from | to | duration | easing | delay/stagger |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Buttons, nav links, footer links | hover | color, background-color, border-color | rest | hover | 150ms | standard | 0 |
| Header bar | crossing a light/dark band | background-color, border-color | dark 90% | light 90% | 250ms | standard | 0 |
| Logo (header) | hover | color | | | 250ms | ease | 0 |
| Nav dropdown panel | hover / focus on "Product" | height | 0 | 478px | 300ms | out-quart | 0 |
| Nav dropdown panel | same | background-color, border-color | | | 250ms | standard | 0 |
| Dropdown links | hover | opacity | 1 | dims siblings | 200ms | ease | 0 |
| Side nav item | section enters band | color, background-color | muted / transparent | fg / 5% | 200ms | out-quart | IO `rootMargin: -20% 0px -60% 0px` |
| Side nav item | click | window scroll | current | section top - 96px | ~550ms | decelerating | 0 |
| Product visual swap | sub-block becomes active | opacity, filter, translate | 0, blur(3px), 16px | 1, none, 0 | 250ms (500ms on the large figure) | out-quart | 0 |
| Product canvases | IO `rootMargin: 10% 0px` | play / pause | paused | running | n/a | n/a | starts when within 10% of viewport |
| Hero canvas | load | opacity | 0 | 1 | 200ms | `cubic-bezier(0,0,0.2,1)` | 0 |
| Logo marquee | always (paused off screen) | translate | 0 | -100% | 120s | linear | infinite, `motion-reduce: none`, 104px fade mask both edges |
| Quote carousel | prev/next click | opacity, translate, filter | 0, 16px, blur(3px) | 1, 0, 0 | 250ms | out-quart | outgoing goes to -16px |
| Blog card | hover on grid | opacity of siblings | 1 | 0.61 | 200ms | ease | 0 |
| Accordion (mobile menu groups) | click | grid-template-rows | 0fr | 1fr | 500ms | out-quart | 0 |
| Chevron | menu open | transform, color | 0 | 180deg | 500ms | out-quart | 0 |
| Mobile menu overlay | menu button | clip-path | `inset(0 0 100%)` | `inset(0)` | 400ms | out-quart | 0 |
| Mobile scrim | menu button | opacity | 0 | 1 | 300ms | out-quart | 0 |
| Dialogs | open | opacity, translate, scale | 0, 12px, 0.98 | 1, 0, 1 | keyframe `v2-dialog-in` | | |
| Glow spans, status dot | always | opacity | 0.3 | 0.85 | 3.2s | ease-in-out | infinite (**not reproduced: pulsing is banned on Forge**) |
| Terminal cursor | always | opacity | 1 | 0 | 1s | steps(1) | infinite (**not reproduced: blinking is banned**) |

No headline, paragraph or section fades in on scroll: before scrolling, every heading and
paragraph below the fold already had `opacity: 1`, no transform and no filter. Only the
quote figures (hidden carousel slides) and lazy images started at `opacity: 0`.

IntersectionObserver options seen: `rootMargin: 200% 0px 0px 0px`, `10% 0px` (x10),
`-20% 0px -60% 0px` (side nav), `0px 0px -25% 0px` (x3), `-64px 0px -834px 0px`
(header theme probe at the header's bottom edge), `150% 0% 150% 0%`, `100% 0% 100% 0%`
(canvas preloading), `threshold: 0`.

No `<video>` elements: every moving visual is a `<canvas>` that runs while in view.

Reduced motion rules present: marquee off, logo sweep off, particle transitions 1ms,
toast transitions off.

## Light-mode mapping used on Forge

| Source (dark) | Forge (light) | Contrast on its background |
| --- | --- | --- |
| page `#040804` | `#ffffff` | |
| fg `#e3e5e1` | `#111111` | 18.9:1 |
| muted `#a8aba6` | `#5c5c5c` | 6.7:1 |
| dim `#6c6e6a` | `#6b6b6b` | 5.3:1 |
| accent `#7fee64` (h1 span, eyebrow) | `#111111` with `#5c5c5c` for the non-accent words | 18.9:1 / 6.7:1 |
| panel `#10120f` | `#f6f6f6` | |
| band `#131412` | `#f7f7f7` | muted text 6.2:1 |
| hairline 5% white | 8% black (`#ebebeb`) | |
| primary button `#e3e5e1` / `#10120f` | `#111111` / `#ffffff`, hover `#000000` | 18.9:1 |
| secondary button 5% white | 5% black, hover 9% black | 15.6:1 |
| light band `#e3e5e1` (inverted band) | dark band `#111111`, text `#f2f2f2`, muted `#a3a3a3` | 16.5:1 / 7.4:1 |

## Where the landing page deliberately differs

| Reference element | On Forge | Why |
| --- | --- | --- |
| Hero canvas art (particle glyphs) | React Bits DotGrid behind a real Agent chat capture | No illustrations copied; the product shot is Forge's own UI |
| Logo marquee of customer logos | LogoLoop of the parts Forge is built with, set as text | Forge has no customers to show; text avoids third-party logos |
| Customer quotes | Verbatim Agent Relay messages from campaign forge-e84925eb | Real words from the recorded run |
| 4 x 2 logo tiles | 3 x 2 tiles of the six durable actors | Six real actors |
| Blog cards | Three lab views, linking to the lab at `/` | The repository is private, so docs have no public URL |
| Glow pulse, blinking cursor | Not reproduced | Forge bans pulsing and blinking indicators |
| Accent green h1 span | Two-tone neutral: muted words, then `#111` accent words | Forge's accent is neutral black |
| 36px mobile buttons | 44px tall on mobile | Tap-target minimum |
| One light band on a dark page | One dark band (`#111`) on a light page; header switches theme over it | Same contrast inversion, mirrored |
| Section added | "One question": GSM8K test-885 before and after, verbatim | Requested: a plain example high on the page |

## Hero, frame by frame (1440x900, no input, 20 s)

Recorded with Playwright `recordVideo` plus a screenshot and a state read every 500 ms
(`site/hero-modal/idle-*.png`, `hero-log.txt`, video in `site/hero-modal/video`).
Timestamps are from navigation start.

| t (s) | What is on screen | Notes |
| --- | --- | --- |
| 0.74 | Headline, sub and buttons already at full opacity; art area empty | Text never animates: no type-on, no fade, `opacity: 1` throughout |
| 1.25 | Particles burst out from a center point into a six-point star | One-time intro; `opacity` transition on the canvas (200ms, `cubic-bezier(0,0,0.2,1)`) and an SVG glyph flash (`v2-glyph-flash`, 93 `<use>` nodes) |
| 2.2 | Star resolves into an isometric cube; brighter on arrival, settles over ~1 s | First held state |
| 2.2 to 6.7 | Cube held; particles shimmer in place | |
| 7.2 | Cube re-forms as three stacked layers (morph completes inside one 500 ms sample) | |
| 7.2 to 11.8 | Layers held | |
| 12.3 | Layers break into seven separate hexagonal blocks | |
| 12.3 to 16.8 | Blocks held | |
| 17.3 | Blocks rebuild as a staircase | |
| 17.3 to ~22.3 | Staircase held, then the loop returns to the cube | Loop: 4 states x ~5.05 s = ~20.2 s, plus the 1.5 s intro once |

Cursor over the art: particles near the pointer brighten locally; the shape does not move
or tilt. Buttons: color/background 150ms `cubic-bezier(0.4,0,0.2,1)` (primary `#e3e5e1` to
`#ffffff`; secondary 5% to 10% white). All hero motion is canvas-driven, so
`document.getAnimations()` is empty after 2.7 s; the cadence above comes from frames.

**Forge hero (`HeroCampaign`)** keeps that structure: static headline, then a product
illustration that changes state every 5.05 s through 4 states per 20.2 s loop (Launch, Find
mistakes, Train, Result), each state entering with the measured figure transition
(opacity, 16px translate, 3px blur, 500ms out-quart) and the DotGrid behind it brightening
under the pointer like the reference particles.

## Client libraries visible from outside

Method: fetched the homepage HTML with curl, read the SvelteKit start script
(`node_ids: [0, 30, 214]`), then followed every static and dynamic `import()` from the
entry chunks and those three route nodes (117 chunks, 2.3 MB under `/_app/immutable/`).
Searched them for package names, globals, version strings and license banners. No code
was reused.

| Library | Evidence | Role there | Used on Forge |
| --- | --- | --- | --- |
| SvelteKit + Svelte 5 | `/_app/immutable/entry/start.*.js`, `__sveltekit_*` global, `https://svelte.dev/e/async_derived_orphan` errors, `$$slots`/`$$events` props, `svelte-*` class hashes | Framework | No: Forge's page is Next.js, matching the repo |
| three.js r180 | `__THREE__=\`180\``, `THREE.Quaternion` warnings, `isWebGL2:!0` in chunk `CIVZvFSw2` (523 KB); a hero chunk marks its context `__marketingWebgl` and builds a 2D glyph atlas | Renders the hero particle art and the product-panel animations | No: that art is their illustration. Forge's hero is a DOM replay of real campaign data; its dot field is React Bits DotGrid on raw WebGL2 (no three.js needed for points) |
| lucide (Svelte icons) | icon objects like `{name:\`hard-drive\`,size:24,node:[[\`path\`…` in 5 chunks | UI icons | Forge keeps its own icon set (`components/icon.tsx`), same 24px / 1.5 stroke family |
| sonner | `[data-sonner-toast]` rules and `sonner-*` keyframes in CSS | Toasts | Not needed |
| Animation library | none found: no GSAP, ScrollTrigger, Lenis, framer-motion/motion, popmotion, Lottie, Rive, react-spring or Svelte `tweened` | Motion is CSS transitions (Tailwind utilities with custom `ease-v2-out-quart`), CSS keyframes and `requestAnimationFrame` loops (11 chunks) | Forge uses the same approach: CSS transitions with the measured curves and an rAF timeline that runs only on screen |
| Smooth scroll | none (`scroll-behavior: auto`; in-page jumps are JS-eased) | | Same: a 550 ms out-quart JS scroll for the side nav |
| Fonts | `@font-face` in `0.*.css`: ABC Diatype (licensed), Inter Variable, DM Mono ("rolled"), Fira Mono, Goga | Diatype for all UI text, DM Mono for code | Geist (OFL) for Diatype; **DM Mono (OFL) for code, the same family** |
| Syntax highlighting | no Shiki, Prism or highlight.js; code spans are colored by hand-written markup | | Forge's code card is plain, typed text |
