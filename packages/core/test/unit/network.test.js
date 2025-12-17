import { saveResponseResource } from '../../src/network.js';
import logger from '@percy/logger';
import * as clientUtils from '@percy/client/utils';
import * as utils from '../../src/utils.js';

describe('Network - Google Fonts MIME type handling', () => {
  let network, session, mockLog;

  beforeEach(() => {
    mockLog = logger('test');
    spyOn(mockLog, 'debug');

    network = {
      log: mockLog,
      meta: { snapshotName: 'test' },
      intercept: {
        disableCache: true,
        allowedHostnames: ['fonts.gstatic.com'],
        enableJavaScript: true,
        getResource: () => null,
        saveResource: jasmine.createSpy('saveResource')
      }
    };

    session = {
      send: jasmine.createSpy('send').and.returnValue(Promise.resolve({ cookies: [] }))
    };

    // Mock makeRequest to return a valid font buffer
    spyOn(clientUtils, 'request').and.returnValue(
      Promise.resolve(Buffer.from('wOF2\x00\x01\x00\x00font data', 'binary'))
    );

    // Mock createResource to return a valid resource object
    spyOn(utils, 'createResource').and.returnValue({
      url: 'https://fonts.gstatic.com/font.woff2',
      content: 'mock',
      sha: 'mock-sha',
      mimetype: 'font/woff2'
    });
  });

  it('should detect WOFF2 format and override mime type for Google Fonts', async () => {
    const woff2Buffer = Buffer.from('wOF2\x00\x01\x00\x00font data', 'binary');
    
    const request = {
      url: 'https://fonts.gstatic.com/s/roboto/v30/font.woff2',
      type: 'Font',
      headers: {},
      redirectChain: [],
      response: {
        status: 200,
        mimeType: 'text/html',
        headers: {},
        buffer: () => Promise.resolve(woff2Buffer)
      }
    };

    await saveResponseResource(network, request, session);

    expect(mockLog.debug).toHaveBeenCalledWith(
      jasmine.stringContaining('Detected Google Font as font/woff2 from content'),
      jasmine.any(Object)
    );
  });

  it('should fallback to application/font-woff2 when format cannot be detected', async () => {
    const unknownBuffer = Buffer.from('UNKN\x00\x01\x00\x00data', 'binary');
    
    const request = {
      url: 'https://fonts.gstatic.com/s/roboto/v30/font.unknown',
      type: 'Font',
      headers: {},
      redirectChain: [],
      response: {
        status: 200,
        mimeType: 'text/html',
        headers: {},
        buffer: () => Promise.resolve(unknownBuffer)
      }
    };

    await saveResponseResource(network, request, session);

    expect(mockLog.debug).toHaveBeenCalledWith(
      '- Google Font detected but format unclear, treating as font',
      jasmine.any(Object)
    );
  });

  it('should not override mime type when already correct', async () => {
    const woffBuffer = Buffer.from('wOFF\x00\x01\x00\x00font data', 'binary');
    
    const request = {
      url: 'https://fonts.gstatic.com/s/roboto/v30/font.woff',
      type: 'Font',
      headers: {},
      redirectChain: [],
      response: {
        status: 200,
        mimeType: 'font/woff',
        headers: {},
        buffer: () => Promise.resolve(woffBuffer)
      }
    };

    await saveResponseResource(network, request, session);

    expect(mockLog.debug).not.toHaveBeenCalledWith(
      jasmine.stringContaining('Detected Google Font as'),
      jasmine.any(Object)
    );
    expect(mockLog.debug).not.toHaveBeenCalledWith(
      '- Google Font detected but format unclear, treating as font',
      jasmine.any(Object)
    );
  });
});
