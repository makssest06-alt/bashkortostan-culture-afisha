const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 1.5, 2.5, 5.0];

export class MetricsRegistry {
  private readonly httpRequests = new Map<string, number>();
  private readonly histCounts = new Map<string, number[]>();
  private readonly histSum = new Map<string, number>();
  private readonly histTotal = new Map<string, number>();
  private readonly feedbackTotal = new Map<string, number>();
  private readonly importRowsTotal = new Map<string, number>();
  private readonly assistantTotal = new Map<string, number>();

  observeHttp(method: string, route: string, status: number, durationSeconds: number): void {
    const key = `${method}|${route}|${status}`;
    this.httpRequests.set(key, (this.httpRequests.get(key) ?? 0) + 1);

    const hKey = `${method}|${route}`;
    let buckets = this.histCounts.get(hKey);
    if (!buckets) {
      buckets = new Array<number>(DURATION_BUCKETS.length).fill(0);
      this.histCounts.set(hKey, buckets);
    }
    for (let i = 0; i < DURATION_BUCKETS.length; i += 1) {
      if (durationSeconds <= DURATION_BUCKETS[i]) buckets[i] += 1;
    }
    this.histSum.set(hKey, (this.histSum.get(hKey) ?? 0) + durationSeconds);
    this.histTotal.set(hKey, (this.histTotal.get(hKey) ?? 0) + 1);
  }

  incFeedback(status: 'accepted' | 'honeypot' | 'rate_limited' | 'invalid'): void {
    this.feedbackTotal.set(status, (this.feedbackTotal.get(status) ?? 0) + 1);
  }

  incImportRows(outcome: 'added' | 'updated' | 'merged' | 'unchanged' | 'rejected', count = 1): void {
    if (count <= 0) return;
    this.importRowsTotal.set(outcome, (this.importRowsTotal.get(outcome) ?? 0) + count);
  }

  incAssistant(engine: string, action: string): void {
    const key = `${engine}|${action}`;
    this.assistantTotal.set(key, (this.assistantTotal.get(key) ?? 0) + 1);
  }

  formatPrometheus(): string {
    const lines: string[] = [
      '# HELP http_requests_total Total HTTP requests handled by route and status.',
      '# TYPE http_requests_total counter',
    ];
    for (const [key, val] of this.httpRequests.entries()) {
      const [method, route, status] = key.split('|');
      lines.push(`http_requests_total{method="${method}",route="${route}",status="${status}"} ${val}`);
    }

    lines.push('# HELP http_request_duration_seconds HTTP request latency histogram.');
    lines.push('# TYPE http_request_duration_seconds histogram');
    for (const [key, buckets] of this.histCounts.entries()) {
      const [method, route] = key.split('|');
      for (let i = 0; i < DURATION_BUCKETS.length; i += 1) {
        lines.push(`http_request_duration_seconds_bucket{method="${method}",route="${route}",le="${DURATION_BUCKETS[i]}"} ${buckets[i]}`);
      }
      const total = this.histTotal.get(key) ?? 0;
      const sum = (this.histSum.get(key) ?? 0).toFixed(6);
      lines.push(`http_request_duration_seconds_bucket{method="${method}",route="${route}",le="+Inf"} ${total}`);
      lines.push(`http_request_duration_seconds_sum{method="${method}",route="${route}"} ${sum}`);
      lines.push(`http_request_duration_seconds_count{method="${method}",route="${route}"} ${total}`);
    }

    lines.push('# HELP afisha_feedback_total Feedback submissions grouped by outcome.');
    lines.push('# TYPE afisha_feedback_total counter');
    for (const [status, val] of this.feedbackTotal.entries()) {
      lines.push(`afisha_feedback_total{outcome="${status}"} ${val}`);
    }

    lines.push('# HELP afisha_import_rows_total Imported rows grouped by outcome.');
    lines.push('# TYPE afisha_import_rows_total counter');
    for (const [outcome, val] of this.importRowsTotal.entries()) {
      lines.push(`afisha_import_rows_total{outcome="${outcome}"} ${val}`);
    }

    lines.push('# HELP afisha_assistant_queries_total Assistant queries grouped by engine and action.');
    lines.push('# TYPE afisha_assistant_queries_total counter');
    for (const [key, val] of this.assistantTotal.entries()) {
      const [engine, action] = key.split('|');
      lines.push(`afisha_assistant_queries_total{engine="${engine}",action="${action}"} ${val}`);
    }

    return `${lines.join('\n')}\n`;
  }
}
