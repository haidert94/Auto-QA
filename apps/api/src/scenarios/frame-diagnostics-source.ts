export const FRAME_REPAIR_FILENAME = 'autoqa-frame-repair.json';

// Código de observación incluido solo en el spec que ejecuta Explorer.
export const FRAME_DIAGNOSTICS_SOURCE = String.raw`
let locatorStep: { step: number; kind: string; target: string } | undefined;

function frameInScope(frame: Frame): boolean {
  const url = frame.url();
  if (url === 'about:blank' || url === 'about:srcdoc') {
    const parent = frame.parentFrame();
    return parent !== null && frameInScope(parent);
  }
  return scopeAllowed(new URL(url));
}

async function framePath(frame: Frame): Promise<string[] | null> {
  const path: string[] = [];
  for (let parent = frame.parentFrame(); parent; parent = frame.parentFrame()) {
    if (path.length === 3 || !frameInScope(frame)) return null;
    const element = await frame.frameElement();
    let unique: string | undefined;
    try {
      for (const attribute of ['data-testid', 'id', 'name']) {
        const value = await element.getAttribute(attribute);
        if (!value || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) continue;
        const selector = 'iframe[' + attribute + '="' + value + '"]';
        if (await parent.locator(selector).count() === 1) {
          unique = selector;
          break;
        }
      }
    } finally { await element.dispose(); }
    if (!unique) return null;
    path.unshift(unique);
    frame = parent;
  }
  return path;
}

async function detectFrame(page: Page, failed: NonNullable<typeof locatorStep>) {
  const frames = page.frames();
  if (frames.length < 2 || frames.length > 20) return null;
  const find = (frame: Frame) => {
    if (failed.kind === 'click-text') return frame.getByText(failed.target, { exact: true });
    if (failed.kind === 'expect-text') return frame.getByText(failed.target);
    if (failed.kind === 'fill-label') return frame.getByLabel(failed.target, { exact: true });
    return frame.locator(failed.target);
  };
  const counts = await Promise.all(frames.map(async frame => {
    if (!frameInScope(frame)) throw new Error('Marco fuera de alcance');
    return find(frame).count();
  }));
  const candidate = frames[counts.indexOf(1)];
  if (!candidate?.parentFrame() || counts.reduce((sum, count) => sum + count, 0) !== 1) return null;
  const path = await framePath(candidate);
  return path?.length ? { step: failed.step, frames: path } : null;
}

test.afterEach(async ({ page }, info) => {
  if (!locatorStep || info.status === info.expectedStatus || page.isClosed()) return;
  const failed = locatorStep;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const repair = await Promise.race([
      detectFrame(page, failed),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2000); }),
    ]);
    if (repair) await writeFile('${FRAME_REPAIR_FILENAME}', JSON.stringify(repair), 'utf8');
  } catch {
    // Una observación incompleta no modifica el resultado original.
  } finally {
    clearTimeout(timer);
  }
});
`;
