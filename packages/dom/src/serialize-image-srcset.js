// Return list of link of all srcset images to be captured
export function serializeImageSrcSet({ dom }) {
  const links = new Set();

  for (let img of dom.querySelectorAll('img[srcset]')) {
    handleSrcSet(img.srcset, links);
  }

  for (let picture of dom.querySelectorAll('picture')) {
    for (let source of picture.querySelectorAll('source')) {
      handleSrcSet(source.srcset, links);
    }
  }
  return Array.from(links);
}

function handleSrcSet(srcSet, links) {
  srcSet = srcSet.split(/,\s+/);

  for (let src of srcSet) {
    src = src.trim();
    src = src.split(' ')[0];
    links.add(getFormattedLink(src));
  }
}

function getFormattedLink(src) {
  if (src.startsWith('//')) {
    src = document.location.protocol + src;
  } else if (src.startsWith('/')) {
    src = document.location.origin + src;
  } else if (!src.startsWith('http')) {
    src = document.location.href + src;
  }
  return src;
}

export default serializeImageSrcSet;
