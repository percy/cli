import { promises as fs } from 'fs';
import waitFor from './wait-for';

function wrapHelpers(fn) {
  return 'function withPercyHelpers() {' + (
    `return (${fn.toString()})({` + (
      `waitFor: ${waitFor.toString()}`
    ) + '}, ...arguments)'
  ) + '}';
}

export async function navigatePage(page, url, {
  waitForTimeout,
  waitForSelector
}) {
  // navigate to the url and wait for network idle
  await page.goto(url);
  await page.network.idle();

  // wait for any specified timeout
  if (waitForTimeout) {
    await new Promise(resolve => {
      setTimeout(resolve, waitForTimeout);
    });
  }

  // wait for any specified selector
  if (waitForSelector) {
    /* istanbul ignore next: no instrumenting injected code */
    await page.eval(wrapHelpers(({ waitFor }, sel) => (
      waitFor(() => !!document.querySelector(sel), 10000)
        .catch(() => Promise.reject(new Error(`Failed to find "${sel}"`)))
    )), waitForSelector);
  }
}

export async function preparePage(page, execute) {
  if (execute) {
    // accept function bodies as strings
    if (typeof execute === 'string') {
      execute = `async execute({ waitFor }) {\n${execute}\n}`;
    }

    // attempt to serialize function
    let fnbody = execute.toString();

    // we might have a function shorthand if this fails
    /* eslint-disable-next-line no-new, no-new-func */
    try { new Function('(' + fnbody + ')'); } catch (error) {
      fnbody = fnbody.startsWith('async ')
        ? 'async function ' + fnbody.substring('async '.length)
        : 'function ' + fnbody;

      /* eslint-disable-next-line no-new, no-new-func */
      try { new Function('(' + fnbody + ')'); } catch (error) {
        throw new Error('The execute function is not serializable');
      }
    }

    // execute a script within the page
    await page.eval(wrapHelpers(fnbody));

    // script may cause additional network activity
    await page.network.idle();
  }

  // inject @percy/dom for serialization by evaluating the file contents which adds a global
  // PercyDOM object that we can later check against
  /* istanbul ignore next: no instrumenting injected code */
  if (await page.eval(() => !window.PercyDOM)) {
    let script = await fs.readFile(require.resolve('@percy/dom'), 'utf-8');
    /* eslint-disable-next-line no-new-func */
    await page.eval(new Function(script));
  }
}
