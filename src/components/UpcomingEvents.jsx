// src/components/UpcomingEvents.jsx
export default function UpcomingEvents() {
  return (
    <div className="hidden xl:block w-50 space-y-6 flex-shrink-0">
      <div className="flex justify-between items-center">
        <h3 className="font-bold text-lg">Upcoming Events</h3>
        <button className="text-sm text-blue-600 font-medium">See all</button>
      </div>
      
      {/* Event Cards */}
      <div className="bg-white p-4 rounded-md border border-slate-100 shadow-sm space-y-2">
        <span className="text-[10px] uppercase font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded">Workshop</span>
        <p className="font-bold text-sm">Product Strategy & Design System Review</p>
        <p className="text-xs text-slate-500">10:00 AM - 12:30 PM</p>
      </div>

      <div className="bg-white p-4 rounded-md border border-slate-100 shadow-sm space-y-2">
        <span className="text-[10px] uppercase font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded">Workshop</span>
        <p className="font-bold text-sm">Product Strategy & Design System Review</p>
        <p className="text-xs text-slate-500">10:00 AM - 12:30 PM</p>
      </div>

    </div>
  );
}