import type { FrameRepair } from '../scenarios/frame-repair-agent';

export type EvidenceManifest = {
  trace: string | null;
  frameRepair?: FrameRepair | null;
  video: string | null;
  screenshots: Array<{ step: number; action: string; key: string; status: 'pass' | 'fail' }>;
};

export type ManualEvidence = {
  notes: string | null;
  screenshots: Array<{ filename: string; data: string }>;
};
