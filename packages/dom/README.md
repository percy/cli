# @percy/dom

Serializes a document's DOM into a DOM string suitable for snapshotting.

## Usage

### ES6 imports

```js
import serializeDOM from '@percy/dom';

// optional arguments shown with defaults
const domSnapshot = serializeDOM(/* options */)
```

### Browser injection

```js
// via puppeteer
await page.addScriptTag({ path: require.resolve('@percy/dom') })
const domSnapshot = await page.evaluate(() => PercyDOM.serialize(/* options */))
```

### Available options

- `enableJavaScript` - when true, does not serialize some DOM elements
- `domTransformation` - function to transform the DOM after serialization

## Serialized Content

The following serialization happens to a cloned instance of the document in order.

### Input elements

Input elements (`input`, `textarea`, `select`) are serialized by setting respective DOM attributes
to their matching JavaScript property counterparts. For example `checked`, `selected`, and `value`.

### Frame elements

Frame elements are serialized when they are CORS accessible and if they haven't been built by
JavaScript when JavaScript is enabled. They are serialized by recursively serializing the iframe's
own document element.

### CSSOM rules

When JavaScript is not enabled, CSSOM rules are serialized by iterating over and appending each rule
to a new stylesheet inserted into the document's head.

### Other elements

_All other elements are not serialized._ The resulting cloned document is passed to any provided
`domTransformation` option before the serialize function returns a DOM string.
