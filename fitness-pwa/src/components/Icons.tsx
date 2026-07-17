import React from 'react';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

export const HomeIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-10" />
  </svg>
);

export const FireIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M12 2c0 0-4.5 3.5-4.5 8.5C7.5 16 9.5 20 12 20s4.5-4 4.5-9.5S12 2 12 2z" />
    <path d="M12 20v2" />
  </svg>
);

export const ScaleIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" />
    <line x1="12" y1="6" x2="12" y2="18" />
    <line x1="6" y1="12" x2="18" y2="12" />
  </svg>
);

export const ChartBarIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M3 20V7a2 2 0 012-2h5l3-4h1l3 4h5a2 2 0 012 2v13" />
    <rect x="5" y="11" width="3" height="6" />
    <rect x="12" y="9" width="3" height="8" />
    <rect x="19" y="13" width="3" height="4" />
  </svg>
);

export const CogIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3m0 12v3m7-9h-3m-12 0H2" />
    <path d="M19.07 4.93l-2.12 2.12M6.05 17.95l-2.12 2.12M19.07 19.07l-2.12-2.12M6.05 6.05L3.93 3.93" />
  </svg>
);

export const MoonIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
  </svg>
);

export const SunIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

export const CheckCircleIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

export const XCircleIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

export const PlusIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const MinusIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const ArrowUpIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

export const ArrowDownIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <polyline points="19 12 12 19 5 12" />
  </svg>
);

export const TrashIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

export const EditIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

export const ClockIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

export const PlayIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="currentColor"
    stroke="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <polygon points="5 3 19 12 5 21" />
  </svg>
);

export const PauseIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="currentColor"
    stroke="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

export const DownloadIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const UploadIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

export const CameraIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

export const InfoIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

export const AlertIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export const HeartIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
  </svg>
);

export const TrendingUpIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 17" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
);

export const TrendingDownIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
    <polyline points="17 18 23 18 23 12" />
  </svg>
);

export const EyeIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const MapPinIcon: React.FC<IconProps> = (props) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
    {...props}
  >
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);
