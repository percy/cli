import { resourceFromDataURL, handleErrors } from './utils.js';

// Captures the current frame of videos and sets the poster image
export function serializeVideos(ctx) {
  let { dom, clone, resources, warnings } = ctx;
  for (let video of dom.querySelectorAll('video')) {
    try {
      // if the video already has a poster image, no work for us to do
      if (video.getAttribute('poster')) continue;

      let videoId = video.getAttribute('data-percy-element-id');
      let cloneEl = clone.querySelector(`[data-percy-element-id="${videoId}"]`);
      let canvas = document.createElement('canvas');
      let width = canvas.width = video.videoWidth;
      let height = canvas.height = video.videoHeight;
      let dataUrl;

      canvas.getContext('2d').drawImage(video, 0, 0, width, height);
      try { dataUrl = canvas.toDataURL(); } catch (e) { warnings.add(`data-percy-element-id="${videoId}" : ${e.toString()}`); }

      // if the canvas produces a blank image, skip
      if (!dataUrl || dataUrl === 'data:,') continue;

      // create a resource from the serialized data url
      let resource = resourceFromDataURL(videoId, dataUrl);
      resources.add(resource);

      // use a data attribute to avoid making a real request
      cloneEl.setAttribute('data-percy-serialized-attribute-poster', resource.url);
    } catch (err) {
      handleErrors(ctx, err, 'Error serializing video element: ', video);
    }
  }
}

export default serializeVideos;
