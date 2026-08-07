import { FakeListChatModel } from '@langchain/core/utils/testing';
import { expect, it } from 'vitest';

import { LangGraphAgent } from '../src/server-agent.js';

it('runs a LangChain model inside LangGraph', async () => {
  const agent = new LangGraphAgent(new FakeListChatModel({ responses: ['hello from LangGraph'] }), 'Be useful.');
  await expect(agent.respond('hello', 'context-1')).resolves.toBe('hello from LangGraph');
});
