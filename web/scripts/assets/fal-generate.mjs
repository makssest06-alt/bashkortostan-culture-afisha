// Генерация сцен через fal.ai (очередь queue.fal.run) с жёстким счётчиком бюджета.
//
//   NODE_USE_ENV_PROXY=1 node --env-file=.env.assets scripts/assets/fal-generate.mjs gen <ключ> [seed]
//   node scripts/assets/fal-generate.mjs promote <ключ> <номер генерации> [gravity]
//   node scripts/assets/fal-generate.mjs status
//
// Промпты и размеры: fal-prompts.json. Журнал: fal-ledger.json (без ключей).
// Каждая принятая очередью заявка считается генерацией. Выше бюджета скрипт не идёт.
// Код выхода 2 = ключ не принят (401/403): генерацию прекратить.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, WORK_DIR, averageColor, download, ensureDir, fail, http, log, publicPathToFile, readJson, requireKey, toWebp, warnProxy, writeJson } from './lib.mjs';

const CONFIG_FILE = join(HERE, 'fal-prompts.json');
const LEDGER_FILE = join(HERE, 'fal-ledger.json');
const config = readJson(CONFIG_FILE, null);
if (!config) fail('нет fal-prompts.json');

const loadLedger = () => readJson(LEDGER_FILE, { model: config.model, budget: config.budget, generations: [] });
const saveLedger = (ledger) => writeJson(LEDGER_FILE, ledger);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const [command, key, arg3, arg4] = process.argv.slice(2);

if (command === 'status') {
  const ledger = loadLedger();
  log(`Модель: ${ledger.model}. Генераций: ${ledger.generations.length} из ${ledger.budget}.`);
  for (const g of ledger.generations) {
    log(`#${g.n} ${g.key} ${g.width}x${g.height} seed=${g.seed} ${g.status}${g.chosen ? ' ВЫБРАНА' : ''}`);
  }
  process.exit(0);
}

const item = config.items[key];
if (!item) fail(`неизвестный ключ "${key}". Есть: ${Object.keys(config.items).join(', ')}`);

if (command === 'promote') {
  const ledger = loadLedger();
  const n = Number(arg3);
  const generation = ledger.generations.find((g) => g.n === n && g.key === key);
  if (!generation) fail(`генерации #${n} для "${key}" нет в журнале`);
  // В журнале путь к сырому файлу хранится относительно WORK_DIR, чтобы в репозиторий не попадали локальные пути.
  const rawFile = generation.raw ? join(WORK_DIR, generation.raw) : '';
  if (!rawFile || !existsSync(rawFile)) fail(`нет сырого файла генерации #${n} в ASSETS_WORK_DIR: ${generation.raw}`);
  const dest = publicPathToFile(item.target);
  const result = toWebp({ src: rawFile, dest, aspect: item.aspect, longSide: item.long_side, gravity: arg4 || 'center' });
  const next = {
    ...ledger,
    generations: ledger.generations.map((g) => (g.key === key ? { ...g, chosen: g.n === n } : g)),
  };
  saveLedger(next);
  log(`${item.target}: ${result.width}x${result.height}, средний цвет ${averageColor(dest)} (генерация #${n})`);
  process.exit(0);
}

if (command !== 'gen') fail('команды: gen <ключ> [seed] | promote <ключ> <номер> [gravity] | status');

warnProxy();
const falKey = requireKey('FAL_KEY');
const headers = { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' };

let ledger = loadLedger();
if (ledger.generations.length >= ledger.budget) fail(`бюджет исчерпан: ${ledger.generations.length} из ${ledger.budget}`);

const seed = arg3 ? Number(arg3) : Math.floor(Math.random() * 2_000_000_000);
const input = {
  prompt: item.prompt,
  image_size: { width: item.width, height: item.height },
  seed,
  output_format: 'png',
};

const submit = await http(`https://queue.fal.run/${config.model}`, { method: 'POST', headers, body: input });
if (submit.status === 401 || submit.status === 403) {
  console.error(`КЛЮЧ FAL НЕ ПРИНЯТ: HTTP ${submit.status}. ${submit.text}`);
  process.exit(2);
}
if (!submit.ok || !submit.json?.request_id) fail(`fal не принял заявку: HTTP ${submit.status}. ${submit.text}`);

const n = ledger.generations.length + 1;
const record = {
  n,
  key,
  model: config.model,
  request_id: submit.json.request_id,
  seed,
  width: item.width,
  height: item.height,
  prompt: item.prompt,
  status: 'SUBMITTED',
  at: new Date().toISOString(),
};
ledger = { ...ledger, generations: [...ledger.generations, record] };
saveLedger(ledger);
log(`#${n} ${key}: заявка принята (${n} из ${ledger.budget}), seed=${seed}`);

const update = (patch) => {
  ledger = { ...ledger, generations: ledger.generations.map((g) => (g.n === n ? { ...g, ...patch } : g)) };
  saveLedger(ledger);
};

const statusUrl = submit.json.status_url || `https://queue.fal.run/${config.model}/requests/${record.request_id}/status`;
const resultUrl = submit.json.response_url || `https://queue.fal.run/${config.model}/requests/${record.request_id}`;

const deadline = Date.now() + 6 * 60 * 1000;
let state = 'IN_QUEUE';
while (Date.now() < deadline) {
  await sleep(2500);
  let poll;
  try {
    poll = await http(statusUrl, { headers, timeoutMs: 30000 });
  } catch (error) {
    log(`  опрос: ${error.message}`);
    continue;
  }
  if (!poll.ok) {
    log(`  опрос: HTTP ${poll.status} ${poll.text}`);
    continue;
  }
  state = poll.json?.status || state;
  if (state === 'COMPLETED') break;
}
if (state !== 'COMPLETED') {
  update({ status: `TIMEOUT_${state}` });
  fail(`#${n} не завершилась за 6 минут (состояние ${state}); заявка сохранена в журнале, результат можно забрать позже`);
}

const result = await http(resultUrl, { headers, timeoutMs: 60000 });
const image = result.json?.images?.[0];
if (!result.ok || !image?.url) {
  update({ status: 'FAILED', error: result.text });
  fail(`#${n}: нет изображения в ответе: HTTP ${result.status}. ${result.text}`);
}

const rawRelative = join('fal', `${key}-${n}.png`);
const raw = join(ensureDir(join(WORK_DIR, 'fal')), `${key}-${n}.png`);
const bytes = await download(image.url, raw);
update({ status: 'COMPLETED', raw: rawRelative, result_seed: result.json.seed ?? seed, bytes });
log(`#${n} ${key}: готово, ${Math.round(bytes / 1024)} КБ -> ${raw}`);
