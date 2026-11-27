/**
 * Similar Item Search（找相似，ADR-0020）的 Similar Search Draft 與市集 query：單一外部介面。
 */
export * from './types';
export { createSimilarSearchDraft } from './draft';
export {
  setPropertyEnabled,
  setPropertyThreshold,
  setScope,
  setStatDomain,
  setStatRole,
  setStatThreshold,
  setTolerance,
  setWeaponMode,
} from './edit';
export { buildSimilarSearchQuery } from './query';
export {
  orderBySimilarity,
  scoreSimilarity,
  type ScoredResult,
  type SimilarityMark,
  type SimilarityOptions,
  type SimilarityScore,
} from './similarity';
export { runSimilarSearch, SIMILAR_RUN_LIMITS } from './run';
export type {
  FetchedResult,
  SimilarBatch,
  SimilarBatchKind,
  SimilarRunDeps,
  SimilarRunEvent,
  SimilarRunResult,
  SimilarSearchResponse,
  SimilarStopReason,
  SimilarTradeTransport,
  TransportOutcome,
} from './run-types';
