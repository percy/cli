import path from 'path';

import {
  createResource,
  createRootResource
} from '@percy/cli-command/utils';

export {
  yieldAll
} from '@percy/cli-command/utils';

// Returns root resource and image resource objects based on an image's
// filename, contents, and dimensions. The root resource is a generated DOM
// designed to display an image at it's native size without margins or padding.
export function createImageResources(filename, content, size) {
  let { dir, name, ext } = path.parse(filename);
  let rootUrl = `http://localhost/${encodeURIComponent(path.join(dir, name))}`;
  let imageUrl = `http://localhost/${encodeURIComponent(filename)}`;
  let mimetype = ext === '.png' ? 'image/png' : 'image/jpeg';

  return [
    createRootResource(rootUrl, `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>${filename}</title>
          <style>
            *, *::before, *::after { margin: 0; padding: 0; font-size: 0; }
            html, body { width: 100%; }
            img { max-width: 100%; }
          </style>
        </head>
        <body>
          <img src="${imageUrl}" width="${size.width}px" height="${size.height}px"/>
        </body>
      </html>
    `),
    createResource(imageUrl, content, mimetype)
  ];
}

export default createImageResources;
