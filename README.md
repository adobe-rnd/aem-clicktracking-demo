# AEM semantic click-tracking demo

A small, **dependency-free** semantic click tracker for AEM Edge Delivery Services
(EDS). It turns clicks and component state changes into stable, accessible,
vendor-neutral events, and shows how to deliver them to Adobe without coupling the
reusable core to any analytics vendor or DOM metadata contract.

The design has one load-bearing idea: **a generic producer plus a project-owned
adapter.** `scripts/tracking.js` only *produces* semantic events; `scripts/scripts.js`
*maps and delivers* them. Swap the adapter to target a different destination and the
core never changes.

## How it's wired

Four layers, each with one job:

| Layer | File(s) | Responsibility |
|---|---|---|
| **Producer** | `scripts/tracking.js` | Generic, dependency-free core (≤2 KB min / ≤1 KB gzip). Four functions; builds one semantic envelope; emits it on the `eds:track` DOM event **and** an `onTrack` callback. Knows nothing about Adobe. |
| **Adapter + lifecycle** | `scripts/scripts.js` | The AEM boot sequence and the project's delivery choice: boots martech, maps each envelope to Adobe XDM, samples page attributes, wires consent. This is the file a customer edits. |
| **Delivery** | `plugins/martech/` | Vendored Adobe Web SDK (Alloy) integration, pinned via `git subtree`. The core has no dependency on it. |
| **Examples** | `blocks/*` | Copyable blocks: the hero annotates a CTA (`trackAs`); accordion and dialog emit lifecycle events (`track`). |

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

## The four-function API

`scripts/tracking.js` exports four functions and nothing else:

- `configureTracking({ onTrack })` installs the delegated listener and returns a cleanup function.
- `setPageAttributes(values)` adds shared page context to every event.
- `trackAs(element, annotation)` privately annotates a clickable element (kept in a `WeakMap`, never in the DOM).
- `track(event, details)` reports an explicit component lifecycle event.

Annotate controls in their block code:

```js
import { trackAs } from '../../scripts/tracking.js';

trackAs(block.querySelector('a[href]'), { id: 'hero|cta' });
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

Explicit annotation context wins. Otherwise `block` comes from `data-block-name`;
block and section slugs use `aria-labelledby` text, `aria-label`, then the first
heading ID or text. Style arrays omit structural names and generated `*-container`
classes. Click labels use the same accessible-name approximation before visible text,
while an interactive ARIA role precedes the element tag for `type`. These small
deterministic DOM rules are portable; runtime code does not query browser
accessibility-tree APIs, and context is resolved fresh at emit time (never snapshotted
at `trackAs`), so each event owns its own derived arrays.

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

## The Adobe reference adapter

`scripts/scripts.js` is the reference adapter. `sendToAdobe()` maps each semantic
event to XDM and calls the vendored martech library's `sendAnalyticsEvent()` directly
(direct Alloy) — clicks become `web.webinteraction.linkClicks`, other events become
`eds.<event>`. The original envelope is retained under `{ eds: { tracking: event } }`
for customer mapping, and delivery failures are contained so a rejected send never
becomes an unhandled rejection. To target a different destination, replace this one
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
