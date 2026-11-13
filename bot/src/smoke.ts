import { ApiError, createApiClient } from './api/client.js';
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

  const list = await client.searchEvents({ page_size: 5, sort: 'date' });
  pass(`events: total=${list.total}, page=${list.page}/${Math.max(1, list.total_pages)}`);
  const first = list.items[0];
  if (!first) throw new Error('GET /events вернул пустую выдачу — проверьте seed базы');

  const card = await client.getEvent(first.id);
  if (card.id !== first.id) throw new Error('GET /events/{id} вернул другое событие');
  pass(`event card: ${card.title}`);
  console.log(formatEventCard(card).split('\n').slice(0, 3).join('\n'));

  const userRef = `smoke_${Date.now()}`;
  const subscription = await client.createSubscription({
    channel: 'telegram',
    user_ref: userRef,
    city: cities[0]?.id ?? null,
    category: categories[0]?.id ?? null,
    period: 'week',
  });
  pass(`subscription created: ${formatSubscription(subscription)}`);

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
