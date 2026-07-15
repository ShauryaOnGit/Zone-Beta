import FeedCard from '../FeedCard';
import { feedCardThemes } from '../feedCardThemes';

export default function Feed() {
  const mockFeedData = [
    { id: 1, userName: 'Alex Coduhr', userAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex', date: '18th July 2026 , 15:34', title: 'Studying Astrophysics', timeElapsed: '09:38:04', focusScore: '80', themeId: 'ocean', bgImage: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?q=80&w=800&auto=format&fit=crop', reactions: [{ emoji: '🚀', count: 12 }, { emoji: '❤️', count: 8 }, { emoji: '🎉', count: 4 }] },
    { id: 2, userName: 'Jordan Smith', userAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Jordan', date: '19th July 2026 , 10:15', title: 'Designing a New App Interface', timeElapsed: '05:22:10', focusScore: '09', themeId: 'grape', bgImage: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?q=80&w=800&auto=format&fit=crop', reactions: [{ emoji: '🚀', count: 20 }, { emoji: '❤️', count: 15 }, { emoji: '🎉', count: 5 }] },
    { id: 3, userName: 'Taylor Lee', userAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Taylor', date: '20th July 2026 , 08:45', title: 'Writing a Research Paper on AI Ethics', timeElapsed: '12:15:30', focusScore: '100', themeId: 'sunset', reactions: [{ emoji: '🚀', count: 18 }, { emoji: '❤️', count: 10 }, { emoji: '🎉', count: 7 }] },
    { id: 4, userName: 'Morgan Davis', userAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Morgan', date: '21st July 2026 , 14:20', title: 'Learning Quantum Computing', timeElapsed: '07:50:15', focusScore: '30', themeId: 'meadow', bgImage: 'https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=800&auto=format&fit=crop', reactions: [{ emoji: '🚀', count: 25 }, { emoji: '❤️', count: 12 }, { emoji: '🎉', count: 9 }] },
    { id: 5, userName: 'Casey Brown', userAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Casey', date: '22nd July 2026 , 11:05', title: 'Exploring the Depths of the Ocean', timeElapsed: '03:40:50', focusScore: '60', themeId: 'lavender', reactions: [{ emoji: '🚀', count: 30 }, { emoji: '❤️', count: 20 }, { emoji: '🎉', count: 15 }] },
  ];
  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-8 text-slate-900">Activity Feed</h2>
      <div className="columns-1 md:columns-2 gap-6 space-y-3">
        {mockFeedData.map(card => {
          const theme = feedCardThemes.find(t => t.id === card.themeId) ?? feedCardThemes[0];
          return (
            <FeedCard
              key={card.id}
              {...card}
              bgGradient={theme.gradient}
              fadeColor={theme.fadeColor}
            />
          );
        })}
      </div>
    </div>
  );
}