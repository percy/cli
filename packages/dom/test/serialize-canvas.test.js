import { expect, withExample, parseDOM } from 'test/helpers';
import serializeDOM from '@percy/dom';

describe('serializeCanvas', () => {
  let $, src;

  beforeEach(async () => {
    withExample(`
      <canvas
        id="canvas"
        width="150px"
        height="150px"
        style="border: 5px solid black;"
      ></canvas>
      <canvas
        id="empty"
        width="0px"
        height="0px"
      ></canvas>
    `);

    let canvas = document.getElementById('canvas');
    let ctx = canvas.getContext('2d');

    ctx.beginPath();
    ctx.arc(75, 75, 50, 0, Math.PI * 2, true);
    ctx.moveTo(110, 75);
    ctx.arc(75, 75, 35, 0, Math.PI, false);
    ctx.moveTo(65, 65);
    ctx.arc(60, 65, 5, 0, Math.PI * 2, true);
    ctx.moveTo(95, 65);
    ctx.arc(90, 65, 5, 0, Math.PI * 2, true);
    ctx.stroke();

    $ = parseDOM(serializeDOM());
    src = canvas.toDataURL();
  });

  it('serializes canvas elements', () => {
    let $canvas = $('#canvas');
    expect($canvas[0].tagName).toBe('IMG');
    expect($canvas[0].getAttribute('src')).toBe(src);
    expect($canvas[0].getAttribute('width')).toBe('150px');
    expect($canvas[0].getAttribute('height')).toBe('150px');
    expect($canvas[0].getAttribute('style')).toBe('border: 5px solid black; max-width: 100%;');
    expect($canvas[0].matches('[data-percy-canvas-serialized]')).toBe(true);
  });

  it('does not serialize canvas elements when JS is enabled', () => {
    $ = parseDOM(serializeDOM({ enableJavaScript: true }));

    let $canvas = $('#canvas');
    expect($canvas[0].tagName).toBe('CANVAS');
    expect($canvas[0].matches('[data-percy-canvas-serialized]')).toBe(false);
  });

  it('does not serialize empty canvas elements', () => {
    let $canvas = $('#empty');
    expect($canvas[0].tagName).toBe('CANVAS');
    expect($canvas[0].matches('[data-percy-canvas-serialized]')).toBe(false);
  });
});
