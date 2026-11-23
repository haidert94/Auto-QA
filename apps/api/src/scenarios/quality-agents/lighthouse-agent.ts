import { LIGHTHOUSE_CATEGORIES } from '../../performance/lighthouse-report';
import { nodeTarget } from './agent-context';

export function prepareLighthouse(url: URL) {
  return [
    "// Requiere Lighthouse, chrome-launcher y Chrome instalado.",
    "import lighthouse from 'lighthouse';",
    "import { launch } from 'chrome-launcher';",
    "import { writeFile } from 'node:fs/promises';",
    '',
    ...nodeTarget(url),
    "const chrome = await launch({ chromeFlags: ['--headless=new'] });",
    'try {',
    '  const result = await lighthouse(target.href, {',
    "    port: chrome.port, output: 'json', logLevel: 'error',",
    '    onlyCategories: ' + JSON.stringify(LIGHTHOUSE_CATEGORIES) + ',',
    '  });',
    "  if (!result) throw new Error('Lighthouse no produjo un resultado.');",
    "  await writeFile('lighthouse-report.json', result.report);",
    '} finally {',
    '  await chrome.kill();',
    '}',
    '',
  ].join('\n');
}
