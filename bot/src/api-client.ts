import { randomUUID } from 'node:crypto';

export interface BotEvent {
  id: string;
  title: string;
  category: string;
  date_start: string | null;
  date_end: string | null;
  city: string;
  city_id: string;
  venue: string;
  address: string | null;
  description: string;
  price_min: number | null;
  price_max: number | null;
  is_free: boolean;
  age_limit: number | null;
  source_url: string;
  org_link: string | null;
  status: 'published' | 'draft' | 'cancelled';
  time_precision?: 'minute' | 'date';
  occurrences?: Array<{
    id: string;
    date_start: string;
    date_end: string | null;
    status: string;
    availability: string;
  }>;
}

export interface EventListResponse {
  items: BotEvent[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  relaxations?: Array<{ label: string | { ru: string; ba?: string } }>;
}

export interface SubscriptionItem {
  id: string;
  channel: 'telegram' | 'web';
  user_ref: string;
  city: string | null;
  category: string | null;
  period: string | null;
  created_at: string;
}

export interface AssistantQueryResponse {
  action: 'search' | 'clarify' | 'out_of_scope' | 'confirmation_required';
  message: string;
  constraints: Record<string, unknown>;
  clarify?: {
    code: string;
    pending: string[];
    question: string;
    quick_replies: string[];
  };
  confirmation?: {
    confirmation_id: string;
    summary: string;
    expires_at: string;
  };
  results?: Array<{
    event: BotEvent;
    occurrence_id: string;
    reasons: string[];
    caveats: string[];
  }>;
  total?: number;
  relaxations?: Array<{ label: string | { ru: string; ba?: string } }>;
  trace_id?: string;
  engine: string;
}

export interface AssistantConfirmResponse {
  status: string;
  message?: string;
  subscription_id?: string;
  feedback_id?: string;
}

export class ApiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface EventsSearchParams {
  city?: string;
  category?: string;
  date?: string;
  free?: boolean;
  q?: string;
  page?: number;
  page_size?: number;
}

export class BackendApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly defaultTimeoutMs = 6000,
    private readonly assistantTimeoutMs = 12000,
  ) {}

  private async request<T>(
    path: string,
    init: RequestInit = {},
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(init.headers);
      if (!headers.has('X-Request-Id')) headers.set('X-Request-Id', randomUUID());

      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (res.status === 204) {
        return undefined as T;
      }

      const text = await res.text();
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

      if (!res.ok) {
        throw new ApiHttpError(
          res.status,
          typeof body.code === 'string' ? body.code : `http_${res.status}`,
          typeof body.message === 'string' ? body.message : `Ошибка API (${res.status})`,
        );
      }
      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }

  getEvents(params: EventsSearchParams): Promise<EventListResponse> {
    const qs = new URLSearchParams();
    if (params.city) qs.set('city', params.city);
    if (params.category) qs.set('category', params.category);
    if (params.date) qs.set('date', params.date);
    if (params.free) qs.set('free', 'true');
    if (params.q) qs.set('q', params.q);
    if (params.page) qs.set('page', String(params.page));
    qs.set('page_size', String(params.page_size ?? 5));
    return this.request<EventListResponse>(`/api/v1/events?${qs.toString()}`);
  }

  getEvent(id: string): Promise<BotEvent> {
    return this.request<BotEvent>(`/api/v1/events/${encodeURIComponent(id)}`);
  }

  createSubscription(payload: {
    user_ref: string;
    city?: string | null;
    category?: string | null;
    period?: string | null;
  }): Promise<SubscriptionItem> {
    return this.request<SubscriptionItem>('/api/v1/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'telegram',
        user_ref: payload.user_ref,
        city: payload.city ?? null,
        category: payload.category ?? null,
        period: payload.period ?? 'weekend',
      }),
    });
  }

  getSubscriptions(userRef: string): Promise<{ items: SubscriptionItem[] }> {
    return this.request<{ items: SubscriptionItem[] }>(
      `/api/v1/subscriptions?user_ref=${encodeURIComponent(userRef)}`,
    );
  }

  deleteSubscription(id: string, userRef: string): Promise<void> {
    return this.request<void>(
      `/api/v1/subscriptions/${encodeURIComponent(id)}?user_ref=${encodeURIComponent(userRef)}`,
      { method: 'DELETE' },
    );
  }

  queryAssistant(payload: {
    message: string;
    user_ref: string;
    previous?: Record<string, unknown>;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    answering?: string;
    limit?: number;
  }): Promise<AssistantQueryResponse> {
    return this.request<AssistantQueryResponse>(
      '/api/v1/assistant/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          channel: 'telegram',
        }),
      },
      this.assistantTimeoutMs,
    );
  }

  confirmAssistant(payload: {
    confirmation_id: string;
    decision: 'approve' | 'reject';
  }): Promise<AssistantConfirmResponse> {
    return this.request<AssistantConfirmResponse>(
      '/api/v1/assistant/confirm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation_id: payload.confirmation_id,
          confirm: payload.decision === 'approve',
          decision: payload.decision,
        }),
      },
      this.assistantTimeoutMs,
    );
  }

  getHealth(): Promise<{ status: string }> {
    return this.request<{ status: string }>('/api/v1/health');
  }
}
