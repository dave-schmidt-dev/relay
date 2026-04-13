import type { ContextItem, Provider } from "../core/types.js";

export interface SelectedExcerpt {
  source_run_id: string;
  source_file: string;
  byte_start: number;
  byte_end: number;
  text: string;
}

export interface ProjectFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface FileInput {
  original_path: string;
}

export interface HandoffDraftRequest {
  source_run_id: string;
  target_provider: Provider;
  title: string;
  objective: string;
  requested_outcome?: string;
  include_memory?: boolean;
  context_items?: ContextItem[];
  excerpt_inputs?: SelectedExcerpt[];
  file_inputs?: FileInput[];
  note_text?: string;
}

export interface HandoffPreviewResult {
  context_items: ContextItem[];
  final_prompt: string;
  estimated_bytes: number;
  estimated_tokens: number;
}

export interface RunLogResponse {
  stdout: string;
  stderr: string;
}
