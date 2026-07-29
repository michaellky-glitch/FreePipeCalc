/* FreePipeCalc — TRACE: background drawings to trace over
 *
 * Capture, encoding and image caching. Rendering lives in canvas.js; this file
 * is the part that turns a pasted screenshot into something the model can hold.
 *
 * Design decisions and their reasoning are in docs/TRACE-design.md. Two are
 * worth repeating here because they look arbitrary in the code:
 *
 * 1. The PASTE EVENT is used, never navigator.clipboard.read(). The async
 *    Clipboard API requires a secure context, and a file:// origin is not one —
 *    it would fail in exactly the deployment this app exists for. The paste
 *    event is a user-gesture DOM event with the data already attached and has
 *    no such restriction.
 *
 * 2. Images are re-encoded as PNG, not JPEG. Drawings are line art on white:
 *    PNG came out both smaller (105 KB vs 125 KB at 2000 px) and lossless,
 *    while JPEG puts ringing artefacts around exactly the black lines being
 *    traced. That is the opposite of the usual photographic advice.
 */
(function (FD) {
  'use strict';

  /* Long edge after downscaling. 2000 px keeps a 4K snip legible at the zoom
   * levels tracing actually happens at, for about 40% of the raw size. */
  var MAX_EDGE = 2000;

  /* Decoded images, keyed by level id. The model carries data URLs; decoding
   * them on every frame would be ruinous, so each is decoded once and the
   * canvas is asked to repaint when it lands. */
  var cache = {};

  function load(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Image could not be decoded.')); };
      img.src = src;
    });
  }

  /* Blob (from a paste or a drop) → { src, aspect, width, height }.
   * Downscales and re-encodes; never returns the original bytes. */
  function fromBlob(blob) {
    if (!blob || !/^image\//.test(blob.type)) {
      return Promise.reject(new Error('That is not an image.'));
    }
    var url = URL.createObjectURL(blob);
    return load(url).then(function (img) {
      URL.revokeObjectURL(url);
      var k = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(1, Math.round(img.naturalWidth * k));
      var h = Math.max(1, Math.round(img.naturalHeight * k));

      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);

      return {
        src: c.toDataURL('image/png'),
        aspect: h / w,
        width: w,
        height: h,
        scaled: k < 1
      };
    });
  }

  /* Pull the first image out of a paste or drop event. Returns null if there
   * isn't one, which is the normal case for a text paste. */
  function imageFromEvent(e) {
    var dt = e.clipboardData || e.dataTransfer;
    if (!dt) return null;

    if (dt.items) {
      for (var i = 0; i < dt.items.length; i++) {
        var it = dt.items[i];
        if (it.kind === 'file' && /^image\//.test(it.type)) return it.getAsFile();
      }
    }
    if (dt.files) {
      for (var j = 0; j < dt.files.length; j++) {
        if (/^image\//.test(dt.files[j].type)) return dt.files[j];
      }
    }
    return null;
  }

  /* Decoded image for a level's trace, or null while it is still loading.
   * `onReady` fires once when a newly-decoded image becomes available. */
  function imageFor(level, onReady) {
    if (!level || !level.trace || !level.trace.src) return null;
    var entry = cache[level.id];
    if (entry && entry.src === level.trace.src) return entry.img || null;

    cache[level.id] = { src: level.trace.src, img: null };
    load(level.trace.src).then(function (img) {
      if (cache[level.id] && cache[level.id].src === level.trace.src) {
        cache[level.id].img = img;
        if (onReady) onReady();
      }
    }).catch(function () { /* a corrupt data URL simply renders nothing */ });
    return null;
  }

  function forget(levelId) {
    if (levelId === undefined) cache = {};
    else delete cache[levelId];
  }

  /* Approximate size of a trace as stored, for showing the user what it costs. */
  function sizeKB(trace) {
    if (!trace || !trace.src) return 0;
    // a base64 payload is 4 characters per 3 bytes
    return Math.round(trace.src.length * 0.75 / 1024);
  }

  FD.trace = {
    MAX_EDGE: MAX_EDGE,
    fromBlob: fromBlob,
    imageFromEvent: imageFromEvent,
    imageFor: imageFor,
    forget: forget,
    sizeKB: sizeKB,
    load: load
  };
})(window.FD = window.FD || {});
