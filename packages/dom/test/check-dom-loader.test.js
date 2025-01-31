import { checkForLoader } from '../src/check-dom-loader';
import { withExample } from './helpers';

describe('checkForLoader', () => {
  let div, loaderElement;

  beforeEach(() => {
    withExample('<div id="content"></div>', { showLoader: true });

    loaderElement = document.querySelector('.loader');
    div = document.querySelector('.parent');
  });

  it('should return true if a loader element is visible and covers sufficient area of the viewport', () => {
    loaderElement.style.display = 'block';
    loaderElement.style.visibility = 'visible';
    loaderElement.style.opacity = '1';

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

  it('should return true if the loader meets the size percentage criteria', () => {
    div.style.width = '200px';
    div.style.height = '200px';
    loaderElement.style.width = '800px';
    loaderElement.style.height = '600px';

    const result = checkForLoader();
    expect(result).toBe(true);
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
