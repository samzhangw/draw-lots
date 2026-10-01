export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Only application validation errors expose their deliberately written public message. */
export function publicError(err: unknown, requestId: string) {
  let status = 500;
  let message = '伺服器發生錯誤，請稍後再試。';
  if (err instanceof ApiError && Number.isInteger(err.status) && err.status >= 400 && err.status <= 599) {
    status = err.status;
    if (status < 500) message = err.message;
    else if (status === 503) message = '服務暫時無法使用，請稍後再試。';
  } else if (err && typeof err === 'object' && 'type' in err) {
    // Body-parser exceptions may contain the submitted body; never serialize them.
    if (err.type === 'entity.parse.failed') {
      status = 400;
      message = '請使用有效的 JSON 物件。';
    } else if (err.type === 'entity.too.large') {
      status = 413;
      message = '請求資料過大，請縮小後再試。';
    }
  }
  return { status, body: { success: false, error: message, requestId } };
}
