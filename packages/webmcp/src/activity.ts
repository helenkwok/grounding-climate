import type {
  ActivityEvent,
  ActivitySink,
} from "./types.js";

export class ActivityLog {
  private readonly entries: ActivityEvent[] = [];

  sink: ActivitySink = (event) => {
    this.entries.push(structuredClone(event));
  };

  list(): ActivityEvent[] {
    return this.entries.map((event) => structuredClone(event));
  }

  clear(): void {
    this.entries.length = 0;
  }
}
