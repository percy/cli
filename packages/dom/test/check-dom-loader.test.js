import { checkForLoader } from '../src/check-dom-loader';
import { withExample } from './helpers';

describe('checkForLoader', () => {
  let div, loaderElement;

  beforeEach(() => {
    withExample('<div id="content"></div>', { showLoader: true });

    loaderElement = document.querySelector('.loader');
    loaderElement.style.display = 'block';
    loaderElement.style.visibility = 'visible';
    loaderElement.style.opacity = '1';
    div = document.querySelector('.parent');
    div.style.display = 'block';
    div.style.visibility = 'visible';
    div.style.opacity = '1';
  });

  afterEach(() => {
    loaderElement = null;
    div = null;
  });

  it('should return true if the loader is visible and meets the size percentage criteria', () => {
    loaderElement.style.width = '800px';
    loaderElement.style.height = '600px';
    const result = checkForLoader();
    expect(result).toBe(true);
  });

  it('should return true if parent meets the size percentage criteria', () => {
    div.style.width = '800px';
    div.style.height = '3000px';
    loaderElement.style.width = '600px';
    loaderElement.style.height = '500px';

    const result = checkForLoader();
    expect(result).toBe(true);
  });

  it('should return false if one of percentage criteria fails', () => {
    div.style.width = '800px';
    div.style.height = '200px';
    loaderElement.style.width = '600px';
    loaderElement.style.height = '500px';

    const result = checkForLoader();
    expect(result).toBe(false);
  });

  it('should return true if loader has upto depth 1 children', () => {
    const child1 = document.createElement('div');
    div.style.height = '6000px';
    loaderElement.appendChild(child1);
    const result = checkForLoader();
    expect(result).toBe(true);
  });

  it('should return false if the loader element is not visible', () => {
    loaderElement.style.visibility = 'hidden';

    const result = checkForLoader();
    expect(result).toBe(false);
  });

  it('should return false if the loader element is inside an invisible parent', () => {
    div.style.visibility = 'hidden';

    const result = checkForLoader();
    expect(result).toBe(false);
  });

  it('should return false if the loader does not meet the size percentage criteria', () => {
    div.style.width = '200px';
    div.style.height = '200px';
    loaderElement.style.width = '100px';
    loaderElement.style.height = '100px';

    const result = checkForLoader();
    expect(result).toBe(false);
  });

  it('should return false if no loader element is found', () => {
    div.removeChild(loaderElement);

    const result = checkForLoader();
    expect(result).toBe(false);
  });

  it('should return false if loader has upto depth 3 children', () => {
    const child1 = document.createElement('div');
    const child2 = document.createElement('div');
    child1.appendChild(child2);
    loaderElement.appendChild(child1);
    const result = checkForLoader();
    expect(result).toBe(false);
  });
});
