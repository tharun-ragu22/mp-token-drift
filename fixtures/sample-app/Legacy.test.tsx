// A drift-laden component that lives in a *.test.tsx file, used to verify that
// --ignore globs exclude test files from scanning.
export function LegacyWidget() {
  return <div style={{ color: '#abcdef' }}>Legacy</div>;
}
