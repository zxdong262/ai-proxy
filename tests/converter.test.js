import { describe, test, expect } from "vitest";
import {
  extractText,
  convertContent,
  anthropicToOpenAI,
  mapStopReason,
  openAIToAnthropic,
  openAIChunkToAnthropicEvents,
} from "../src/converter.js";

describe("extractText", () => {
  test("returns string as-is", () => {
    expect(extractText("hello")).toBe("hello");
  });

  test("joins text blocks from array", () => {
    const content = [
      { type: "text", text: "hello " },
      { type: "text", text: "world" },
    ];
    expect(extractText(content)).toBe("hello world");
  });

  test("filters non-text blocks", () => {
    const content = [
      { type: "text", text: "hello" },
      { type: "image", source: {} },
    ];
    expect(extractText(content)).toBe("hello");
  });

  test("returns empty string for non-string, non-array", () => {
    expect(extractText(123)).toBe("");
    expect(extractText(null)).toBe("");
    expect(extractText(undefined)).toBe("");
  });
});

describe("convertContent", () => {
  test("returns string as-is", () => {
    expect(convertContent("hello")).toBe("hello");
  });

  test("converts text blocks", () => {
    const content = [{ type: "text", text: "hello" }];
    expect(convertContent(content)).toEqual([{ type: "text", text: "hello" }]);
  });

  test("converts image blocks to image_url format", () => {
    const content = [
      {
        type: "image",
        source: { media_type: "image/png", data: "base64data" },
      },
    ];
    const result = convertContent(content);
    expect(result[0].type).toBe("image_url");
    expect(result[0].image_url.url).toBe("data:image/png;base64,base64data");
  });
});

describe("anthropicToOpenAI", () => {
  test("converts basic request", () => {
    const body = {
      model: "claude-3",
      max_tokens: 100,
      messages: [{ role: "user", content: "Hello" }],
    };
    const result = anthropicToOpenAI(body);
    expect(result.model).toBe("claude-3");
    expect(result.max_tokens).toBe(100);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({ role: "user", content: "Hello" });
  });

  test("converts system prompt to system message", () => {
    const body = {
      model: "claude-3",
      max_tokens: 100,
      system: "You are helpful",
      messages: [{ role: "user", content: "Hello" }],
    };
    const result = anthropicToOpenAI(body);
    expect(result.messages[0]).toEqual({ role: "system", content: "You are helpful" });
    expect(result.messages[1]).toEqual({ role: "user", content: "Hello" });
  });

  test("converts stream flag", () => {
    const body = {
      model: "claude-3",
      max_tokens: 100,
      stream: true,
      messages: [],
    };
    const result = anthropicToOpenAI(body);
    expect(result.stream).toBe(true);
  });

  test("converts stop_sequences to stop", () => {
    const body = {
      model: "claude-3",
      max_tokens: 100,
      stop_sequences: ["END", "STOP"],
      messages: [],
    };
    const result = anthropicToOpenAI(body);
    expect(result.stop).toEqual(["END", "STOP"]);
  });

  test("converts tools", () => {
    const body = {
      model: "claude-3",
      max_tokens: 100,
      messages: [],
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          input_schema: { type: "object", properties: { city: { type: "string" } } },
        },
      ],
    };
    const result = anthropicToOpenAI(body);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].type).toBe("function");
    expect(result.tools[0].function.name).toBe("get_weather");
    expect(result.tools[0].function.parameters.properties.city.type).toBe("string");
  });

  test("converts tool_choice auto", () => {
    const body = {
      model: "claude-3",
      max_tokens: 100,
      messages: [],
      tools: [{ name: "test", input_schema: {} }],
      tool_choice: { type: "auto" },
    };
    const result = anthropicToOpenAI(body);
    expect(result.tool_choice).toBe("auto");
  });

  test("converts tool_choice any to required", () => {
    const body = {
      model: "claude-3",
      max_tokens: 100,
      messages: [],
      tools: [{ name: "test", input_schema: {} }],
      tool_choice: { type: "any" },
    };
    const result = anthropicToOpenAI(body);
    expect(result.tool_choice).toBe("required");
  });

  test("converts tool_choice tool to function format", () => {
    const body = {
      model: "claude-3",
      max_tokens: 100,
      messages: [],
      tools: [{ name: "test", input_schema: {} }],
      tool_choice: { type: "tool", name: "test" },
    };
    const result = anthropicToOpenAI(body);
    expect(result.tool_choice).toEqual({ type: "function", function: { name: "test" } });
  });

  test("converts assistant message with tool_use blocks", () => {
    const body = {
      model: "claude-3",
      max_tokens: 100,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check" },
            { type: "tool_use", id: "tu_1", name: "get_weather", input: { city: "NYC" } },
          ],
        },
      ],
    };
    const result = anthropicToOpenAI(body);
    expect(result.messages[0].role).toBe("assistant");
    expect(result.messages[0].content).toBe("Let me check");
    expect(result.messages[0].tool_calls).toHaveLength(1);
    expect(result.messages[0].tool_calls[0].id).toBe("tu_1");
    expect(result.messages[0].tool_calls[0].function.name).toBe("get_weather");
  });

  test("converts user message with tool_result blocks", () => {
    const body = {
      model: "claude-3",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tu_1", content: '{"temp":72}' },
          ],
        },
      ],
    };
    const result = anthropicToOpenAI(body);
    expect(result.messages[0].role).toBe("tool");
    expect(result.messages[0].tool_call_id).toBe("tu_1");
    expect(result.messages[0].content).toBe('{"temp":72}');
  });

  test("converts multiple tool_results", () => {
    const body = {
      model: "claude-3",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tu_1", content: "r1" },
            { type: "tool_result", tool_use_id: "tu_2", content: "r2" },
          ],
        },
      ],
    };
    const result = anthropicToOpenAI(body);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].tool_call_id).toBe("tu_1");
    expect(result.messages[1].tool_call_id).toBe("tu_2");
  });

  test("converts tool_result with error", () => {
    const body = {
      model: "claude-3",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tu_1", is_error: true, content: "Error msg" },
          ],
        },
      ],
    };
    const result = anthropicToOpenAI(body);
    expect(result.messages[0].role).toBe("tool");
    expect(result.messages[0].content).toBe("Error msg");
  });
});

describe("mapStopReason", () => {
  test("maps known reasons", () => {
    expect(mapStopReason("stop")).toBe("end_turn");
    expect(mapStopReason("length")).toBe("max_tokens");
    expect(mapStopReason("tool_calls")).toBe("tool_use");
  });

  test("defaults to end_turn for unknown", () => {
    expect(mapStopReason("unknown")).toBe("end_turn");
    expect(mapStopReason(null)).toBe("end_turn");
  });
});

describe("openAIToAnthropic", () => {
  test("converts basic response", () => {
    const openaiRes = {
      id: "chatcmpl-123",
      choices: [
        {
          message: { role: "assistant", content: "Hello!" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: "gpt-4",
    };
    const result = openAIToAnthropic(openaiRes, "claude-3");
    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe("Hello!");
    expect(result.stop_reason).toBe("end_turn");
    expect(result.usage.input_tokens).toBe(10);
    expect(result.usage.output_tokens).toBe(5);
  });

  test("converts tool_calls response", () => {
    const openaiRes = {
      id: "chatcmpl-123",
      choices: [
        {
          message: {
            role: "assistant",
            content: "Let me check.",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"NYC"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 15 },
    };
    const result = openAIToAnthropic(openaiRes, "claude-3");
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe("text");
    expect(result.content[1].type).toBe("tool_use");
    expect(result.content[1].name).toBe("get_weather");
    expect(result.content[1].input).toEqual({ city: "NYC" });
    expect(result.stop_reason).toBe("tool_use");
  });

  test("converts tool_calls-only response (no text)", () => {
    const openaiRes = {
      id: "chatcmpl-123",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "do_thing", arguments: '{}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    const result = openAIToAnthropic(openaiRes, "claude-3");
    expect(result.content[0].type).toBe("tool_use");
    expect(result.content[0].name).toBe("do_thing");
  });
});

describe("openAIChunkToAnthropicEvents", () => {
  test("first chunk emits message_start and content_block_start", () => {
    const chunk = {
      id: "chatcmpl-123",
      model: "gpt-4",
      choices: [{ delta: { role: "assistant" }, finish_reason: null }],
    };
    const state = { started: false, outputTokens: 0, model: "gpt-4" };
    const events = openAIChunkToAnthropicEvents(chunk, state);

    expect(events[0].event).toBe("message_start");
    expect(events[1].event).toBe("content_block_start");
    expect(state.started).toBe(true);
  });

  test("text delta emits content_block_delta", () => {
    const chunk = {
      id: "chatcmpl-123",
      choices: [{ delta: { content: "Hello" }, finish_reason: null }],
    };
    const state = { started: true, outputTokens: 0, contentIndex: 0, toolCallBlocks: {} };
    const events = openAIChunkToAnthropicEvents(chunk, state);

    expect(events[0].event).toBe("content_block_delta");
    const data = JSON.parse(events[0].data);
    expect(data.delta.type).toBe("text_delta");
    expect(data.delta.text).toBe("Hello");
  });

  test("finish emits stop events", () => {
    const chunk = {
      id: "chatcmpl-123",
      choices: [{ delta: {}, finish_reason: "stop" }],
    };
    const state = { started: true, outputTokens: 5, contentIndex: 0, toolCallBlocks: {} };
    const events = openAIChunkToAnthropicEvents(chunk, state);

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain("content_block_stop");
    expect(eventTypes).toContain("message_delta");
    expect(eventTypes).toContain("message_stop");
  });

  test("streaming tool_use lifecycle", () => {
    const state = { started: true, outputTokens: 0, contentIndex: 0, toolCallBlocks: {}, textBlockClosed: true };

    // Tool call start
    const chunk1 = {
      id: "chatcmpl-123",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "get_weather" } }] }, finish_reason: null }],
    };
    const events1 = openAIChunkToAnthropicEvents(chunk1, state);
    expect(events1.some((e) => e.event === "content_block_start")).toBe(true);

    // Tool call arguments
    const chunk2 = {
      id: "chatcmpl-123",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"ci' } }] }, finish_reason: null }],
    };
    const events2 = openAIChunkToAnthropicEvents(chunk2, state);
    expect(events2[0].event).toBe("content_block_delta");
    const delta2 = JSON.parse(events2[0].data);
    expect(delta2.delta.type).toBe("input_json_delta");

    // Tool call finish
    const chunk3 = {
      id: "chatcmpl-123",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    };
    const events3 = openAIChunkToAnthropicEvents(chunk3, state);
    expect(events3.some((e) => e.event === "content_block_stop")).toBe(true);
    expect(events3.some((e) => e.event === "message_stop")).toBe(true);
  });

  test("multiple concurrent tool calls", () => {
    const state = { started: true, outputTokens: 0, contentIndex: 0, toolCallBlocks: {}, textBlockClosed: true };

    // Two tool calls arrive
    const chunk = {
      id: "chatcmpl-123",
      choices: [{
        delta: {
          tool_calls: [
            { index: 0, id: "call_1", function: { name: "a", arguments: "{}" } },
            { index: 1, id: "call_2", function: { name: "b", arguments: "{}" } },
          ],
        },
        finish_reason: null,
      }],
    };
    const events = openAIChunkToAnthropicEvents(chunk, state);
    const starts = events.filter((e) => e.event === "content_block_start");
    expect(starts.length).toBe(2);
    expect(state.toolCallBlocks[0]).toBeDefined();
    expect(state.toolCallBlocks[1]).toBeDefined();
  });
});
