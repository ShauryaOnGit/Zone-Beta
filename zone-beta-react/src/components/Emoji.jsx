// src/components/Emoji.jsx
import { Icon } from '@iconify/react';

export default function Emoji({ name, className = "w-5 h-5 inline-block" }) {
  // Map raw unicode emojis to their corresponding pack equivalents
  const emojiMap = {
    '🚀': 'fluent-emoji:rocket',
    '❤️': 'fluent-emoji:red-heart',
    '🎉': 'fluent-emoji:party-popper',
  };

  // If a raw emoji was passed, translate it; otherwise, assume a direct name was provided
  const iconIdentifier = emojiMap[name] || `fluent-emoji:${name}`;

  return (
    <Icon 
      icon={iconIdentifier} 
      className={className} 
      style={{ verticalAlign: 'middle' }}
    />
  );
}