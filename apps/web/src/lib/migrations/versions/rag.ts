/**
 * RAG Store Migrations — thin re-export
 *
 * The canonical source now lives at `@/features/rag/store/migrations`.
 * This file re-exports everything for backward compatibility.
 */
export {
  RagStateWrapperSchema,
  type RagStateShape,
  migrateRagToV1,
  migrateRagToV2,
  migrateRagToV3,
  rollbackRagToV0,
  rollbackRagToV1,
  rollbackRagToV2,
  validateRag,
  ragMigrations,
  ragBidirectionalMigrations,
  RAG_STORE_VERSION,
} from '@/features/rag/store/migrations';