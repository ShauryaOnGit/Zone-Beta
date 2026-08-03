import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import EmojiPicker from 'emoji-picker-react';

function scoreToCoverOpacity(score) {
  const clamped = Math.max(0, Math.min(100, score));
  const inverted = (100 - clamped) / 100;
  return inverted * 0.82;
}

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export default function FeedCard({
  cardId, 
  currentUserId,
  supabase,
  userId,
  userName,
  userAvatar,
  onUserClick,
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
  initialReactions = [],
}) {
  const coverOpacity = scoreToCoverOpacity(parseFloat(focusScore));
  const reactionsCoverOpacity = coverOpacity * 0.55;

  const [reactions, setReactions] = useState(initialReactions);
  const [showQuickBar, setShowQuickBar] = useState(false);
  const [showFullPicker, setShowFullPicker] = useState(false);
  const quickBarRef = useRef(null);

  // Close quick bar when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (quickBarRef.current && !quickBarRef.current.contains(event.target)) {
        setShowQuickBar(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleReaction = async (emojiStr) => {
    const existingReaction = reactions.find((r) => r.emoji === emojiStr);
    const hasReacted = existingReaction?.userHasReacted;

    // Optimistic UI update
    setReactions((prev) => {
      let updated = [...prev];
      const index = updated.findIndex((r) => r.emoji === emojiStr);

      if (index > -1) {
        updated[index] = {
          ...updated[index],
          count: hasReacted ? updated[index].count - 1 : updated[index].count + 1,
          userHasReacted: !hasReacted,
        };
      } else {
        updated.push({
          emoji: emojiStr,
          count: 1,
          userHasReacted: true,
        });
      }

      return updated.filter((r) => r.count > 0);
    });

    setShowQuickBar(false);
    setShowFullPicker(false);

    // Supabase mutation
    try {
      if (hasReacted) {
        const { error } = await supabase
          .from("card_reactions")
          .delete()
          .match({ card_id: cardId, user_id: currentUserId, emoji: emojiStr });
        
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("card_reactions")
          .insert({ card_id: cardId, user_id: currentUserId, emoji: emojiStr });
        
        if (error) throw error;
      }
    } catch (error) {
      console.error("Error toggling reaction:", error);
    }
  };

  return (
    <div style={{ background: bgGradient }} className={`relative rounded-md ${textColor} w-full break-inside-avoid mb-6 border border-[#D0D7DE] ${showQuickBar ? 'z-40' : 'z-0'}`}>
      
      {/* --- Card Header & Content --- */}
      <div className="p-6 pb-4 relative rounded-t-md overflow-hidden">
        <div
          className="absolute inset-0 z-0 pointer-events-none transition-opacity duration-700"
          style={{ background: coverColor, opacity: coverOpacity }}
        />
        <div className="relative z-10">
          <div
            className={`flex items-center gap-3 mb-5 ${onUserClick ? 'cursor-pointer group/user w-fit' : ''}`}
            onClick={onUserClick ? () => onUserClick(userId) : undefined}
          >
            <img
              src={userAvatar}
              alt={userName}
              className={`w-10 h-10 rounded-full border border-[#D0D7DE] ${onUserClick ? 'group-hover/user:opacity-80 transition-opacity' : ''}`}
            />
            <div>
              <h3 className={`font-bold text-sm tracking-wide ${onUserClick ? 'group-hover/user:underline' : ''}`}>{userName}</h3>
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
        <div className="relative w-full h-40 overflow-hidden" style={{ background: fadeColor }}>
          <img src={bgImage} alt={title} className="w-full h-full object-cover" />
        </div>
      )}

      {/* --- Interactive Reactions Section --- */}
      <div className="px-6 py-4 relative rounded-b-md">
        <div
          className="absolute inset-0 z-0 pointer-events-none transition-opacity duration-700 rounded-b-md overflow-hidden"
          style={{ background: coverColor, opacity: reactionsCoverOpacity }}
        />
        
        <div className="relative z-10 flex gap-2 items-center flex-wrap">
          {/* Active Reactions Pills */}
          {reactions.map((reaction, idx) => (
            <button 
              key={idx} 
              onClick={() => toggleReaction(reaction.emoji)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold shadow-sm backdrop-blur-md transition-all bg-white/60 
                ${reaction.userHasReacted 
                  ? 'border-2 border-black' 
                  : 'border-2 border-[#D0D7DE]'
                }`}
            >
              <span>{reaction.emoji}</span>
              <span>{reaction.count}</span>
            </button>
          ))}

          {/* WhatsApp-Style Reaction Trigger */}
          <div className="relative" ref={quickBarRef}>
            <button 
              onClick={() => setShowQuickBar(!showQuickBar)}
              className="flex items-center justify-center w-7 h-7 rounded-full border border-[#D0D7DE] bg-white/60 hover:bg-white text-slate-600 transition-all backdrop-blur-md"
              title="Add reaction"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>

            {/* Quick Emoji Bar Popover */}
            {showQuickBar && (
              <div className="absolute h-9 left-0 bottom-full mb-2 z-30 flex items-center p-1.5 bg-white/95 backdrop-blur-md rounded-full shadow-sm border border-[#D0D7DE]">
                {QUICK_EMOJIS.map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => toggleReaction(emoji)}
                    className="hover:scale-125 transition-transform duration-150 p-1 text-base rounded-full"
                  >
                    {emoji}
                  </button>
                ))}
                
                {/* Plus button to trigger full picker modal */}
                <button
                  onClick={() => {
                    setShowQuickBar(false);
                    setShowFullPicker(true);
                  }}
                  className="w-7 h-7 flex items-center justify-center hover:bg-slate-100 text-slate-500 rounded-full text-xs font-bold transition-colors ml-1"
                  title="More emojis"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* --- Full Emoji Picker Portal Modal --- */}
      {showFullPicker && createPortal(
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setShowFullPicker(false)}
        >
          <div 
            className="relative bg-white rounded-md shadow-sm overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <EmojiPicker
              onEmojiClick={(emojiData) => {
                toggleReaction(emojiData.emoji);
                setShowFullPicker(false);
              }}
              width={350}
              height={400}
              skinTonesDisabled={true}
              previewConfig={{ showPreview: false }}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}