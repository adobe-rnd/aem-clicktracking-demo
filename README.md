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

## Adobe Analytics reference

`scripts/scripts.js` maps semantic clicks to XDM and sends them through the
vendored `plugins/martech` integration. Web SDK automatic click collection is
disabled to avoid duplicates; the original semantic envelope is retained in
the data object for customer mapping.

Adobe collection remains pending until the project's CMP publishes
`consent.update`. The included `scripts/consent-check.js` is only a demo adapter;
replace that consent-check.js policy with the customer's production CMP before
shipping.

## Run locally

```sh
npm install
npm test
npm run lint
npx -y @adobe/aem-cli up
```
