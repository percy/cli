import percy from './percy-info.js';
import request from './request.js';

// Post a PDF to the CLI's PDF snapshot endpoint. The CLI rasterizes it and
// creates one snapshot per page.
//
// This is the seam every Percy SDK wraps, so it is deliberately transport-plain:
// a single JSON POST with the document base64-encoded in the body. That is the
// lowest common denominator across the SDK fleet -- the .NET wrapper, for
// instance, reaches it through the same Dictionary-to-JSON helper it already
// uses for /percy/snapshot, with no multipart or streaming client code.
//
// `options.pdf.content` must be a base64 string. Node callers can pass
// `buffer.toString('base64')`; browsers, the result of encoding a Uint8Array.
//
// Mirrors postSnapshot's error handling: a build error means Percy is disabled
// for the rest of the run rather than an exception per call.
export async function postPdfSnapshot(options, params) {
  let query = params ? `?${new URLSearchParams(params)}` : '';

  return await request.post(`/percy/pdf/snapshot${query}`, options).catch(err => {
    if (err.response?.body?.build?.error) {
      percy.enabled = false;
    } else {
      throw err;
    }
  });
}

export default postPdfSnapshot;
