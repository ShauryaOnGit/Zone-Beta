// Normalized score (0-100) -> cover opacity.
// Linear mapping, scaled to a 0.82 max, so equal score differences
// produce equally visible opacity differences across the whole range
// (a 100 vs an 87 looks meaningfully different, not just a 50 vs a 100).
// Capped at 0.82 so a low score still shows a hint of the gradient,
// never a flat, featureless card.
function scoreToCoverOpacity(score) {
  const clamped = Math.max(0, Math.min(100, score));
  const inverted = (100 - clamped) / 100; // 0 at score=100, 1 at score=0
  return inverted * 0.82;
}

export default function FeedCard({
  userName,
  userAvatar,
  date,
  title,
  timeElapsed,
  focusScore,
  bgGradient = "radial-gradient(circle 340px at 50% 0%, #eaf3ff 0%, #bcdcff 35%, #7fb8ef 70%, #5a9edd 100%)",
  fadeColor = "#bcdcff",
  textColor = "text-slate-900",
  mutedColor = "text-slate-600",
  coverColor = "#e7edf3",
  bgImage,
  reactions,
}) {
  const coverOpacity = scoreToCoverOpacity(parseFloat(focusScore));
  // Reactions row gets the same fog, but capped at roughly half strength —
  // it should still read as "part of the same darkened card," never fully obscured,
  // since the pills need to stay clearly legible and tappable at any score.
  const reactionsCoverOpacity = coverOpacity * 0.55;

  return (
    <div style={{ background: bgGradient }} className={`relative rounded-md overflow-hidden shadow-xl flex flex-col ${textColor} w-full break-inside-avoid mb-6 border border-[#D0D7DE]`}>
      <div className="p-6 pb-4 relative">
        <div
          className="absolute inset-0 z-0 pointer-events-none transition-opacity duration-700"
          style={{ background: coverColor, opacity: coverOpacity }}
        />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-5">
            <img src={userAvatar} alt={userName} className="w-10 h-10 rounded-full border border-black/10" />
            <div>
              <h3 className="font-bold text-sm tracking-wide">{userName}</h3>
              <p className={`text-xs ${mutedColor}`}>{date}</p>
            </div>
          </div>
          <h2 className="text-[20px] leading-tight font-extrabold mb-6">{title}</h2>
          <div className="flex gap-8">
            <div>
              <p className={`text-[10px] uppercase tracking-widest font-semibold ${mutedColor} mb-1`}>Time Elapsed</p>
              <p className="text-lg font-semibold">{timeElapsed}</p>
            </div>
            <div>
              <p className={`text-[10px] uppercase tracking-widest font-semibold ${mutedColor} mb-1`}>Focus Score</p>
              <p className="text-lg font-semibold">{focusScore}</p>
            </div>
          </div>
        </div>
      </div>
      {bgImage && (
        <div className="relative w-full h-40" style={{ background: fadeColor }}>
          <img
            src={bgImage}
            alt={title}
            className="w-full h-full object-cover"
          />
        </div>
      )}
      <div className="px-6 py-4 relative">
        <div
          className="absolute inset-0 z-0 pointer-events-none transition-opacity duration-700"
          style={{ background: coverColor, opacity: reactionsCoverOpacity }}
        />
        <div className="relative z-10 flex gap-3">
          {reactions.map((reaction, idx) => (
            <button key={idx} className="flex cursor-pointer items-center gap-2 border border-black/10 bg-white/80 hover:bg-white transition-all px-3 py-1 rounded-full text-xs font-semibold text-slate-800 shadow-sm backdrop-blur-md">
              <span>{reaction.emoji}</span>
              <span>{reaction.count}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}