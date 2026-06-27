/**
 * Converts between Anthropic Messages API and OpenAI Chat Completions API formats.
 *
 * Two directions:
 *   - Anthropic → OpenAI: anthropicToOpenAI, openAIToAnthropic, openAIChunkToAnthropicEvents
 *   - OpenAI → Anthropic: openAIToAnthropicRequest, anthropicToOpenAIResponse,
 *                          anthropicStreamToOpenAIChunks
 */

/**
 * Extract text from an Anthropic content block (string or array).
 */
export function extractText (content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
  }
  return ''
}

/**
 * Convert Anthropic message content to OpenAI content format.
 * Anthropic uses array of blocks [{type:"text",text:"..."}] or plain string.
 * OpenAI uses string or array of {type:"text",text:"..."}.
 */
export function convertContent (content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    // Pass through text and image blocks in OpenAI format
    return content.map((block) => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text }
      }
      if (block.type === 'image') {
        return {
          type: 'image_url',
          image_url: {
            url: `data:${block.source.media_type};base64,${block.source.data}`
          }
        }
      }
      return block
    })
  }
  return String(content)
}

/**
 * Convert Anthropic tools to OpenAI tools format.
 * Anthropic: { name, description, input_schema: { type, properties, required } }
 * OpenAI:    { type: "function", function: { name, description, parameters } }
 */
function convertTools (tools) {
  if (!tools || !tools.length) return undefined
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {} }
    }
  }))
}

/**
 * Convert Anthropic tool_choice to OpenAI tool_choice.
 * Anthropic: { type: "auto" | "any" | "tool", name? }
 * OpenAI:    "auto" | "required" | { type: "function", function: { name } }
 */
function convertToolChoice (toolChoice) {
  if (!toolChoice) return undefined
  if (toolChoice.type === 'auto') return 'auto'
  if (toolChoice.type === 'any') return 'required'
  if (toolChoice.type === 'tool' && toolChoice.name) {
    return { type: 'function', function: { name: toolChoice.name } }
  }
  return 'auto'
}

/**
 * Convert a single Anthropic message to one or more OpenAI messages.
 * Handles tool_use assistant blocks and tool_result user blocks.
 */
function convertMessage (msg) {
  // Simple string content — pass through
  if (typeof msg.content === 'string') {
    return [{ role: msg.role, content: msg.content }]
  }

  if (!Array.isArray(msg.content)) {
    return [{ role: msg.role, content: String(msg.content) }]
  }

  // Assistant message with tool_use blocks → OpenAI tool_calls format
  if (msg.role === 'assistant') {
    const textParts = msg.content.filter((b) => b.type === 'text')
    const toolUseBlocks = msg.content.filter((b) => b.type === 'tool_use')
    const text = textParts.map((b) => b.text).join('')

    const openaiMsg = { role: 'assistant', content: text || null }

    if (toolUseBlocks.length > 0) {
      openaiMsg.tool_calls = toolUseBlocks.map((block) => ({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {})
        }
      }))
    }

    return [openaiMsg]
  }

  // User message with tool_result blocks → OpenAI tool messages
  if (msg.role === 'user') {
    const toolResults = msg.content.filter((b) => b.type === 'tool_result')
    const nonTool = msg.content.filter((b) => b.type !== 'tool_result')

    const messages = []

    // Regular text/image content first
    if (nonTool.length > 0) {
      const converted = convertContent(nonTool)
      // Only add if there's actual content
      if (typeof converted === 'string' ? converted : converted.length > 0) {
        messages.push({ role: 'user', content: converted })
      }
    }

    // Each tool_result → OpenAI tool message
    for (const result of toolResults) {
      let toolContent
      if (result.is_error) {
        toolContent = typeof result.content === 'string'
          ? result.content
          : extractText(result.content)
      } else if (typeof result.content === 'string') {
        toolContent = result.content
      } else if (Array.isArray(result.content)) {
        toolContent = extractText(result.content)
      } else {
        toolContent = String(result.content || '')
      }

      messages.push({
        role: 'tool',
        tool_call_id: result.tool_use_id,
        content: toolContent
      })
    }

    return messages
  }

  // Other roles — just convert content
  return [{ role: msg.role, content: convertContent(msg.content) }]
}

/**
 * Convert an Anthropic messages request body to OpenAI chat completions format.
 *
 * Anthropic format:
 *   { model, max_tokens, system, messages: [{role, content}], tools, tool_choice, stream, ... }
 *
 * OpenAI format:
 *   { model, max_tokens, messages: [{role, content}], tools, tool_choice, stream, ... }
 */
export function anthropicToOpenAI (body) {
  const messages = []

  // Anthropic has system as a top-level field; OpenAI uses a system message
  if (body.system) {
    const systemText =
      typeof body.system === 'string'
        ? body.system
        : extractText(body.system)
    messages.push({ role: 'system', content: systemText })
  }

  // Convert each message (handles tool_use/tool_result expansion)
  for (const msg of body.messages || []) {
    messages.push(...convertMessage(msg))
  }

  const openai = {
    model: body.model,
    max_tokens: body.max_tokens,
    messages
  }

  if (body.stream) openai.stream = true
  if (body.temperature !== undefined) openai.temperature = body.temperature
  if (body.top_p !== undefined) openai.top_p = body.top_p
  if (body.stop_sequences) openai.stop = body.stop_sequences

  // Tool support
  const tools = convertTools(body.tools)
  if (tools) {
    openai.tools = tools
    const toolChoice = convertToolChoice(body.tool_choice)
    if (toolChoice) openai.tool_choice = toolChoice
  }

  return openai
}

/**
 * Map OpenAI finish_reason to Anthropic stop_reason.
 */
export function mapStopReason (finishReason) {
  const map = {
    stop: 'end_turn',
    length: 'max_tokens',
    tool_calls: 'tool_use',
    content_filter: 'end_turn'
  }
  return map[finishReason] || 'end_turn'
}

/**
 * Generate a simple message ID.
 */
export function generateId () {
  return 'msg_' + Math.random().toString(36).slice(2, 14)
}

/**
 * Convert an OpenAI chat completions response to Anthropic messages format.
 *
 * OpenAI: { id, choices: [{message: {role, content, tool_calls}, finish_reason}], usage, model }
 * Anthropic: { id, type, role, content: [{type, text|tool_use, ...}], model, stop_reason, usage }
 */
export function openAIToAnthropic (openaiRes, requestModel) {
  const choice = openaiRes.choices?.[0]
  const message = choice?.message
  const text = message?.content || ''

  const content = []

  // Add text block if there's content
  if (text) {
    content.push({ type: 'text', text })
  }

  // Add tool_use blocks
  if (message?.tool_calls) {
    for (const tc of message.tool_calls) {
      let input = {}
      try {
        input = JSON.parse(tc.function.arguments)
      } catch {
        // If arguments aren't valid JSON, wrap as string
        input = { raw: tc.function.arguments }
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input
      })
    }
  }

  // If no content at all, add empty text block
  if (content.length === 0) {
    content.push({ type: 'text', text: '' })
  }

  return {
    id: openaiRes.id || generateId(),
    type: 'message',
    role: 'assistant',
    content,
    model: openaiRes.model || requestModel,
    stop_reason: mapStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: openaiRes.usage?.prompt_tokens || 0,
      output_tokens: openaiRes.usage?.completion_tokens || 0
    }
  }
}

/**
 * Convert a single OpenAI streaming chunk to zero or more Anthropic SSE events.
 *
 * Returns an array of { event, data } objects.
 */
export function openAIChunkToAnthropicEvents (chunk, state) {
  const events = []
  const delta = chunk.choices?.[0]?.delta
  const finishReason = chunk.choices?.[0]?.finish_reason

  // First chunk: emit message_start
  if (!state.started) {
    state.started = true
    state.contentIndex = 0 // track current content block index
    state.toolCallBlocks = {} // track tool_call id → {index, name, arguments}

    events.push({
      event: 'message_start',
      data: JSON.stringify({
        type: 'message_start',
        message: {
          id: chunk.id || generateId(),
          type: 'message',
          role: 'assistant',
          content: [],
          model: chunk.model || state.model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 }
        }
      })
    })

    // Emit content_block_start for the text block (index 0)
    events.push({
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      })
    })
  }

  // Delta with text content
  if (delta?.content) {
    state.outputTokens++
    events.push({
      event: 'content_block_delta',
      data: JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: delta.content }
      })
    })
  }

  // Delta with tool calls
  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      const tcIndex = tc.index

      // New tool call starting
      if (!state.toolCallBlocks[tcIndex]) {
        // Close the text block if we haven't yet and there was text
        if (!state.textBlockClosed && state.started) {
          state.textBlockClosed = true
          events.push({
            event: 'content_block_stop',
            data: JSON.stringify({ type: 'content_block_stop', index: 0 })
          })
        }

        state.contentIndex++
        state.toolCallBlocks[tcIndex] = {
          contentIndex: state.contentIndex,
          name: tc.function?.name || '',
          arguments: ''
        }

        // Emit content_block_start for tool_use
        events.push({
          event: 'content_block_start',
          data: JSON.stringify({
            type: 'content_block_start',
            index: state.contentIndex,
            content_block: {
              type: 'tool_use',
              id: tc.id || `toolu_${generateId()}`,
              name: tc.function?.name || '',
              input: {}
            }
          })
        })
      }

      // Accumulate arguments
      if (tc.function?.arguments) {
        state.toolCallBlocks[tcIndex].arguments += tc.function.arguments
        events.push({
          event: 'content_block_delta',
          data: JSON.stringify({
            type: 'content_block_delta',
            index: state.toolCallBlocks[tcIndex].contentIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: tc.function.arguments
            }
          })
        })
      }
    }
  }

  // Finish: close content blocks, emit message_delta and message_stop
  if (finishReason) {
    // Close the text block if it wasn't closed yet (no tool calls came)
    if (!state.textBlockClosed) {
      state.textBlockClosed = true
      events.push({
        event: 'content_block_stop',
        data: JSON.stringify({ type: 'content_block_stop', index: 0 })
      })
    }

    // Close all open tool call blocks
    for (const tcIndex of Object.keys(state.toolCallBlocks || {})) {
      const block = state.toolCallBlocks[tcIndex]
      events.push({
        event: 'content_block_stop',
        data: JSON.stringify({ type: 'content_block_stop', index: block.contentIndex })
      })
    }

    events.push({
      event: 'message_delta',
      data: JSON.stringify({
        type: 'message_delta',
        delta: {
          stop_reason: mapStopReason(finishReason),
          stop_sequence: null
        },
        usage: { output_tokens: state.outputTokens }
      })
    })

    events.push({
      event: 'message_stop',
      data: JSON.stringify({ type: 'message_stop' })
    })
  }

  return events
}

// ═══════════════════════════════════════════════════════════════════════════
// Reverse direction: OpenAI → Anthropic (for Anthropic-native providers)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert an OpenAI chat message to one or more Anthropic messages.
 * Handles tool_calls (assistant) and tool role messages.
 */
function convertOpenAIMessage (msg) {
  // Tool role → Anthropic user message with tool_result content blocks
  if (msg.role === 'tool') {
    return [{
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: msg.tool_call_id,
        content: msg.content || ''
      }]
    }]
  }

  // Assistant with tool_calls → Anthropic assistant with tool_use blocks
  if (msg.role === 'assistant' && msg.tool_calls) {
    const content = []
    if (msg.content) {
      content.push({ type: 'text', text: msg.content })
    }
    for (const tc of msg.tool_calls) {
      let input = {}
      try {
        input = JSON.parse(tc.function.arguments)
      } catch {
        input = { raw: tc.function.arguments }
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input
      })
    }
    return [{ role: 'assistant', content }]
  }

  // Regular message — pass through content
  return [{ role: msg.role, content: msg.content || '' }]
}

/**
 * Convert an OpenAI tool definition to Anthropic format.
 * OpenAI:    { type: "function", function: { name, description, parameters } }
 * Anthropic: { name, description, input_schema }
 */
function convertOpenAITools (tools) {
  if (!tools || !tools.length) return undefined
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description || '',
    input_schema: tool.function.parameters || { type: 'object', properties: {} }
  }))
}

/**
 * Convert OpenAI tool_choice to Anthropic tool_choice.
 * OpenAI:    "auto" | "required" | { type: "function", function: { name } }
 * Anthropic: { type: "auto" | "any" | "tool", name? }
 */
function convertOpenAIToolChoice (toolChoice) {
  if (!toolChoice) return undefined
  if (toolChoice === 'auto') return { type: 'auto' }
  if (toolChoice === 'required') return { type: 'any' }
  if (toolChoice.type === 'function' && toolChoice.function?.name) {
    return { type: 'tool', name: toolChoice.function.name }
  }
  return { type: 'auto' }
}

/**
 * Map OpenAI finish_reason to Anthropic stop_reason.
 */
function mapFinishReason (finishReason) {
  const map = {
    stop: 'end_turn',
    length: 'max_tokens',
    tool_calls: 'tool_use',
    content_filter: 'end_turn'
  }
  return map[finishReason] || 'end_turn'
}

/**
 * Convert an OpenAI chat completions request to Anthropic messages format.
 *
 * OpenAI:    { model, max_tokens, messages: [{role, content}], tools, tool_choice, stream, ... }
 * Anthropic: { model, max_tokens, system?, messages: [{role, content}], tools, tool_choice, stream, ... }
 */
export function openAIToAnthropicRequest (body) {
  const messages = []
  let system

  for (const msg of body.messages || []) {
    if (msg.role === 'system') {
      // OpenAI system message → Anthropic top-level system field
      system = msg.content
    } else {
      messages.push(...convertOpenAIMessage(msg))
    }
  }

  const anthropic = {
    model: body.model,
    max_tokens: body.max_tokens || 4096,
    messages
  }

  if (system) anthropic.system = system
  if (body.stream) anthropic.stream = true
  if (body.temperature !== undefined) anthropic.temperature = body.temperature
  if (body.top_p !== undefined) anthropic.top_p = body.top_p
  if (body.stop) anthropic.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop]

  const tools = convertOpenAITools(body.tools)
  if (tools) {
    anthropic.tools = tools
    const toolChoice = convertOpenAIToolChoice(body.tool_choice)
    if (toolChoice) anthropic.tool_choice = toolChoice
  }

  return anthropic
}

/**
 * Convert an Anthropic messages response to OpenAI chat completions format.
 *
 * Anthropic: { id, type, role, content: [{type, text|tool_use, ...}], model, stop_reason, usage }
 * OpenAI:    { id, object, choices: [{message: {role, content, tool_calls}, finish_reason}], usage, model }
 */
export function anthropicToOpenAIResponse (anthropicRes, requestModel) {
  const content = anthropicRes.content || []
  const textParts = content.filter((b) => b.type === 'text')
  const toolUseBlocks = content.filter((b) => b.type === 'tool_use')

  const text = textParts.map((b) => b.text).join('')

  const message = {
    role: 'assistant',
    content: text || null
  }

  if (toolUseBlocks.length > 0) {
    message.tool_calls = toolUseBlocks.map((block) => ({
      id: block.id,
      type: 'function',
      function: {
        name: block.name,
        arguments: JSON.stringify(block.input || {})
      }
    }))
  }

  // Map Anthropic stop_reason → OpenAI finish_reason
  const stopReasonMap = {
    end_turn: 'stop',
    max_tokens: 'length',
    tool_use: 'tool_calls'
  }

  return {
    id: anthropicRes.id || `chatcmpl-${generateId()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: anthropicRes.model || requestModel,
    choices: [
      {
        index: 0,
        message,
        finish_reason: stopReasonMap[anthropicRes.stop_reason] || 'stop'
      }
    ],
    usage: {
      prompt_tokens: anthropicRes.usage?.input_tokens || 0,
      completion_tokens: anthropicRes.usage?.output_tokens || 0,
      total_tokens:
        (anthropicRes.usage?.input_tokens || 0) +
        (anthropicRes.usage?.output_tokens || 0)
    }
  }
}

/**
 * Convert a single Anthropic SSE event into zero or more OpenAI streaming chunks.
 *
 * Returns an array of OpenAI-compatible chunk objects.
 */
export function anthropicStreamToOpenAIEvents (eventType, eventData, state) {
  const chunks = []

  if (eventType === 'message_start') {
    state.started = true
    state.toolCalls = {}
    state.toolCallIndex = 0
    state.message = eventData.message

    chunks.push({
      id: eventData.message.id || `chatcmpl-${generateId()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: eventData.message.model || state.model,
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null
        }
      ]
    })
  } else if (eventType === 'content_block_delta') {
    if (eventData.delta?.type === 'text_delta') {
      chunks.push({
        id: state.message?.id || `chatcmpl-${generateId()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: state.message?.model || state.model,
        choices: [
          {
            index: 0,
            delta: { content: eventData.delta.text },
            finish_reason: null
          }
        ]
      })
    } else if (eventData.delta?.type === 'input_json_delta') {
      const idx = eventData.index
      if (state.toolCalls[idx]) {
        chunks.push({
          id: state.message?.id || `chatcmpl-${generateId()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: state.message?.model || state.model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: state.toolCalls[idx].openaiIndex,
                    function: { arguments: eventData.delta.partial_json }
                  }
                ]
              },
              finish_reason: null
            }
          ]
        })
      }
    }
  } else if (eventType === 'content_block_start') {
    if (eventData.content_block?.type === 'tool_use') {
      const openaiIndex = state.toolCallIndex++
      state.toolCalls[eventData.index] = {
        id: eventData.content_block.id,
        name: eventData.content_block.name,
        openaiIndex
      }

      chunks.push({
        id: state.message?.id || `chatcmpl-${generateId()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: state.message?.model || state.model,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: openaiIndex,
                  id: eventData.content_block.id,
                  type: 'function',
                  function: {
                    name: eventData.content_block.name,
                    arguments: ''
                  }
                }
              ]
            },
            finish_reason: null
          }
        ]
      })
    }
  } else if (eventType === 'message_delta') {
    const stopReasonMap = {
      end_turn: 'stop',
      max_tokens: 'length',
      tool_use: 'tool_calls'
    }
    chunks.push({
      id: state.message?.id || `chatcmpl-${generateId()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: eventData.delta?.model || state.message?.model || state.model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: stopReasonMap[eventData.delta?.stop_reason] || 'stop'
        }
      ],
      usage: eventData.usage
    })
  }

  return chunks
}
