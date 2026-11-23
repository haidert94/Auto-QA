export type EvidenceManifest = {
  trace: string | null;
  video: string | null;
  screenshots: Array<{ step: number; action: string; key: string; status: 'pass' | 'fail' }>;
};

export type ManualEvidence = {
  notes: string | null;
  screenshots: Array<{ filename: string; data: string }>;
};
