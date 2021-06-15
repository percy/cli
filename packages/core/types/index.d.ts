// utility types
type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };
type XOR<T, U> = (T | U) extends object ? (Without<T, U> & U) | (Without<U, T> & T) : T | U;

type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'silent';

interface Pojo {
  [x: string]: any;
}

interface AuthCredentials {
  username: string;
  password: string;
}

interface DiscoveryOptions {
  requestHeaders?: Pojo;
  authorization?: AuthCredentials;
  allowedHostnames?: string[];
  disableCache?: boolean;
}

interface DiscoveryLaunchOptions {
  executable?: string;
  args?: string[];
  timeout?: number;
  headless?: boolean;
}

interface AllDiscoveryOptions extends DiscoveryOptions {
  networkIdleTimeout?: number;
  concurrency?: number;
  launchOptions?: DiscoveryLaunchOptions;
}

interface CommonSnapshotOptions {
  widths?: number[];
  minHeight?: number;
  percyCSS?: string;
  enableJavaScript?: boolean;
}

export interface SnapshotOptions extends CommonSnapshotOptions {
  discovery?: DiscoveryOptions;
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
  snapshot?: CommonSnapshotOptions,
  discovery?: AllDiscoveryOptions
};

type SnapshotExec = () => void | Promise<void>;

type AdditionalSnapshot = (XOR<XOR<
  { name: string },
  { prefix: string, suffix?: string }>,
  { suffix: string, prefix?: string }>
) & { execute: SnapshotExec };

declare class Percy {
  static start(options?: PercyOptions): Promise<Percy>;
  constructor(options?: PercyOptions);
  loglevel(): LogLevel;
  loglevel(level: LogLevel): void;
  start(): Promise<void>;
  stop(force?: boolean): Promise<void>;
  idle(): Promise<void>;
  close(): void;

  snapshot(options: {
    url: string,
    name?: string,
    clientInfo?: string,
    environmentInfo?: string
  } & XOR<{
    domSnapshot: string
  }, {
    waitForTimeout?: number,
    waitForSelector?: string,
    execute?: SnapshotExec,
    additionalSnapshots?: AdditionalSnapshot[]
  }> & SnapshotOptions): Promise<void>;
}

export default Percy;
