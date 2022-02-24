// Captures the current frame of videos and sets the poster image
export function serializeVideos(dom, clone) {
  for (let video of dom.querySelectorAll('video')) {
    // If the video already has a poster image, no work for us to do
    if (video.getAttribute('poster')) continue;

    let videoId = video.getAttribute('data-percy-element-id');
    let cloneEl = clone.querySelector(`[data-percy-element-id="${videoId}"]`);
    let canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    canvas.getContext('2d').drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    let dataUrl = canvas.toDataURL();
    // If the canvas produces a blank image, skip
    if (!dataUrl || dataUrl === 'data:,') continue;

    cloneEl.setAttribute('poster', dataUrl);
  }
}

export default serializeVideos;
