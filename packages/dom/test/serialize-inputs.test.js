import { withExample, parseDOM, platforms, platformDOM } from './helpers';
import serializeDOM from '@percy/dom';

describe('serializeInputs', () => {
  let cache = { shadow: {}, plain: {} };

  beforeAll(async () => {
    platforms.forEach((platform) => {
      withExample(`
      <form>
        <label for="name">Name</label>
        <input id="name" type="text" />

        <label for="valueAttr">Already has value</label>
        <input id="valueAttr" type="text" value="Already present" />

        <input id="mailing" type="checkbox" />
        <label for="mailing">Subscribe?</label>

        <input id="radio" type="radio" />
        <label for="radio">Radio</label>

        <input id="nevercheckedradio" type="radio" />
        <label for="nevercheckedradio">Never checked</label>

        <label for="singleSelect">Does this work?</label>
        <select id="singleSelect">
          <option value="yes">Yes</option>
          <option value="no">No</option>
          <option value="maybe">Maybe</option>
        </select>

        <label for="multiselect">Which car?</label>
        <select id="multiselect" multiple>
          <option value="gt350">Shelby GT350</option>
          <option value="gt500">Shelby GT500</option>
          <option value="first-gen-miata">NA Miata</option>
        </select>

        <select id="emptyselect"></select>

        <label for="feedback">Feedback</label>
        <textarea id="feedback"></textarea>
      </form>
    `);
      const dom = platformDOM(platform);
      dom.querySelector('#name').value = 'Bob Boberson';
      dom.querySelector('#valueAttr').value = 'Replacement Value!';
      dom.querySelector('#feedback').value = 'This is my feedback... And it is not very helpful';
      dom.querySelector('#radio').checked = true;
      dom.querySelector('#mailing').checked = true;
      dom.querySelector('#singleSelect').value = 'maybe';

      const selected = ['Shelby GT350', 'NA Miata'];
      Array.from(dom.querySelector('#multiselect').options).forEach(function(option) {
        // If the option's value is in the selected array, select it
        // Otherwise, deselect it
        if (selected.includes(option.innerText)) {
          option.selected = true;
        } else {
          option.selected = false;
        }
      });
      cache[platform].$ = parseDOM(serializeDOM(), platform);
      cache[platform].dom = platform === 'shadow' ? dom : dom.cloneNode(true)
    });
    // interact with the inputs to update properties (does not update attributes)
  });

  platforms.forEach((platform) => {
    let $, dom;
    beforeEach(() => {
      dom = cache[platform].dom;
      $ = cache[platform].$;
    });

    it(`${platform}: serializes checked checkboxes`, () => {
      expect($('#mailing')[0].checked).toBe(true);
    });

    it(`${platform}: leaves unchecked checkboxes alone`, () => {
      expect($('#nevercheckedradio')[0].checked).toBe(false);
    });

    it(`${platform}: serializes checked radio buttons`, () => {
      expect($('#radio')[0].checked).toBe(true);
    });

    it(`${platform}: serializes textareas`, () => {
      expect($('#feedback')[0].innerText).toBe('This is my feedback... And it is not very helpful');
    });

    it(`${platform}: serializes input elements`, () => {
      expect($('#name')[0].getAttribute('value')).toBe('Bob Boberson');
    });

    it(`${platform}: serializes single select elements`, () => {
      expect($('#singleSelect>:nth-child(1)')[0].selected).toBe(false);
      expect($('#singleSelect>:nth-child(2)')[0].selected).toBe(false);
      expect($('#singleSelect>:nth-child(3)')[0].selected).toBe(true);
    });

    it(`${platform}: serializes multi-select elements`, () => {
      expect($('#multiselect>:nth-child(1)')[0].selected).toBe(true);
      expect($('#multiselect>:nth-child(2)')[0].selected).toBe(false);
      expect($('#multiselect>:nth-child(3)')[0].selected).toBe(true);
    });

    it(`${platform}: does not mutate original select elements`, () => {
      let options = [
        ...dom.querySelector('#multiselect').options,
        ...dom.querySelector('#singleSelect').options
      ];

      for (let $option of options) {
        expect($option.getAttribute('selected')).toBeNull();
      }
    });

    it(`${platform}: serializes inputs with already present value attributes`, () => {
      expect($('#valueAttr')[0].getAttribute('value')).toBe('Replacement Value!');
    });

    it(`${platform}: adds a guid data-attribute to the original DOM`, () => {
      // plain platform has extra element #test-shadow
      expect(dom.querySelectorAll('[data-percy-element-id]')).toHaveSize(platform === 'plain' ? 10 : 9);
    });

    fit(`${platform}: adds matching guids to the orignal DOM and cloned DOM`, () => {
      let og = dom.querySelector('[data-percy-element-id]').getAttribute('data-percy-element-id');
      expect(og).toEqual($('[data-percy-element-id]')[0].getAttribute('data-percy-element-id'));
    });

    it(`${platform}: does not override previous guids when reserializing`, () => {
      let getUid = () => dom.querySelector('[data-percy-element-id]').getAttribute('data-percy-element-id');
      let first = getUid();

      serializeDOM();
      expect(getUid()).toEqual(first);
    });

    it(`${platform}: does not mutate values in origial DOM`, () => {
      expect($('#name')[0].getAttribute('value')).toBe('Bob Boberson');
      expect(dom.querySelector('#name').getAttribute('value')).toBeNull();
    });
  });
});
