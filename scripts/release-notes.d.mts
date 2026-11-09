export interface ParsedCommit {
  type: string;
  scope: string | undefined;
  breaking: boolean;
  description: string;
}

export interface ReleaseNotesOptions {
  version: string;
  previousTag?: string;
  repo: string;
}

export function parseCommitSubject(subject: string): ParsedCommit;
export function buildReleaseNotes(subjects: string[], options: ReleaseNotesOptions): string;
