# AEM semantic click-tracking demo

A small, **dependency-free** semantic click and impression tracker for AEM Edge
Delivery Services (EDS). It turns clicks, impressions, and component state changes
into stable, accessible, vendor-neutral events, and shows how to deliver them to
Adobe without coupling the reusable core to any analytics vendor or DOM metadata
contract.

The design has one load-bearing idea: **a generic producer plus a project-owned
adapter.** `scripts/tracking.js` only *produces* semantic events; `scripts/scripts.js`
*maps and delivers* them. Swap the adapter to target a different destination and the
core never changes.

## How it's wired

Four layers, each with one job:

| Layer | File(s) | Responsibility |
|---|---|---|
| **Producer** | `scripts/tracking.js` | Generic, dependency-free core (≤4 KB min / ≤2 KB gzip). Five functions; builds one semantic envelope for clicks and impressions alike; emits it on the `eds:track` DOM event **and** an `onTrack` callback. Knows nothing about Adobe. |
| **Adapter + lifecycle** | `scripts/scripts.js` | The AEM boot sequence and the project's delivery choice: boots martech, maps each envelope to Adobe XDM, samples page attributes, wires consent. This is the file a customer edits. |
| **Delivery** | `plugins/martech/` | Vendored Adobe Web SDK (Alloy) integration, pinned via `git subtree`. The core has no dependency on it. |
| **Examples** | `blocks/*` | Copyable blocks: the hero annotates a CTA (`trackAs`) and marks itself an impression (`viewAs`); accordion and dialog emit lifecycle events (`track`). |

At runtime, every event flows one way — producer out to the two hooks, and only the
adapter knows about Adobe:

```
 blocks/*              scripts/tracking.js          scripts/scripts.js          plugins/martech
 (examples)            (generic producer)           (project adapter)           (vendored Adobe)
 ──────────            ───────────────────          ─────────────────           ───────────────
 trackAs(el) ─┐
 track(…)  ───┴─►  build semantic envelope ─┬─► onTrack ─► sendToAdobe ─► sendAnalyticsEvent ─► Alloy ─► Edge
                   label·type·context·page   │           (envelope → XDM)
                                             └─► eds:track DOM event ─► any listener (inspect / other destinations)
```

Both hooks receive **every** event — use exactly one of them for analytics delivery,
or you will report each interaction twice.

> **⚠️ The `eds:track` DOM event is not consent-gated.** The producer dispatches
> `eds:track` (and calls `onTrack`) **unconditionally**, for every tracked
> interaction, **regardless of consent state**. The producer does not gate this
> DOM path — enforcing consent before anything is *delivered* is the consumer's /
> adapter's responsibility. In this demo the Adobe adapter gates *collection* via
> `updateUserConsent` (Alloy holds events until `consent.update` grants
> `collect`), but any listener you attach to `eds:track` receives events
> immediately, so a listener that forwards data must apply its own consent check.
> Auto-capture widens this surface: the tracker now emits a `click` for
> every interactive click — not only `trackAs`-annotated controls — so it
> reaches the same unconditional `eds:track` path, and that consumer-side
> consent check must cover them all.

Wiring happens once, during eager load (`loadEager` in `scripts/scripts.js`):

- `initMartech({ … clickCollectionEnabled: false, defaultConsent: 'pending' }, { personalization: false, dataLayer: false })`
  boots Alloy with **automatic click collection and the Adobe Client Data Layer both
  off** — so the only events Adobe sees are the ones this tracker produces.
- `configureTracking({ onTrack: sendToAdobe })` installs a single delegated click
  listener and routes every event to the adapter.
- `setPageAttributes(getPageAttributes())` samples language, canonical (or query-free)
  URL, and viewport once.
- Adobe collection stays pending until the project's CMP dispatches `consent.update`
  (`applyConsent` → `updateUserConsent`); replace the demo `scripts/consent-check.js`
  with the customer's production CMP.

## The five-function API

`scripts/tracking.js` exports five functions and nothing else. Blocks import the
producers (`trackAs`, `track`, `viewAs`); the project wires the two setup calls
(`configureTracking`, `setPageAttributes`) once.

### Automatic click tracking

Clicks on **interactive elements** are tracked automatically — you do **not** need
to `trackAs` every link and button. The auto-captured set is `a[href]`, `button`,
`input[type=button|submit|reset]`, `summary`, and any element with an interactive
ARIA `role` (`button` / `link` / `tab` / `checkbox` / `radio` / `switch` /
`option` / `menuitem`). Each auto click emits the same envelope, fully derived
from the DOM.

- **Opt out** a control or a whole subtree with the `data-track="off"` attribute
  (checked on the target and its ancestors) — nothing is emitted for clicks inside
  it. This is the tracker's only markup contract.
- **`trackAs` still wins.** An explicit annotation anywhere in the click path
  overrides auto-derivation.
- **Auto clicks have no stable key.** Without an annotation there is no authored
  `id`, so the reference Adobe adapter keys the interaction on the (mutable)
  label. Annotate the controls you care about with `trackAs(el, { id })` to report
  them under a stable key.

### `trackAs(element, annotation)` — annotate a clickable element

Annotate an element to override the auto-derived envelope — most importantly to
pin a stable `id` — or to track a non-interactive element that auto-capture skips.
The annotation is stored privately (in a `WeakMap`, never written to the DOM) and
resolved into the full envelope at click time. Give it an `id`; everything else is
optional and only *overrides* what the tracker would otherwise derive from the DOM.

| Field | Meaning |
|---|---|
| `id` (required) | Your stable identifier for the control, e.g. `'hero\|cta'`. |
| `label` | Override the derived accessible name / visible text. |
| `type` | Override the derived type (`link` / `button` / interactive ARIA role). |
| `href` | Override the derived link URL; `null` omits it. |
| `context` | An object overriding any of `block`, `blockSlug`, `blockStyles`, `section`, `sectionStyles` (you may also pass those keys flat on the annotation). Unset keys are derived. |

```js
import { trackAs } from '../../scripts/tracking.js';

// Simplest — derive label, type, href, and context; just give it an id:
trackAs(block.querySelector('a[href]'), { id: 'hero|cta' });

// Override a couple of fields explicitly:
trackAs(cta, { id: 'hero|cta', label: 'Watch the demo', context: { block: 'hero' } });
```

### `track(eventName, details)` — emit an explicit event

Report an event yourself, for component state changes (open/close, show/hide) or
anything that isn't a plain click. Use this *instead of* `trackAs` on the same
control. Every key in `details` is emitted on the event **except** the ones the
tracker consumes to build context:

| Field | Meaning |
|---|---|
| `eventName` (1st arg) | The event string, e.g. `'show'`, `'hide'`, or your own. |
| `element` | Optional — derive `context` from this element (exactly like a click). The element itself is **not** emitted. |
| `block` / `blockSlug` / `blockStyles` / `section` / `sectionStyles` / `context` | Consumed to build `context`; not emitted verbatim. |
| `id`, `label`, `type`, `state`, … | Passed straight through onto the emitted event (add any custom fields your analytics needs). |

```js
import { track } from '../../scripts/tracking.js';

button.setAttribute('aria-expanded', expanded);
track(expanded ? 'show' : 'hide', {
  id: 'accordion|shipping',
  type: 'accordion-item',
  element: button,        // derive block/section context from here
  state: { expanded },    // emitted as-is on the event
});
```

### `configureTracking({ onTrack })` — set up delivery (once)

Installs a single delegated click listener and routes every event — clicks and
explicit `track()` calls alike — to your `onTrack(event)` callback. Returns a
cleanup function that removes the listener. Events are also dispatched as the
`eds:track` DOM event, so `onTrack` is optional if you only listen on the DOM.
The optional `view` object sets the global impression policy consumed by
[`viewAs`](#view--impression-events).

```js
const stop = configureTracking({
  onTrack: (event) => sendToAnalytics(event),
  view: { threshold: 0.5, minVisibleMs: 1000, once: true }, // impression defaults
});
```

### `setPageAttributes(values)` — shared page context (once)

Merges page-level fields into every event's `page` object.

```js
setPageAttributes({ language: 'en', url: location.href, viewport: 'desktop' });
```

## The event envelope

A click on an annotated element produces a stable, flat envelope:

```js
{
  event: 'click',
  id: 'hero|cta',
  label: 'Watch the demo',
  type: 'link',
  href: 'https://example.com/demo',
  context: {
    block: 'hero',
    blockSlug: 'product-overview',
    blockStyles: ['large'],
    section: 'overview',
    sectionStyles: ['highlight'],
  },
  page: { language: 'en', url: 'https://example.com/', viewport: 'desktop' },
}
```

**Stable key vs. descriptive context.** The stable reporting key is the authored
`id` you pass to `trackAs` / `track` — that is what a destination should key on.
`blockSlug` and `section` are **best-effort descriptive context, not
guaranteed-stable identity**: they are derived from the DOM and can drift as
markup or copy changes. To make a slug stable, give the block/section an explicit
authored id — an element `id` or a heading `id` — and the slug uses it verbatim.

Explicit annotation context wins. Otherwise `block` comes from `data-block-name`;
block and section slugs prefer an explicit authored id (the element's own `id`,
then the first heading's `id`), falling back to the authored accessible name
(`aria-labelledby` text, then `aria-label`) and finally the slugified heading
text. A click outside any block/section that lands in a `header`, `footer`, or
`nav` carries that region name as `section` instead of empty context. Style
arrays omit structural names and generated `*-container` classes.

Click labels approximate the accessible name in order: an explicit `label`, then
`aria-labelledby` / `aria-label`, then visible text — falling back to a
descendant `<img alt>` so icon/image-labeled controls are named — then the
`title` attribute, then an associated `<label>`. First non-empty wins, so an
icon-only button resolves a real name instead of an empty string. An interactive
ARIA role precedes the element tag for `type`. These small deterministic DOM
rules are portable; runtime code does not query browser accessibility-tree APIs,
and context is resolved fresh at emit time (never snapshotted at `trackAs`), so
each event owns its own derived arrays.

## Stateful controls

Components own their lifecycle semantics. Update native or ARIA state before calling
`track()`, and do not also `trackAs()` the same control:

```js
button.setAttribute('aria-expanded', expanded);
panel.hidden = !expanded;
track(expanded ? 'show' : 'hide', {
  id: 'accordion|shipping',
  type: 'accordion-item',
  element: button,
  state: { expanded },
});
```

Stateful controls use `show` and `hide`; `type` distinguishes `accordion-item` from
`dialog`. Passing `element` derives the same context as a click and does not include
the DOM node in the emitted event. The dialog reports `hide` from its native `close`
event, so Escape and close-button behavior share one path.

## View / impression events

Clicks are event delegation; **views (impressions) are visibility observation.**
`viewAs(element, annotation, options?)` registers an element for a `view` event that
fires when the element is actually *seen*, backed by a single lazily-created
`IntersectionObserver`. A page that never calls `viewAs` installs no observer and
pays nothing.

```js
import { viewAs } from '../../scripts/tracking.js';

export default function decorate(block) {
  // Emit a `view` when the hero is at least 50% visible for 1s (the default policy).
  viewAs(block, { id: 'hero|view' });
}
```

The `annotation` is exactly the [`trackAs`](#trackaselement-annotation--annotate-a-clickable-element)
annotation — same `id` / `label` / `type` / `context` resolution — because a view
**reuses the same envelope as a click**, only with `event: 'view'`:

```js
{
  event: 'view',            // the sole difference from a click envelope
  id: 'hero|view',
  label: 'Product overview',
  type: 'div',
  context: { block: 'hero', /* … */ },
  page: { /* … */ },
}
```

### Visibility policy

A view fires once the element crosses a **viewability threshold** and stays there
for a **dwell** time — the default is **≥ 50% visible for ≥ 1 second**. Crossing the
threshold arms a timer; if the element drops back below the threshold before the
timer elapses, the pending view is cancelled, so a quick scroll-past never counts.

| Option | Default | Meaning |
|---|---|---|
| `threshold` | `0.5` | Minimum visible fraction (0–1) that counts as seen. Honored to ~0.01 via the observer's notification grid. Avoid exactly `1.0` — intersection ratios rarely reach it; use `0.99` if you mean "fully visible". |
| `minVisibleMs` | `1000` | Dwell: how long it must stay at/above `threshold` before firing. |
| `once` | `true` | Fire a single impression then auto-unobserve; `false` re-arms each time the element re-enters the band. |

Set the global default on `configureTracking` via its `view` object, and override
it per registration with the third `viewAs` argument:

```js
configureTracking({ onTrack, view: { threshold: 0.6, minVisibleMs: 2000 } });
viewAs(promo, { id: 'promo|hero' }, { once: false }); // this element repeats
```

### No leaks

`viewAs` returns a **cleanup** function that unobserves the element and cancels any
pending dwell — call it when you tear a component down. A fire-once view unobserves
itself immediately after delivering, so the common case (a block seen once) needs no
manual cleanup. An element that is registered but *never seen* stays observed until
you call its cleanup — or, in practice, until the next full-page navigation clears
the page. The `views` registry itself is a `WeakMap`, so it never keeps an element
alive on its own.

```js
const stopViewing = viewAs(panel, { id: 'panel|view' }, { once: false });
// later, when the panel is removed:
stopViewing();
```

### Unified delivery

`view` events fan out through `onTrack` **and** the `eds:track` DOM event exactly
like clicks, so a consumer handles them by switching on `event`:

```js
document.addEventListener('eds:track', ({ detail }) => {
  if (detail.event === 'view') recordImpression(detail);
  else recordInteraction(detail);
});
```

> **⚠️ The `eds:track` view path is not consent-gated either.** Impressions cross
> the same boundary as clicks: the producer dispatches `eds:track` (and calls
> `onTrack`) for every `view` **regardless of consent state**. Enforcing consent
> before an impression is *delivered* is the consumer's / adapter's responsibility,
> identical to the click path described above.

## The Adobe reference adapter

`scripts/scripts.js` is the reference adapter. `sendToAdobe()` maps each semantic
event to XDM and calls the vendored martech library's `sendAnalyticsEvent()` directly
(direct Alloy) — clicks become `web.webinteraction.linkClicks`, other events become
`eds.<event>`. The interaction `name` keys on the stable authored `id` (falling
back to `label` only when no `id` is present), so the same control reports under
one key across locales and copy edits; the human `label` rides along as a
descriptive field on the retained envelope. The original envelope is retained
under `{ eds: { tracking: event } }` for customer mapping, and delivery failures
are contained so a rejected send never becomes an unhandled rejection. To target a different destination, replace this one
file; `scripts/tracking.js` stays untouched.

## Update the vendored martech

The `plugins/martech` subtree is pinned to `1aa3dee3c4791636efa9ad2994342f861c8e149b`.
Reapply that exact source revision with:

```sh
git subtree pull --squash --prefix plugins/martech git@github.com:adobe-rnd/aem-martech.git 1aa3dee3c4791636efa9ad2994342f861c8e149b
```

## Run locally

```sh
npm install
npm test
npm run lint
npx -y @adobe/aem-cli up --html-folder drafts
```
