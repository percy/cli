// Minimum TypeScript Version: 3.8
import 'puppeteer-core/lib/externs';

type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'silent';
interface Pojo { [x: string]: any; }

export interface SnapshotOptions {
  widths?: number[];
  minimumHeight?: number;
  percyCSS?: string;
  requestHeaders?: Pojo;
  enableJavaScript?: boolean;
}

interface DiscoveryOptions {
  allowedHostnames?: string[];
  networkIdleTimeout?: number;
  disableAssetCache?: boolean;
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
    waitFor?: string | number,
    execute?: CaptureExec,
  } | {
    url: string,
    snapshots: CaptureSnapshots,
    waitFor?: string | number,
    execute?: CaptureExec
  })): Promise<void>;
}

export default Percy;
