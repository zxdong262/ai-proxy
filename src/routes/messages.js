/**
 * POST /v1/messages — Anthropic-compatible endpoint.
 *
 * Accepts Anthropic Messages API requests, converts to OpenAI chat completions,
 * forwards to the remote service, and converts the response back.
 */

import { Router } from "express";
import https from "node:https";
import http from "node:http";
import {
  anthropicToOpenAI,
  openAIToAnthropic,
  openAIChunkToAnthropicEvents,
} from "../converter.js";

const router = Router();

/**
 * Forward the converted request to the remote OpenAI-compatible API.
 * Uses service config from req._serviceConfig for URL and auth.
 */
async function callRemote(openaiBody, serviceConfig, passthroughToken) {
  const endpoint = serviceConfig.messages_endpoint || "/chat/completions";
  const url = new URL(`${serviceConfig.remote_api_url}${endpoint}`);
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;

  const apiKey = serviceConfig.api_key || passthroughToken;
  const payload = JSON.stringify(openaiBody);

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => resolve(res)
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Handle non-streaming response.
 */
async function handleNonStreaming(req, res) {
  try {
    const openaiBody = anthropicToOpenAI(req.body);
    const upstreamRes = await callRemote(openaiBody, req._serviceConfig, req._passthroughToken);

    let data = "";
    for await (const chunk of upstreamRes) {
      data += chunk;
    }

    if (upstreamRes.statusCode !== 200) {
      return res.status(upstreamRes.statusCode).json({
        type: "error",
        error: {
          type: "api_error",
          message: `Upstream returned ${upstreamRes.statusCode}: ${data}`,
        },
      });
    }

    const openaiRes = JSON.parse(data);
    const anthropicRes = openAIToAnthropic(openaiRes, req.body.model);
    return res.json(anthropicRes);
  } catch (err) {
    return res.status(500).json({
      type: "error",
      error: { type: "api_error", message: err.message },
    });
  }
}

/**
 * Handle streaming response — convert OpenAI SSE chunks to Anthropic SSE events.
 */
async function handleStreaming(req, res) {
  try {
    const openaiBody = anthropicToOpenAI(req.body);
    openaiBody.stream = true;

    const upstreamRes = await callRemote(openaiBody, req._serviceConfig, req._passthroughToken);

    if (upstreamRes.statusCode !== 200) {
      let data = "";
      for await (const chunk of upstreamRes) data += chunk;
      return res.status(upstreamRes.statusCode).json({
        type: "error",
        error: {
          type: "api_error",
          message: `Upstream returned ${upstreamRes.statusCode}: ${data}`,
        },
      });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const state = { started: false, outputTokens: 0, model: req.body.model };
    let buffer = "";

    for await (const chunk of upstreamRes) {
      buffer += chunk.toString();

      // Parse SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const payload = trimmed.slice(6);
        if (payload === "[DONE]") continue;

        try {
          const openaiChunk = JSON.parse(payload);
          const events = openAIChunkToAnthropicEvents(openaiChunk, state);
          for (const evt of events) {
            res.write(`event: ${evt.event}\ndata: ${evt.data}\n\n`);
          }
        } catch {
          // skip unparseable chunks
        }
      }
    }

    res.end();
  } catch (err) {
    if (!res.headersSent) {
      return res.status(500).json({
        type: "error",
        error: { type: "api_error", message: err.message },
      });
    }
    res.end();
  }
}

router.post("/", (req, res) => {
  if (req.body.stream) {
    return handleStreaming(req, res);
  }
  return handleNonStreaming(req, res);
});

export default router;
