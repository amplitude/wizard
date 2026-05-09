/**
 * Zod schemas for the wizard's typed ID prefixes.
 *
 * Extracted from `schemas.ts` so the `checkpoints/*` and
 * `mcp-app-lifecycle.ts` modules can import them without forming an
 * import cycle (`schemas.ts` ↔ `checkpoints/*`). Keep this file
 * dependency-light — only the id regexes live here.
 */
import { z } from 'zod';

export const SessionIdSchema = z
  .string()
  .regex(/^session_[A-Za-z0-9_-]+$/, 'expected session_<id>');

export const TaskIdSchema = z
  .string()
  .regex(/^task_[A-Za-z0-9_-]+$/, 'expected task_<id>');

export const SubagentIdSchema = z
  .string()
  .regex(/^subagent_[A-Za-z0-9_-]+$/, 'expected subagent_<id>');
