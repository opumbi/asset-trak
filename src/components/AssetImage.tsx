import React, { useState } from 'react';
import {
  Armchair,
  Box,
  Cpu,
  FlaskConical,
  Laptop,
  Truck,
} from 'lucide-react';
import { AssetCategory } from '../types/asset';

interface AssetImageProps {
  src: string;
  alt: string;
  category: AssetCategory;
  className?: string;
  iconSizeClass?: string;
}

export function CategoryIcon({
  category,
  className = 'w-5 h-5',
}: {
  category: AssetCategory;
  className?: string;
}) {
  switch (category) {
    case 'IT Hardware':
      return <Laptop className={className} />;
    case 'Office Furniture':
      return <Armchair className={className} />;
    case 'Vehicles':
      return <Truck className={className} />;
    case 'Machinery':
      return <Cpu className={className} />;
    case 'Lab & Medical':
      return <FlaskConical className={className} />;
    default:
      return <Box className={className} />;
  }
}

/**
 * Zero-Broken-Image resilient asset thumbnail/banner component.
 */
export function AssetImage({
  src,
  alt,
  category,
  className = 'w-full h-full object-cover',
  iconSizeClass = 'w-6 h-6',
}: AssetImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className="w-full h-full bg-slate-100 flex flex-col items-center justify-center text-slate-400 select-none"
        aria-label={alt}
      >
        <CategoryIcon category={category} className={iconSizeClass} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
