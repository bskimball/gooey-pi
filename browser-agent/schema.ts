/** Flat provider-facing schemas. validation.ts enforces the action-specific contract. */
export const elementTargetSchema = {
  type: 'object',
  properties: {
    ref: { type: 'integer', minimum: 0, maximum: 999 },
    role: { type: 'string' },
    name: { type: 'string' },
    nth: { type: 'integer', minimum: 0 },
    intent: { type: 'string' },
  },
}
export const targetSchema = {
  type: 'object',
  properties: {
    ...elementTargetSchema.properties,
    x: { type: 'number', minimum: 0, maximum: 20000 },
    y: { type: 'number', minimum: 0, maximum: 20000 },
  },
}
export const expectSchema = {
  type: 'object',
  properties: {
    url_includes: { type: 'string' },
    title_includes: { type: 'string' },
    text_includes: { type: 'string' },
    text_absent: { type: 'string' },
    element: elementTargetSchema,
    judge: { type: 'string' },
    timeout_ms: { type: 'integer', minimum: 0, maximum: 10000 },
  },
}
export const stepSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['click', 'drag', 'type', 'select', 'press', 'navigate', 'scroll', 'wait', 'expect'] },
    target: targetSchema,
    from: targetSchema,
    to: targetSchema,
    steps: { type: 'integer', minimum: 1, maximum: 50 },
    double: { type: 'boolean' },
    button: { type: 'string', enum: ['left', 'right', 'middle'] },
    repeat: { type: 'integer', minimum: 1, maximum: 200 },
    text: { type: 'string' },
    submit: { type: 'boolean' },
    clear: { type: 'boolean' },
    value: { type: 'string' },
    key: { type: 'string' },
    modifiers: { type: 'array', items: { type: 'string' } },
    url: { type: 'string' },
    direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
    amount: { type: 'number' },
    x: { type: 'number' },
    y: { type: 'number' },
    ms: { type: 'integer', minimum: 0, maximum: 5000 },
    expect: expectSchema,
  },
  required: ['action'],
}
