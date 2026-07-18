import { useState } from 'react';
import { MusicIcon } from './Icons';

interface Props {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  rounded?: string;
}

/** Album/artist artwork with graceful gradient fallback. */
export function Artwork({ src, alt = '', className = '', rounded = 'rounded-md' }: Props) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-accent/40 to-surface-2 text-ink-muted ${rounded} ${className}`}
        aria-label={alt}
      >
        <MusicIcon size={Math.min(28, 24)} />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`object-cover ${rounded} ${className}`}
    />
  );
}
