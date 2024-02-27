// Handle nodes with srcset
export function serializeImageSrcSet(node, links) {
  if (!node.srcset) return;

  handleSrcSet(node.srcset, links);
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
  const anchor = document.createElement('a');
  anchor.href = src;
  return anchor.href;
}

export default serializeImageSrcSet;
