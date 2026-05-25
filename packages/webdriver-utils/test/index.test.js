import WebdriverUtils from '../src/index.js';
import ProviderResolver from '../src/providers/providerResolver.js';
import PlaywrightProvider from '../src/providers/playwrightProvider.js';

describe('WebdriverUtils.captureScreenshot', () => {
  let providerStub;
  let baseArgs;
  let providerResponse;

  beforeEach(() => {
    providerResponse = {
      name: 'snap',
      tag: { name: 'tag-1' },
      tiles: [],
      metadata: {}
    };

    providerStub = {
      createDriver: jasmine.createSpy('createDriver').and.resolveTo(),
      screenshot: jasmine.createSpy('screenshot').and.callFake(() => Promise.resolve({ ...providerResponse }))
    };

    spyOn(ProviderResolver, 'resolve').and.returnValue(providerStub);

    baseArgs = {
      sessionId: '1234',
      commandExecutorUrl: 'https://localhost/command-executor',
      capabilities: {},
      sessionCapabilities: {},
      framework: null,
      snapshotName: 'snap',
      clientInfo: 'client',
      environmentInfo: 'env',
      options: {},
      buildInfo: { id: '123' }
    };
  });

  it('forwards labels from options onto comparisonData for POA snapshots', async () => {
    baseArgs.options = {
      sync: false,
      testCase: 'tc',
      labels: 'label1,label2',
      thTestCaseExecutionId: 'exec-1'
    };

    const result = await WebdriverUtils.captureScreenshot(baseArgs);

    expect(result.labels).toEqual('label1,label2');
    expect(result.testCase).toEqual('tc');
    expect(result.thTestCaseExecutionId).toEqual('exec-1');
    expect(result.sync).toEqual(false);
  });

  it('sets labels to undefined when not provided in options', async () => {
    baseArgs.options = { testCase: 'tc' };

    const result = await WebdriverUtils.captureScreenshot(baseArgs);

    expect(result.labels).toBeUndefined();
    expect(result.testCase).toEqual('tc');
  });

  it('does not lose labels even when provider response has none', async () => {
    baseArgs.options = { labels: 'only-label' };

    const result = await WebdriverUtils.captureScreenshot(baseArgs);

    expect(result.labels).toEqual('only-label');
  });

  it('forwards labels through the playwright provider too', async () => {
    spyOn(PlaywrightProvider.prototype, 'createDriver').and.resolveTo();
    spyOn(PlaywrightProvider.prototype, 'screenshot').and.resolveTo({
      name: 'snap', tag: { name: 'pw' }, tiles: [], metadata: {}
    });

    baseArgs.framework = 'playwright';
    baseArgs.options = { labels: 'pw-label' };

    const result = await WebdriverUtils.captureScreenshot(baseArgs);

    expect(result.labels).toEqual('pw-label');
  });

  it('re-throws errors from the provider without setting labels', async () => {
    providerStub.screenshot.and.rejectWith(new Error('boom'));
    baseArgs.options = { labels: 'x' };

    await expectAsync(WebdriverUtils.captureScreenshot(baseArgs))
      .toBeRejectedWithError('boom');
  });
});
