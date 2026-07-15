// src/components/Calendar.jsx
import { useState } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, startOfWeek, endOfWeek } from 'date-fns';

export default function Calendar() {
  // Brought the state back inside the component!
  const [currentDate, setCurrentDate] = useState(new Date());

  const monthStart = startOfMonth(currentDate);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
  const endDate = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="bg-white rounded-md border border-slate-100 p-6 shadow-sm">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-2xl font-bold">{format(currentDate, 'MMMM yyyy')}</h2>
        <div className="flex items-center gap-4">
          <div className="flex border rounded-lg p-1">
            <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="px-3 py-1 hover:bg-slate-50 rounded">←</button>
            <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="px-3 py-1 hover:bg-slate-50 rounded">→</button>
          </div>
          <div className="flex border rounded-lg p-1 text-sm font-medium">
            <button className="px-3 py-1">Day</button>
            <button className="px-3 py-1">Week</button>
            <button className="px-3 py-1 bg-slate-100 rounded">Month</button>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-7 border-t border-l">
        {dayNames.map(d => (
          <div key={d} className="py-3 text-center text-xs font-bold text-slate-400 border-b border-r">{d}</div>
        ))}
        {days.map(d => (
          <div key={d} className="h-32 border-b border-r p-2 text-sm text-slate-400 hover:bg-slate-50">
            {format(d, 'd')}
          </div>
        ))}
      </div>
    </div>
  );
}