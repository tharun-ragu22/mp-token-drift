import React from 'react';
import cn from 'classnames';
import clsx from 'clsx';

interface EdgeCasesCardProps {
  isTrue: boolean;
  active: boolean;
  props: Record<string, unknown>;
}

export function EdgeCasesCard({ isTrue, active, props }: EdgeCasesCardProps) {
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
    </div>
  );
}
