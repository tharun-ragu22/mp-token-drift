export function Suppressed() {
  return (
    <div>
      {/* drift-ignore */}
      <span style={{ color: '#123456' }}>suppressed by preceding line comment</span>
      {/* drift-disable */}
      <span className="p-[99px]">suppressed by preceding block directive</span>
      <span style={{ color: '#654321' }}>reported normally</span>
    </div>
  );
}
