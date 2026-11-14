/**
 * GET  /api/v1/admin/imports: история импортов с отчётами (последние 50).
 * POST /api/v1/admin/imports: импорт CSV или JSON. Тело: файл как text/csv или application/json,
 *      либо multipart/form-data с полем file. Имя файла: поле формы или параметр ?file_name=.
 *      Ответ: отчёт «добавлено, обновлено, источников добавлено, без изменений, отклонено и почему».
 */

import { MAX_IMPORT_BYTES, detectFormat } from '../../../../../lib/admin/import';
import { withAdmin } from '../../../../../lib/admin/route-kit';
import { listImports, runImport } from '../../../../../lib/admin/service';
import { errorResponse, json, methodNotAllowed, preflightAdmin } from '../../../../../lib/api/http';

const TOO_BIG = `Файл больше ${MAX_IMPORT_BYTES / 1024 / 1024} МБ. Разбейте его на части`;

export function GET(request: Request): Promise<Response> {
  return withAdmin(request, ({ requestId }) => json({ items: listImports() }, { requestId }));
}

export function POST(request: Request): Promise<Response> {
  return withAdmin(request, async ({ requestId, actor }) => {
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > MAX_IMPORT_BYTES + 64 * 1024) return errorResponse(413, 'payload_too_large', TOO_BIG, undefined, { requestId });

    const contentType = request.headers.get('content-type') ?? '';
    const url = new URL(request.url);
    let text = '';
    let fileName: string | null = url.searchParams.get('file_name')?.slice(0, 200) ?? null;
    let fileType: string | null = contentType;
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return errorResponse(400, 'validation_error', 'Выберите файл CSV или JSON', [{ field: 'file', message: 'Выберите файл CSV или JSON' }], {
          requestId,
        });
      }
      if (file.size > MAX_IMPORT_BYTES) return errorResponse(413, 'payload_too_large', TOO_BIG, undefined, { requestId });
      text = await file.text();
      fileName = file.name.slice(0, 200) || fileName;
      fileType = file.type;
    } else {
      text = await request.text();
    }
    if (text.length > MAX_IMPORT_BYTES) return errorResponse(413, 'payload_too_large', TOO_BIG, undefined, { requestId });

    const format = detectFormat(text, fileName, fileType);
    const result = runImport(text, { format, fileName }, actor);
    if (!result.ok) {
      const code = result.code === 'invalid_json' ? 'invalid_json' : result.code === 'too_many_rows' ? 'payload_too_large' : 'validation_error';
      return errorResponse(code === 'payload_too_large' ? 413 : 400, code, result.message, [{ field: 'file', message: result.message }], {
        requestId,
      });
    }
    return json(result.report, { requestId });
  });
}

export function OPTIONS(): Response {
  return preflightAdmin();
}

const notAllowed = methodNotAllowed('GET, POST, OPTIONS');

export { notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
