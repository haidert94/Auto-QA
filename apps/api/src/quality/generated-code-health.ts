import type { Prisma } from '@prisma/client';
import { currentAutomation, type PreparedAutomation } from '../scenarios/automation-agent';
import { generateSharedSteps, generateSpec, hasPlaywrightAssertion } from '../scenarios/playwright-generator';
import { lintCredentialLiterals, lintGeneratedCode, lintPreparedSteps, type LintIssue } from '../scenarios/spec-linter';
import { qualityAutomationStatus, type QualityKind } from '../scenarios/quality-automation';
import { readQualityScenarioSources } from '../scenarios/quality-scenarios';

type PlaywrightSource = Parameters<typeof currentAutomation>[0] & { id: string };
type Kind = 'playwright' | QualityKind;
type Finding = LintIssue & { scenarioId: string; title: string; kind: Kind };
type Check = { id: string; title: string; kind: Kind; analyzed: boolean; issues: LintIssue[] };

function summarize(checks: Check[]) {
  const analyzed = checks.filter(check => check.analyzed);
  const clean = analyzed.filter(check => check.issues.length === 0).length;
  const findings: Finding[] = analyzed.flatMap(({ id, title, kind, issues }) => issues.map(issue => ({
    ...issue, scenarioId: id, title, kind,
  })));
  return {
    score: analyzed.length ? Math.round(100 * clean / analyzed.length) : null,
    analyzed: analyzed.length, clean, pending: checks.length - analyzed.length,
    findings, errors: findings.filter(issue => issue.severity === 'error').length,
    warnings: findings.filter(issue => issue.severity === 'warn').length,
  };
}

export async function generatedCodeHealth(
  db: Prisma.TransactionClient, projectId: string,
  playwright: Array<{ scenario: PlaywrightSource; automation: PreparedAutomation | null }>,
) {
  const [monitors, audits, loadTests, uxAudits] = await readQualityScenarioSources(db, projectId, undefined, true);
  const checks = playwright.map(({ scenario, automation }): Check => {
    const { id, title, expectedResult } = scenario;
    if (!automation) return { id, title, kind: 'playwright', analyzed: false, issues: [] };
    const { steps } = automation;
    const issues = [
      ...lintPreparedSteps(steps),
      ...lintGeneratedCode(generateSpec({ id, title: automation.title, expectedResult, steps }, true), hasPlaywrightAssertion(steps)),
      ...lintGeneratedCode(generateSharedSteps(steps), true),
    ];
    // Informa una vez cada hallazgo que aparece tanto en el spec como en sus pasos compartidos.
    const distinct = new Map(issues.map(issue => [issue.code + ':' + issue.message, issue]));
    return { id, title, kind: 'playwright', analyzed: true, issues: [...distinct.values()] };
  });

  function qualityCheck(kind: QualityKind, row: Parameters<typeof qualityAutomationStatus>[1] & {
    id: string; automationCode?: string | null;
  }, title: string): Check {
    const code = qualityAutomationStatus(kind, row).prepared ? row.automationCode : null;
    return {
      id: kind + ':' + row.id, title, kind, analyzed: !!code,
      issues: code ? lintCredentialLiterals(code) : [],
    };
  }

  return summarize([
    ...checks,
    ...monitors.map(row => qualityCheck('availability', row, row.name)),
    ...audits.map(row => qualityCheck('lighthouse', row, row.requirement?.title ?? 'Auditoría Lighthouse')),
    ...loadTests.map(row => qualityCheck('load', row, row.name)),
    ...uxAudits.map(row => qualityCheck('ux', row, row.requirement?.title ?? 'Auditoría UX')),
  ]);
}

export type GeneratedCodeHealth = Awaited<ReturnType<typeof generatedCodeHealth>>;
