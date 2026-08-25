import React from 'react';

interface ComplexCardProps {
  isActive: boolean;
}

export function ComplexCard({ isActive }: ComplexCardProps) {
  return (
    <div className="p-[13px] m-[7px] bg-[#f0f0f0] text-[15px]">
      <div style={{ backgroundColor: '#ffffff', padding: '11px', color: 'rgb(26, 115, 232)' }}>
        <span className={`px-[9px] ${isActive ? 'bg-[#1a73e8]' : 'bg-[#000000]'}`}>Content</span>
        <span style={{ color: '#f00' }}>Short hex</span>
      </div>
    </div>
  );
}
