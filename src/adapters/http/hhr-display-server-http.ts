import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  DISPLAY_DELIVERY_HTTP_PATH,
  type DisplayDeliveryHttpHandler,
} from './github-actions-display-delivery-http.js';
import type { HhrDisplayAppHttpHandler } from './hhr-display-app-http.js';

function requestPath(request: IncomingMessage): string | null {
  if (request.url === undefined) return null;
  try {
    return new URL(request.url, 'http://localhost').pathname;
  } catch {
    return null;
  }
}

export function createHhrDisplayServerHttpHandler(options: Readonly<{
  appHandler: HhrDisplayAppHttpHandler;
  deliveryHandler?: DisplayDeliveryHttpHandler;
}>): HhrDisplayAppHttpHandler {
  return (request: IncomingMessage, response: ServerResponse): void => {
    if (requestPath(request) === DISPLAY_DELIVERY_HTTP_PATH && options.deliveryHandler !== undefined) {
      options.deliveryHandler(request, response);
      return;
    }
    options.appHandler(request, response);
  };
}
