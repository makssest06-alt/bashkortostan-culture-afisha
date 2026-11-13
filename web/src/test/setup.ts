/**
 * Тесты не трогают рабочее хранилище админки: у каждого прогона свой файл во временной папке.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.AFISHA_DATA_FILE = path.join(mkdtempSync(path.join(tmpdir(), 'afisha-test-')), 'admin-state.json');
