import fs from 'fs';
import path from 'path';

describe('DataMatrix component compatibility guard', () => {
  it('does not depend on react-datamatrix-svg runtime shim', () => {
    const filePath = path.join(
      process.cwd(),
      'components',
      'custom',
      'DataMatrixComponent.tsx'
    );
    const src = fs.readFileSync(filePath, 'utf8');

    expect(src).not.toContain('react-datamatrix-svg');
    expect(src).toContain("import('bwip-js')");
  });
});

