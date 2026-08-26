import React from 'react';
import cn from 'classnames';
import clsx from 'clsx';

interface EdgeCasesCardProps {
  isTrue: boolean;
  active: boolean;
  isError: boolean;
  props: Record<string, unknown>;
}

const cardHeaderStyle = { borderColor: '#e5e7eb' };

export function EdgeCasesCard({ isTrue, active, isError, props }: EdgeCasesCardProps) {
  return (
    <div className="-top-[12px] grid-cols-[1fr_2fr]">
      <div
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          borderColor: 'hsl(210, 100%, 50%)',
          color: 'var(--my-color, #ff0055)',
        }}
      >
        <span className={cn('p-[12px]', isTrue && 'm-[4px]')}>Utility helpers</span>
        <span className={clsx({ 'bg-[#123456]': active })}>Object form</span>
      </div>
      <div {...props} className="p-[10px]" style={{ color: '#000000' }} />
      <p style={{ color: 'oklch(0.6 0.25 140)' }} className="bg-[oklch(0.7_0.15_200)]">
        Modern color spaces
      </p>
      <p style={{ color: isError ? '#ff0000' : 'rgba(0, 0, 0, 0.8)' }}>Ternary branches</p>
      <header style={cardHeaderStyle}>External object constant</header>
      <span
        style={{
          color: '#00ff00', // drift-ignore
        }}
      >
        Ignored
      </span>
    </div>
  );
}
