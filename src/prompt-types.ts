// Shared by the library service and room. Provider settings and permissions never belong to a prompt.
export type PromptMode = 'all' | 'benchmark' | 'conversation' | 'build';
export interface PromptFile { id: string; name: string; mediaType: string; kind: 'text' | 'image'; size: number }
export interface SavedPrompt {
  id: string; revision: string; name: string; text: string; mode: PromptMode; buildKind: 'build' | 'review';
  files: PromptFile[]; createdAt: string; updatedAt: string;
}
export interface PromptSummary extends Omit<SavedPrompt, 'revision'> { excerpt: string }
export interface PromptFileInput { id: string; name: string; attachmentId?: string }
export interface PromptSave {
  id: string; revision: string | null; name: string; text: string; mode: PromptMode;
  buildKind: 'build' | 'review'; files: PromptFileInput[];
}
