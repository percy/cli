/// <reference lib="dom"/>
import * as Puppeteer from 'puppeteer-core/lib/cjs/puppeteer/common/Page';

type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'silent';
interface Pojo { [x: string]: any; }

export interface SnapshotOptions {
  widths?: number[];
  minHeight?: number;
  percyCSS?: string;
  requestHeaders?: Pojo;
  enableJavaScript?: boolean;
}

interface DiscoveryOptions {
  allowedHostnames?: string[];
  networkIdleTimeout?: number;
  disableCache?: boolean;
  concurrency?: number;
  launchOptions?: Pojo;
}

export type PercyOptions<C = Pojo> = C & {
  token?: string,
  clientInfo?: string,
  environmentInfo?: string,
  server?: boolean,
  port?: number,
  concurrency?: number,
  loglevel?: LogLevel,
  config?: undefined | string | false,
  snapshot?: SnapshotOptions,
  discovery?: DiscoveryOptions
};

type CaptureExec = (page: Puppeteer.Page) => Promise<void>;
type CaptureSnapshots = Array<{ name: string, execute: CaptureExec }>;

declare class Percy {
  static start(options?: PercyOptions): Promise<Percy>;
  constructor(options?: PercyOptions);
  loglevel(): LogLevel;
  loglevel(level: LogLevel): void;
  isRunning(): boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  idle(): Promise<void>;

  snapshot(options: SnapshotOptions & {
    url: string,
    name: string,
    domSnapshot: string,
    clientInfo?: string,
    environmentInfo?: string
  }): Promise<void>;

  capture(options: SnapshotOptions & ({
    url: string,
    name: string,
    snapshots?: CaptureSnapshots,
    waitForTimeout?: number,
    waitForSelector?: string,
    execute?: CaptureExec,
  } | {
    url: string,
    snapshots: CaptureSnapshots,
    waitForTimeout?: number,
    waitForSelector?: string,
    execute?: CaptureExec
  })): Promise<void>;
}

export default Percy;
