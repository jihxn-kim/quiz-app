import { Module } from '@nestjs/common';
import { LlmClient } from './llm.client';
import { EmbeddingClient } from './embedding.client';

@Module({
  providers: [LlmClient, EmbeddingClient],
  exports: [LlmClient, EmbeddingClient],
})
export class LlmModule {}
