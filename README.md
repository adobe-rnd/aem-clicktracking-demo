# AEM semantic click-tracking demo

A small, dependency-free click tracker for AEM Edge Delivery Services. It keeps
annotations in memory, derives stable AEM context, and exposes customer delivery
through one callback and the `eds:track` DOM event.

Both hooks receive every event. Use one of them for analytics delivery to avoid
reporting the same interaction twice.

## Use it

`scripts/tracking.js` exports four functions:

- `configureTracking({ onTrack })` installs the delegated listener and returns cleanup.
- `setPageAttributes(values)` adds shared page context.
- `trackAs(element, annotation)` privately annotates a clickable element.
- `track(event, details)` reports explicit component lifecycle events.

Annotate controls in their block code:

```js
import { trackAs } from '../../scripts/tracking.js';

trackAs(block.querySelector('a[href]'), { id: 'hero|cta' });
```

A click produces a semantic envelope like this:

```js
{
  event: 'click',
  id: 'hero|cta',
  label: 'Watch the demo',
  type: 'link',
  href: 'https://example.com/demo',
  context: { block: 'hero', section: 'overview', sectionStyles: ['highlight'] },
  page: { language: 'en', url: 'https://example.com/', viewport: 'desktop' },
}
```

Block context comes from `data-block-name`. Section context prefers an explicit
annotation, then the first heading ID, then the first authored section style.
Generated `*-container` classes are excluded. The page example in
`scripts/scripts.js` samples language, canonical or query-free URL, and viewport
once during eager loading.

## Stateful controls

Components own their lifecycle semantics. Update native or ARIA state before
calling `track()`, and do not also `trackAs()` the same control:

```js
button.setAttribute('aria-expanded', expanded);
panel.hidden = !expanded;
track(expanded ? 'accordion:open' : 'accordion:close', {
  id: 'accordion|shipping',
  state: { expanded },
});
```

The accordion reports `accordion:open` and `accordion:close`. The native dialog
reports `dialog:open` after `showModal()` and `dialog:close` from its `close`
event, so Escape and close-button behavior share one path.

## Adobe Analytics reference

`scripts/scripts.js` maps semantic clicks to XDM and sends them through the
vendored `plugins/martech` integration. Web SDK automatic click collection is
disabled to avoid duplicates; the original semantic envelope is retained in
the data object for customer mapping.

Adobe collection remains pending until the project's CMP publishes
`consent.update`. The included `scripts/consent-check.js` is only a demo adapter;
replace that consent-check.js policy with the customer's production CMP before
shipping.

The subtree is pinned to `1aa3dee3c4791636efa9ad2994342f861c8e149b`. Reapply
that exact source revision with:

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
