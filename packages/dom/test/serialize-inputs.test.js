import { withExample, parseDOM, platforms, platformDOM } from './helpers';
import serializeDOM from '@percy/dom';
import serializeInputElements from '../src/serialize-inputs';

describe('serializeInputs', () => {
  let cache = { shadow: {}, plain: {} };

  describe('success case', () => {
    beforeEach(async () => {
      withExample(`
        <form>
          <label for="name">Name</label>
          <input id="name" type="text" />
  
          <label for="valueAttr">Already has value</label>
          <input id="valueAttr" type="text" value="Already present" />
  
          <input id="mailing" type="checkbox" />
          <label for="mailing">Subscribe?</label>
  
          <input id="radio" type="radio" checked=""/>
          <label for="radio">Radio</label>
  
          <input id="nevercheckedradio" type="radio" />
          <label for="nevercheckedradio">Never checked</label>
  
          <form>
            <input type="radio" id="option1" name="option" value="option1" checked>
            <label for="option1">Option 1</label><br>
            <input type="radio" id="option2" name="option" value="option2" checked>
            <label for="option2">Option 2</label><br>
          </form>
  
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

      platforms.forEach((platform) => {
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
        cache[platform].dom = dom;
        cache[platform].$ = parseDOM(serializeDOM(), platform);
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
        expect($('#radio')[0].outerHTML).toContain('checked=""');
        expect($('#radio')[0].checked).toBe(true);
      });

      it(`${platform}: removes checked attr from radio-button option1 when option1 is not explictly selected`, () => {
        expect($('#option1')[0].outerHTML).not.toContain('checked=""');
        expect($('#option1')[0].checked).toBe(false);

        expect($('#option2')[0].outerHTML).toContain('checked=""');
        expect($('#option2')[0].checked).toBe(true);
      });

      it(`${platform}: removes checked attr from radio-button option2 when option1 is explictly selected`, () => {
        dom.querySelector('#option1').checked = true;
        $ = parseDOM(serializeDOM(), platform);

        expect($('#option1')[0].outerHTML).toContain('checked=""');
        expect($('#option1')[0].checked).toBe(true);

        expect($('#option2')[0].outerHTML).not.toContain('checked=""');
        expect($('#option2')[0].checked).toBe(false);
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
        expect(dom.querySelectorAll('[data-percy-element-id]')).toHaveSize(platform === 'plain' ? 12 : 11);
      });

      it(`${platform}: adds matching guids to the orignal DOM and cloned DOM`, () => {
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

  describe('failure case', () => {
    it('add node details in error message and rethrow it', async () => {
      withExample(`
        <input id="input" class="test1 test2"/>
      `);
      expect(() => serializeInputElements({ dom: document })).toThrowMatching((error) => {
        return error.message.includes('Error serializing input element:') &&
          error.message.includes('{"nodeName":"INPUT","classNames":"test1 test2","id":"input"}');
      });
    });
  });
});
