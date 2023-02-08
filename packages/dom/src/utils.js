// Creates a resource object from an element's unique ID and data URL
export function resourceFromDataURL(uid, dataURL) {
  // split dataURL into desired parts
  let [data, content] = dataURL.split(',');
  let [, mimetype] = data.split(':');
  [mimetype] = mimetype.split(';');

  // build a URL for the serialized asset
  let [, ext] = mimetype.split('/');
  let path = `/__serialized__/${uid}.${ext}`;
  let url = new URL(path, document.URL).toString();

  // return the url, base64 content, and mimetype
  return { url, content, mimetype };
}

export function resourceFromText(uid, mimetype, content) {
  // build a URL for the serialized asset
  let [, ext] = mimetype.split('/');
  let path = `/__serialized__/${uid}.${ext}`;
  let url = new URL(path, document.URL).toString();

  // return the url, base64 content, and mimetype
  return { url, content, mimetype };
}
