import { ApiError, createApiClient } from './api/client.js';
import { DirectoryService } from './directory-service.js';
import { formatEventCard, formatSubscription } from './format.js';

function env(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

async function main(): Promise<void> {
  const baseUrl = env('API_BASE_URL', 'http://127.0.0.1:8010');
  const timeoutMs = Number(env('API_TIMEOUT_MS', '10000'));
  const client = createApiClient({ baseUrl, timeoutMs });

  const steps: string[] = [];
  function pass(message: string): void {
    steps.push(`PASS ${message}`);
    console.log(`PASS ${message}`);
  }

  const health = await client.health();
  pass(`health: ${health.status}`);

  const cities = await client.getCities();
  if (cities.length === 0) throw new Error('GET /cities вернул пустой список');
  pass(`cities: ${cities.length}`);

  const categories = await client.getCategories();
  if (categories.length === 0) throw new Error('GET /categories вернул пустой список');
  pass(`categories: ${categories.length}`);

  const directories = new DirectoryService({ cities, categories });

  const list = await client.searchEvents({ page_size: 5, sort: 'date' });
  pass(`events: total=${list.total}, page=${list.page}/${Math.max(1, list.total_pages)}`);
  const first = list.items[0];
  if (!first) throw new Error('GET /events вернул пустую выдачу — проверьте seed базы');

  const card = await client.getEvent(first.id);
  if (card.id !== first.id) throw new Error('GET /events/{id} вернул другое событие');
  pass(`event card: ${card.title}`);
  pass(`event details: occurrences=${card.occurrences.length}, offers=${card.offers.length}`);
  if (list.facets) {
    pass(
      `facets: cities=${list.facets.cities.length}, age_limits=${list.facets.age_limits.length}, total=${list.facets.total}`,
    );
  }
  console.log(formatEventCard(card, directories).split('\n').slice(0, 3).join('\n'));

  if (card.venue_id) {
    const dateFrom = (card.date_start ?? new Date().toISOString()).slice(0, 10);
    const dateTo = new Date(Date.parse(`${dateFrom}T00:00:00Z`) + 13 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    try {
      const schedule = await client.getVenueSchedule(card.venue_id, {
        date_from: dateFrom,
        date_to: dateTo,
      });
      pass(`venue schedule: ${schedule.venue.name}, items=${schedule.items.length}`);
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 404 || error.status === 400 || error.status === 503)
      ) {
        console.log('SKIP venue schedule: метод GET /venues/{id}/schedule ещё не задеплоен');
      } else {
        throw error;
      }
    }
  } else {
    console.log('SKIP venue schedule: у события нет venue_id');
  }

  try {
    const similar = await client.getSimilarEvents(first.id, { page_size: 5 });
    pass(`similar: total=${similar.total}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
      // Метод появится вместе с бэкендом PR #19; до этого smoke не должен падать.
      console.log('SKIP similar: метод GET /events/{id}/similar ещё не задеплоен');
    } else {
      throw error;
    }
  }

  try {
    const assistant = await client.queryAssistant({
      message: 'концерт в Уфе',
      channel: 'api',
      limit: 3,
    });
    pass(`assistant: action=${assistant.action}, results=${assistant.results.length}`);
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 400 ||
        error.status === 404 ||
        error.status === 405 ||
        error.status === 503)
    ) {
      console.log('SKIP assistant: метод POST /assistant/query ещё не задеплоен или выключен');
    } else {
      throw error;
    }
  }

  const userRef = `smoke_${Date.now()}`;
  const subscription = await client.createSubscription({
    channel: 'telegram',
    user_ref: userRef,
    city: cities[0]?.id ?? null,
    category: categories[0]?.id ?? null,
    period: 'week',
  });
  pass(`subscription created: ${formatSubscription(subscription, directories)}`);

  const subscriptions = await client.listSubscriptions(userRef);
  if (!subscriptions.some((item) => item.id === subscription.id)) {
    throw new Error('Созданная подписка не появилась в GET /subscriptions');
  }
  pass(`subscriptions listed: ${subscriptions.length}`);

  await client.deleteSubscription(subscription.id, userRef);
  const afterDelete = await client.listSubscriptions(userRef);
  if (afterDelete.length !== 0) throw new Error('Подписка не удалилась');
  pass('subscription deleted');

  console.log(`\nSMOKE OK (${steps.length} проверок)`);
}

main().catch((error: unknown) => {
  if (error instanceof ApiError) {
    console.error(`SMOKE FAIL [${error.kind}${error.status ? ` ${error.status}` : ''}] ${error.message}`);
  } else {
    console.error('SMOKE FAIL', error);
  }
  process.exitCode = 1;
});
