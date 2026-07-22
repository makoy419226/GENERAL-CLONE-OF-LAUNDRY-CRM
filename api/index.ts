import type { IncomingMessage, ServerResponse } from "http";
import { app, appReady } from "../server/index";

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await appReady;
  return app(request, response);
}
