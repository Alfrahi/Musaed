import { z } from 'zod';

// RAG related schemas (types are defined in types/rag.ts)
export const ProjectStatusSchema = z.enum(['idle', 'indexing', 'ready', 'error']);
export const IndexPhaseSchema = z.enum([
  'discoveringFiles',
  'diffingFiles',
  'deletingStale',
  'readingFiles',
  'chunkingFiles',
  'embeddingChunks',
  'storingChunks',
  'completed',
  'failed',
]);
export const RagProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  embeddingModel: z.string(),
  ignorePatterns: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  indexedAt: z.string().nullable(),
  fileCount: z.number(),
  chunkCount: z.number(),
  totalBytes: z.number(),
  status: ProjectStatusSchema,
  retryAttempts: z.number().optional().default(0),
  lastError: z.string().nullable().optional(),
});
export const IndexProgressSchema = z.object({
  projectId: z.string(),
  phase: IndexPhaseSchema,
  current: z.number(),
  total: z.number(),
  message: z.string(),
});
export const SearchResultSchema = z.object({
  chunkId: z.number(),
  content: z.string(),
  chunkType: z.string(),
  language: z.string().nullable(),
  startLine: z.number(),
  endLine: z.number(),
  filePath: z.string(),
  score: z.number(),
  metadata: z.record(z.string(), z.unknown()),
});
export const ProjectStatsSchema = z.object({
  fileCount: z.number(),
  chunkCount: z.number(),
  totalBytes: z.number(),
  embeddingDimension: z.number(),
  indexSizeBytes: z.number(),
  lastIndexed: z.string().nullable(),
});
export const ChunkRecordSchema = z.object({
  id: z.number(),
  chunkIndex: z.number(),
  content: z.string(),
  chunkType: z.string(),
  language: z.string().nullable(),
  startLine: z.number(),
  endLine: z.number(),
  metadata: z.record(z.string(), z.unknown()),
});
export const IndexCompleteSchema = z.object({
  projectId: z.string(),
  indexedAt: z.string(),
  fileCount: z.number(),
  chunkCount: z.number(),
  totalBytes: z.number(),
});
export const IndexErrorSchema = z.object({
  projectId: z.string(),
  message: z.string(),
});
export const IndexStatusSchema = z.object({
  projectId: z.string(),
  isIndexing: z.boolean(),
  progress: IndexProgressSchema.nullable(),
});
/**
 * Mirrors Rust `crate::rag::types::RagModelValidation` (src-tauri/src/rag/types.rs).
 * Returned by `cmd_rag_validate_embedding_model`.
 */
export const RagModelValidationSchema = z.object({
  isValid: z.boolean(),
  modelName: z.string(),
  embeddingDimension: z.number().nullable(),
  error: z.string().nullable(),
});
export const CitationSchema = z.object({
  filePath: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  language: z.string().nullable(),
});
export const AssembledContextSchema = z.object({
  assembledContext: z.string(),
  citations: z.array(CitationSchema),
  tokenCount: z.number(),
});
