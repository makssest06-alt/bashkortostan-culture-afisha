import { createHash, randomBytes } from 'node:crypto';

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSession {
  userRef: string;
  city: string | null;
  category: string | null;
  period: 'today' | 'tomorrow' | 'weekend' | 'week' | null;
  freeOnly: boolean;
  page: number;
  lastConstraints?: Record<string, unknown>;
  lastClarifyCode?: string;
  quickReplies: string[];
  history: HistoryTurn[];
  eventRefs: Map<string, string>;
  subRefs: Map<string, string>;
  pendingConfirmations: Map<string, { confirmationId: string; resolved: boolean }>;
}

const MAX_HISTORY_TURNS = 10;

export function makeUserRef(chatId: number | string): string {
  const hash = createHash('sha256').update(`tg:${String(chatId)}`).digest('hex').slice(0, 24);
  return `tg_${hash}`;
}

export class SessionStore {
  private readonly sessions = new Map<string, ChatSession>();

  get(chatId: number | string): ChatSession {
    const key = String(chatId);
    let session = this.sessions.get(key);
    if (!session) {
      session = {
        userRef: makeUserRef(key),
        city: null,
        category: null,
        period: null,
        freeOnly: false,
        page: 1,
        quickReplies: [],
        history: [],
        eventRefs: new Map(),
        subRefs: new Map(),
        pendingConfirmations: new Map(),
      };
      this.sessions.set(key, session);
    }
    return session;
  }

  reset(chatId: number | string): ChatSession {
    const fresh: ChatSession = {
      userRef: makeUserRef(chatId),
      city: null,
      category: null,
      period: null,
      freeOnly: false,
      page: 1,
      quickReplies: [],
      history: [],
      eventRefs: new Map(),
      subRefs: new Map(),
      pendingConfirmations: new Map(),
    };
    this.sessions.set(String(chatId), fresh);
    return fresh;
  }

  pushHistory(session: ChatSession, role: 'user' | 'assistant', content: string): void {
    const trimmed = content.trim().slice(0, 480);
    if (!trimmed) return;
    session.history.push({ role, content: trimmed });
    if (session.history.length > MAX_HISTORY_TURNS) {
      session.history = session.history.slice(-MAX_HISTORY_TURNS);
    }
  }

  registerEventRef(session: ChatSession, eventId: string): string {
    for (const [token, existing] of session.eventRefs.entries()) {
      if (existing === eventId) return token;
    }
    const token = randomBytes(4).toString('hex');
    if (session.eventRefs.size >= 100) {
      const firstKey = session.eventRefs.keys().next().value;
      if (firstKey) session.eventRefs.delete(firstKey);
    }
    session.eventRefs.set(token, eventId);
    return token;
  }

  registerSubRef(session: ChatSession, subId: string): string {
    for (const [token, existing] of session.subRefs.entries()) {
      if (existing === subId) return token;
    }
    const token = randomBytes(4).toString('hex');
    session.subRefs.set(token, subId);
    return token;
  }

  registerConfirmation(session: ChatSession, confirmationId: string): string {
    const token = randomBytes(4).toString('hex');
    session.pendingConfirmations.set(token, { confirmationId, resolved: false });
    return token;
  }
}
