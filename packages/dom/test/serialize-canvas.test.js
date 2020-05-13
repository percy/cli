import expect from 'expect';
import cheerio from 'cheerio';
import { withExample } from './helpers';
import serializeDOM from '../src';

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

    $ = cheerio.load(serializeDOM());
    src = canvas.toDataURL();
  });

  it('serializes canvas elements', async () => {
    let $canvas = $('#canvas');
    expect($canvas[0].tagName).toBe('img');
    expect($canvas.attr('src')).toBe(src);
    expect($canvas.attr('width')).toBe('150px');
    expect($canvas.attr('height')).toBe('150px');
    expect($canvas.attr('style')).toBe('border: 5px solid black; max-width: 100%;');
    expect($canvas.is('[data-percy-canvas-serialized]')).toBe(true);
  });

  it('does not serialize canvas elements when JS is enabled', async () => {
    $ = cheerio.load(serializeDOM({ enableJavaScript: true }));

    let $canvas = $('#canvas');
    expect($canvas[0].tagName).toBe('canvas');
    expect($canvas.is('[data-percy-canvas-serialized]')).toBe(false);
  });
});
