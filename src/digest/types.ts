/** One job's summary for a night. Times retain the offsets from the log. */
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: 'ok' | 'retry' | 'fail';
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

/** The parsed rows and the number of lines that could not be parsed. */
export type NightDigest = {
  rows: DigestRow[];
  badLines: number;
};

/** Contract for readNight; null means the requested night has no file. */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
