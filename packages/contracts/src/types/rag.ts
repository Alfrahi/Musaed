import { type z } from 'zod';
import {
  type ProjectStatusSchema,
  type IndexPhaseSchema,
  type RagProjectSchema,
  type IndexProgressSchema,
  type SearchResultSchema,
  type ProjectStatsSchema,
  type ChunkRecordSchema,
  type IndexCompleteSchema,
  type IndexErrorSchema,
  type IndexStatusSchema,
  type RagModelValidationSchema,
  type CitationSchema,
  type AssembledContextSchema,
} from '../schemas/rag';

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type IndexPhase = z.infer<typeof IndexPhaseSchema>;
export type RagProject = z.infer<typeof RagProjectSchema>;
export type IndexProgress = z.infer<typeof IndexProgressSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type ProjectStats = z.infer<typeof ProjectStatsSchema>;
export type ChunkRecord = z.infer<typeof ChunkRecordSchema>;
export type IndexComplete = z.infer<typeof IndexCompleteSchema>;
export type IndexError = z.infer<typeof IndexErrorSchema>;
export type IndexStatus = z.infer<typeof IndexStatusSchema>;
export type RagModelValidation = z.infer<typeof RagModelValidationSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type AssembledContext = z.infer<typeof AssembledContextSchema>;
