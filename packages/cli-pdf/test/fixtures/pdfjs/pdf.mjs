// Stands in for pdf.js's legacy/build/pdf.mjs when the loadLibrary browser
// script is exercised in Node: the asset server origin is a file: URL pointing
// at this directory's parent, so `${origin}/pdfjs/pdf.mjs` resolves here.
export const getDocument = () => 'served';
