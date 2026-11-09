import type { CSSProperties } from 'react';

interface AvatarProps {
  name?: string | null;
  photoURL?: string | null;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/** Avatar circulaire : photo de profil ou initiale. */
export default function Avatar({ name, photoURL, size = 42, className = '', style }: AvatarProps) {
  const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const box: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.38),
    ...style,
  };
  if (photoURL) {
    return (
      <img
        className={`avatar ${className}`.trim()}
        src={photoURL}
        alt={name || ''}
        style={{ ...box, objectFit: 'cover' }}
      />
    );
  }
  return (
    <div className={`avatar ${className}`.trim()} style={box}>
      {letter}
    </div>
  );
}
