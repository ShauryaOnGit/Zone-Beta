// components/ZoneLogo.jsx

/**
 * Isolated glowing Eye component (the moving "O").
 */
export function ZoneEye({ animated = false, theme = 'dark', size = 48 }) {
  const isLight = theme === 'light';

  const fieldBlur = size * 0.14;
  const pupilGlow = size * 0.1;

  const pupilColor = isLight ? '#1e293b' : '#000';
  const pupilGlowColor = isLight ? 'rgba(15,23,42,0.35)' : 'rgba(0,0,0,0.9)';

  return (
    <div
      className="zone-logo-eye-wrap"
      style={{
        position: 'relative',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        overflow: 'hidden',
        boxShadow: isLight ? '0 1px 3px rgba(15,23,42,0.08)' : 'none',
        flexShrink: 0,
      }}
    >
      <div
        className="zone-logo-field"
        style={{
          position: 'absolute',
          inset: '-20%',
          background: `
            radial-gradient(circle at 22% 18%, #f4744a 0%, #f4744a 14%, transparent 40%),
            radial-gradient(circle at 68% 8%,  #e15f92 0%, #e15f92 16%, transparent 42%),
            radial-gradient(circle at 88% 34%, #8f5fdb 0%, #8f5fdb 15%, transparent 38%),
            radial-gradient(circle at 82% 72%, #5a9edd 0%, #5a9edd 18%, transparent 44%),
            radial-gradient(circle at 55% 92%, #3ea89d 0%, #3ea89d 16%, transparent 40%),
            radial-gradient(circle at 18% 80%, #5fae4c 0%, #5fae4c 17%, transparent 42%),
            radial-gradient(circle at 6% 48%,  #e6a532 0%, #e6a532 15%, transparent 38%),
            radial-gradient(circle at 42% 46%, #8a4fd1 0%, #8a4fd1 20%, transparent 46%),
            conic-gradient(from 0deg, #f4744a, #e15f92, #8f5fdb, #5a9edd, #3ea89d, #5fae4c, #e6a532, #f4744a)
          `,
          filter: `blur(${fieldBlur}px) saturate(${isLight ? 1.15 : 1.3}) contrast(1.08)`,
          opacity: isLight ? 0.9 : 1,
          animation: 'zoneLogoDrift 31s ease-in-out infinite alternate',
        }}
      />
      <div
        className={`zone-logo-pupil ${animated ? 'zone-logo-pupil--animated' : 'zone-logo-pupil--static'}`}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          background: pupilColor,
          borderRadius: '50%',
          transform: 'translate(-50%, -50%)',
          boxShadow: `0 0 ${pupilGlow}px ${pupilGlowColor} inset`,
        }}
      />
      <style>{`
        @keyframes zoneLogoDrift {
          0%   { transform: translate(0%, 0%) rotate(0deg) scale(1); }
          50%  { transform: translate(-3%, 2%) rotate(6deg) scale(1.06); }
          100% { transform: translate(2%, -3%) rotate(-5deg) scale(1.03); }
        }

        @keyframes zoneLogoDilate {
          0%   { width: 18%; height: 18%; }
          50%  { width: 46%; height: 46%; }
          100% { width: 18%; height: 18%; }
        }

        .zone-logo-pupil--static {
          width: 30%;
          height: 30%;
        }

        .zone-logo-pupil--animated {
          animation: zoneLogoDilate 4.2s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .zone-logo-field {
            animation: none !important;
          }
          .zone-logo-pupil--animated {
            animation: none !important;
            width: 30%;
            height: 30%;
          }
        }
      `}</style>
    </div>
  );
}

/**
 * Full "ZONE" wordmark with letters and central eye.
 */
export default function ZoneLogo({ animated = false, theme = 'dark', size = 150, letterSize }) {
  const isLight = theme === 'light';
  const resolvedLetterSize = letterSize ?? size * 1.35;
  const letterColor = isLight ? '#1e293b' : '#fff';

  return (
    <div
      className="zone-logo-stage"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: `${size * 0.19}px`,
      }}
    >
      <h1
        className="zone-logo-letter"
        style={{ color: letterColor, fontSize: `${resolvedLetterSize}px`, lineHeight: 1, margin: 0, fontFamily: "'Poppins', sans-serif", fontWeight: 700 }}
      >
        Z
      </h1>

      <ZoneEye animated={animated} theme={theme} size={size} />

      <h1
        className="zone-logo-letter"
        style={{ color: letterColor, fontSize: `${resolvedLetterSize}px`, lineHeight: 1, margin: 0, fontFamily: "'Poppins', sans-serif", fontWeight: 700 }}
      >
        N
      </h1>
      <h1
        className="zone-logo-letter"
        style={{ color: letterColor, fontSize: `${resolvedLetterSize}px`, lineHeight: 1, margin: 0, fontFamily: "'Poppins', sans-serif", fontWeight: 700 }}
      >
        E
      </h1>
    </div>
  );
}