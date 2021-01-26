import I from 'interactor.js';
import { expect, withExample, parseDOM } from 'test/helpers';
import serializeDOM from '@percy/dom';

describe('serializeInputs', () => {
  let $;

  beforeEach(async () => {
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

    // interact with the inputs to update properties (does not update attributes)
    await I('form')
      .find('#name').type('Bob Boberson')
      .find('#valueAttr').type('Replacement Value!', { range: [0, 500] })
      .find('#feedback').type('This is my feedback... And it is not very helpful')
      .find('#radio').check()
      .find('#singleSelect').select(I.find.text('Maybe'))
      .find('#multiselect').select([I.find.text('Shelby GT350'), I.find.text('NA Miata')])
      .find('#mailing').check();

    $ = parseDOM(serializeDOM());
  });

  it('serializes checked checkboxes', () => {
    expect($('#mailing')[0].checked).toBe(true);
  });

  it('leaves unchecked checkboxes alone', () => {
    expect($('#nevercheckedradio')[0].checked).toBe(false);
  });

  it('serializes checked radio buttons', () => {
    expect($('#radio')[0].checked).toBe(true);
  });

  it('serializes textareas', () => {
    expect($('#feedback')[0].innerText).toBe('This is my feedback... And it is not very helpful');
  });

  it('serializes input elements', () => {
    expect($('#name')[0].getAttribute('value')).toBe('Bob Boberson');
  });

  it('serializes single select elements', () => {
    expect($('#singleSelect>:nth-child(1)')[0].selected).toBe(false);
    expect($('#singleSelect>:nth-child(2)')[0].selected).toBe(false);
    expect($('#singleSelect>:nth-child(3)')[0].selected).toBe(true);
  });

  it('serializes multi-select elements', () => {
    expect($('#multiselect>:nth-child(1)')[0].selected).toBe(true);
    expect($('#multiselect>:nth-child(2)')[0].selected).toBe(false);
    expect($('#multiselect>:nth-child(3)')[0].selected).toBe(true);
  });

  it('does not mutate original select elements', () => {
    let options = [
      ...document.querySelector('#multiselect').options,
      ...document.querySelector('#singleSelect').options
    ];

    for (let $option of options) {
      expect($option.getAttribute('selected')).toBeNull();
    }
  });

  it('serializes inputs with already present value attributes', () => {
    expect($('#valueAttr')[0].getAttribute('value')).toBe('Replacement Value!');
  });

  it('adds a guid data-attribute to the original DOM', () => {
    expect(document.querySelectorAll('[data-percy-element-id]')).toHaveLength(9);
  });

  it('adds matching guids to the orignal DOM and cloned DOM', () => {
    let og = document.querySelector('[data-percy-element-id]').getAttribute('data-percy-element-id');
    expect(og).toEqual($('[data-percy-element-id]')[0].getAttribute('data-percy-element-id'));
  });

  it('does not override previous guids when reserializing', () => {
    let getUid = () => document.querySelector('[data-percy-element-id]').getAttribute('data-percy-element-id');
    let first = getUid();

    serializeDOM();
    expect(getUid()).toEqual(first);
  });

  it('does not mutate values in origial DOM', () => {
    expect($('#name')[0].getAttribute('value')).toBe('Bob Boberson');
    expect(document.querySelector('#name').getAttribute('value')).toBeNull();
  });
});
