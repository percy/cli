import { resourceFromDataURL } from './utils.js';

// Captures the current frame of videos and sets the poster image
export function serializeVideos({ dom, clone, resources }) {
  for (let video of dom.querySelectorAll('video')) {
    // if the video already has a poster image, no work for us to do
    if (video.getAttribute('poster')) continue;

    let videoId = video.getAttribute('data-percy-element-id');
    let cloneEl = clone.querySelector(`[data-percy-element-id="${videoId}"]`);
    let canvas = document.createElement('canvas');
    let width = canvas.width = video.videoWidth;
    let height = canvas.height = video.videoHeight;
    let dataUrl;

    canvas.getContext('2d').drawImage(video, 0, 0, width, height);
    try { dataUrl = canvas.toDataURL(); } catch {}

    // if the canvas produces a blank image, skip
    if (!dataUrl || dataUrl === 'data:,') continue;

    // create a resource from the serialized data url
    let resource = resourceFromDataURL(videoId, dataUrl);
    resources.add(resource);

    // use a data attribute to avoid making a real request
    cloneEl.setAttribute('data-percy-serialized-attribute-poster', resource.url);
  }

  // find video inside shadow host and recursively serialize them.
  for (let shadowHost of dom.querySelectorAll('[data-percy-shadow-host]')) {
    let percyElementId = shadowHost.getAttribute('data-percy-element-id');
    let cloneShadowHost = clone.querySelector(`[data-percy-element-id="${percyElementId}"]`);

    if (shadowHost.shadowRoot && cloneShadowHost.shadowRoot) {
      serializeVideos({
        dom: shadowHost.shadowRoot,
        clone: cloneShadowHost.shadowRoot,
        resources
      });
    }
  }
}

export default serializeVideos;
