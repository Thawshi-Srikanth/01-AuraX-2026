import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Calendar, Clock, RotateCcw, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, X } from 'lucide-react';
import { SPHERExObservation } from '../services/api';

export interface DateTimeRange {
  fromDate: string | null; // "YYYY-MM-DD"
  fromTime: string;        // "HH:MM"
  toDate: string | null;   // "YYYY-MM-DD"
  toTime: string;          // "HH:MM"
}

interface DateTimeRangeFilterProps {
  observations: SPHERExObservation[];
  distinctDates: string[]; // sorted "YYYY-MM-DD"
  range: DateTimeRange;
  onChange: (newRange: DateTimeRange) => void;
  onReset: () => void;
  filteredCount: number;
  totalCount: number;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAYS_OF_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

interface AppleTimePickerProps {
  value: string; // "HH:MM"
  onChange: (newValue: string) => void;
}

const AppleTimePicker: React.FC<AppleTimePickerProps> = ({ value, onChange }) => {
  const [hStr, mStr] = useMemo(() => {
    const parts = (value || '00:00').split(':');
    return [parts[0] || '00', parts[1] || '00'];
  }, [value]);

  const minuteInputRef = useRef<HTMLInputElement | null>(null);

  const hour = parseInt(hStr, 10) || 0;
  const minute = parseInt(mStr, 10) || 0;

  // Step functions with modular wrap-around
  const stepHour = (delta: number) => {
    const nextH = (hour + delta + 24) % 24;
    const formattedH = String(nextH).padStart(2, '0');
    onChange(`${formattedH}:${mStr}`);
  };

  const stepMinute = (delta: number) => {
    const nextM = (minute + delta + 60) % 60;
    const formattedM = String(nextM).padStart(2, '0');
    onChange(`${hStr}:${formattedM}`);
  };

  // Apple drum roll previews (previous and next digits)
  const prevHour2 = String((hour - 2 + 24) % 24).padStart(2, '0');
  const prevHour1 = String((hour - 1 + 24) % 24).padStart(2, '0');
  const nextHour1 = String((hour + 1) % 24).padStart(2, '0');
  const nextHour2 = String((hour + 2) % 24).padStart(2, '0');

  const prevMin2 = String((minute - 2 + 60) % 60).padStart(2, '0');
  const prevMin1 = String((minute - 1 + 60) % 60).padStart(2, '0');
  const nextMin1 = String((minute + 1) % 60).padStart(2, '0');
  const nextMin2 = String((minute + 2) % 60).padStart(2, '0');

  // Wheel event handlers (mouse scroll)
  const handleHourWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      stepHour(1);
    } else if (e.deltaY > 0) {
      stepHour(-1);
    }
  };

  const handleMinuteWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      stepMinute(1);
    } else if (e.deltaY > 0) {
      stepMinute(-1);
    }
  };

  // Keyboard navigation
  const handleHourKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      stepHour(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      stepHour(-1);
    } else if (e.key === 'ArrowRight' || e.key === ':') {
      e.preventDefault();
      minuteInputRef.current?.focus();
      minuteInputRef.current?.select();
    }
  };

  const handleMinuteKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      stepMinute(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      stepMinute(-1);
    }
  };

  // Direct keyboard entry with numeric validation
  const handleHourChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (raw === '') {
      onChange(`00:${mStr}`);
      return;
    }
    const val = parseInt(raw, 10);
    if (val >= 0 && val <= 23) {
      const formatted = String(val).padStart(2, '0');
      onChange(`${formatted}:${mStr}`);
      if (raw.length >= 2) {
        minuteInputRef.current?.focus();
        minuteInputRef.current?.select();
      }
    }
  };

  const handleMinuteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (raw === '') {
      onChange(`${hStr}:00`);
      return;
    }
    const val = parseInt(raw, 10);
    if (val >= 0 && val <= 59) {
      const formatted = String(val).padStart(2, '0');
      onChange(`${hStr}:${formatted}`);
    }
  };

  return (
    <div className="flex flex-col items-center select-none py-1">
      {/* Apple Wheel Columns Container */}
      <div className="flex items-center justify-center space-x-2">
        {/* Hours Cylinder Column */}
        <div
          onWheel={handleHourWheel}
          className="flex flex-col items-center w-12"
        >
          {/* Faded -2 */}
          <span className="text-[10px] text-text-tertiary opacity-25 tabular-nums h-3.5">
            {prevHour2}
          </span>

          {/* Faded -1 with Up Chevron */}
          <button
            type="button"
            onClick={() => stepHour(1)}
            className="h-5 flex items-center justify-center space-x-0.5 text-[11px] text-text-secondary hover:text-text-primary opacity-60 hover:opacity-100 transition-opacity tabular-nums cursor-pointer"
            title="Increment hour (or scroll wheel / Up arrow)"
          >
            <ChevronUp size={11} />
            <span>{prevHour1}</span>
          </button>

          {/* Typeable Central Capsule Hour Input */}
          <div className="h-8 w-12 flex items-center justify-center bg-bg-raised border border-border-strong rounded px-1 my-1 shadow-inner">
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={hStr}
              onFocus={(e) => e.target.select()}
              onChange={handleHourChange}
              onKeyDown={handleHourKeyDown}
              className="w-full text-center font-bold text-[15px] bg-transparent text-text-primary tabular-nums focus:outline-none"
              aria-label="Hour input"
            />
          </div>

          {/* Faded +1 with Down Chevron */}
          <button
            type="button"
            onClick={() => stepHour(-1)}
            className="h-5 flex items-center justify-center space-x-0.5 text-[11px] text-text-secondary hover:text-text-primary opacity-60 hover:opacity-100 transition-opacity tabular-nums cursor-pointer"
            title="Decrement hour (or scroll wheel / Down arrow)"
          >
            <ChevronDown size={11} />
            <span>{nextHour1}</span>
          </button>

          {/* Faded +2 */}
          <span className="text-[10px] text-text-tertiary opacity-25 tabular-nums h-3.5">
            {nextHour2}
          </span>
        </div>

        {/* Separator Colon */}
        <div className="flex flex-col items-center justify-center h-8 my-1">
          <span className="font-bold text-text-secondary text-[16px] select-none">:</span>
        </div>

        {/* Minutes Cylinder Column */}
        <div
          onWheel={handleMinuteWheel}
          className="flex flex-col items-center w-12"
        >
          {/* Faded -2 */}
          <span className="text-[10px] text-text-tertiary opacity-25 tabular-nums h-3.5">
            {prevMin2}
          </span>

          {/* Faded -1 with Up Chevron */}
          <button
            type="button"
            onClick={() => stepMinute(1)}
            className="h-5 flex items-center justify-center space-x-0.5 text-[11px] text-text-secondary hover:text-text-primary opacity-60 hover:opacity-100 transition-opacity tabular-nums cursor-pointer"
            title="Increment minute (or scroll wheel / Up arrow)"
          >
            <ChevronUp size={11} />
            <span>{prevMin1}</span>
          </button>

          {/* Typeable Central Capsule Minute Input */}
          <div className="h-8 w-12 flex items-center justify-center bg-bg-raised border border-border-strong rounded px-1 my-1 shadow-inner">
            <input
              ref={minuteInputRef}
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={mStr}
              onFocus={(e) => e.target.select()}
              onChange={handleMinuteChange}
              onKeyDown={handleMinuteKeyDown}
              className="w-full text-center font-bold text-[15px] bg-transparent text-text-primary tabular-nums focus:outline-none"
              aria-label="Minute input"
            />
          </div>

          {/* Faded +1 with Down Chevron */}
          <button
            type="button"
            onClick={() => stepMinute(-1)}
            className="h-5 flex items-center justify-center space-x-0.5 text-[11px] text-text-secondary hover:text-text-primary opacity-60 hover:opacity-100 transition-opacity tabular-nums cursor-pointer"
            title="Decrement minute (or scroll wheel / Down arrow)"
          >
            <ChevronDown size={11} />
            <span>{nextMin1}</span>
          </button>

          {/* Faded +2 */}
          <span className="text-[10px] text-text-tertiary opacity-25 tabular-nums h-3.5">
            {nextMin2}
          </span>
        </div>
      </div>
    </div>
  );
};

export const DateTimeRangeFilter: React.FC<DateTimeRangeFilterProps> = ({
  distinctDates,
  range,
  onChange,
  onReset,
  filteredCount,
  totalCount,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selectingType, setSelectingType] = useState<'from' | 'to'>('from');
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; left: number }>({ top: 120, left: 280 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Set of dates with available observations
  const availableDatesSet = useMemo(() => new Set(distinctDates), [distinctDates]);

  // Overall min and max observation dates
  const minObsDate = distinctDates.length > 0 ? distinctDates[0] : null;
  const maxObsDate = distinctDates.length > 0 ? distinctDates[distinctDates.length - 1] : null;

  // Internal month/year view for calendar
  const initialYear = distinctDates.length > 0 ? parseInt(distinctDates[0].split('-')[0], 10) : new Date().getUTCFullYear();
  const initialMonth = distinctDates.length > 0 ? parseInt(distinctDates[0].split('-')[1], 10) - 1 : new Date().getUTCMonth();

  const [currentYear, setCurrentYear] = useState<number>(initialYear);
  const [currentMonth, setCurrentMonth] = useState<number>(initialMonth);

  // Sync calendar month view if fromDate is active
  useEffect(() => {
    if (range.fromDate) {
      const [y, m] = range.fromDate.split('-').map(Number);
      setCurrentYear(y);
      setCurrentMonth(m - 1);
    } else if (minObsDate) {
      const [y, m] = minObsDate.split('-').map(Number);
      setCurrentYear(y);
      setCurrentMonth(m - 1);
    }
  }, [range.fromDate, minObsDate]);

  // Open shadcn-style floating popover anchored next to the trigger
  const openPopover = (type: 'from' | 'to') => {
    setSelectingType(type);
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const popoverWidth = 430;
      const fitsOnRight = rect.right + popoverWidth <= window.innerWidth;
      const left = fitsOnRight ? rect.right + 12 : Math.max(16, rect.left);
      const top = Math.max(64, Math.min(window.innerHeight - 440, rect.top));
      setPopoverCoords({ top, left });
    }
    setIsOpen(true);
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Days in currently viewed month
  const daysInMonth = new Date(Date.UTC(currentYear, currentMonth + 1, 0)).getUTCDate();
  const firstDayOfWeek = new Date(Date.UTC(currentYear, currentMonth, 1)).getUTCDay();

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleSelectDate = (dateStr: string) => {
    if (!availableDatesSet.has(dateStr)) return;

    if (selectingType === 'from') {
      let newTo = range.toDate;
      if (newTo && dateStr > newTo) {
        newTo = dateStr;
      }
      onChange({
        ...range,
        fromDate: dateStr,
        toDate: newTo,
      });
      setSelectingType('to');
    } else {
      let newFrom = range.fromDate;
      if (newFrom && dateStr < newFrom) {
        newFrom = dateStr;
      }
      onChange({
        ...range,
        fromDate: newFrom,
        toDate: dateStr,
      });
    }
  };

  const activeTime = selectingType === 'from' ? range.fromTime : range.toTime;

  const handleActiveTimeChange = (newTime: string) => {
    if (selectingType === 'from') {
      onChange({ ...range, fromTime: newTime });
    } else {
      onChange({ ...range, toTime: newTime });
    }
  };

  const handleApplyPreset = (preset: '00:00' | '12:00' | '23:59') => {
    if (selectingType === 'from') {
      onChange({ ...range, fromTime: preset });
    } else {
      onChange({ ...range, toTime: preset });
    }
  };

  const isRangeFiltered = Boolean(
    (range.fromDate && range.fromDate !== minObsDate) ||
    (range.toDate && range.toDate !== maxObsDate) ||
    range.fromTime !== '00:00' ||
    range.toTime !== '23:59'
  );

  return (
    <div className="space-y-2 border-b border-border-subtle pb-4 relative" ref={containerRef}>
      {/* Header with Title and Reset */}
      <div className="text-[11px] uppercase tracking-wider text-text-secondary flex items-center justify-between">
        <div className="flex items-center space-x-1.5">
          <Calendar size={13} className="text-text-secondary" />
          <span>Date & Time (UTC)</span>
        </div>
        {isRangeFiltered && (
          <button
            type="button"
            onClick={onReset}
            className="flex items-center space-x-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            title="Reset date/time filter"
          >
            <RotateCcw size={11} />
            <span>Reset</span>
          </button>
        )}
      </div>

      {/* From / To Stacked 2-Row Inputs */}
      <div className="space-y-1.5 text-[11px]">
        {/* Row 1: From */}
        <button
          type="button"
          onClick={() => openPopover('from')}
          className={`w-full px-2.5 py-1.5 rounded border text-left transition-colors flex items-center justify-between ${
            isOpen && selectingType === 'from'
              ? 'border-border-strong bg-bg-raised text-text-primary'
              : 'border-border-subtle hover:border-border-strong bg-bg-app text-text-secondary hover:text-text-primary'
          }`}
        >
          <div className="flex items-center space-x-2">
            <span className="text-[10px] uppercase font-semibold text-text-tertiary w-10">From</span>
            <span className="font-medium text-text-primary tabular-nums">
              {range.fromDate || minObsDate || 'Start Date'}
            </span>
          </div>
          <span className="text-[10px] text-text-secondary tabular-nums">
            {range.fromTime} UTC
          </span>
        </button>

        {/* Row 2: To */}
        <button
          type="button"
          onClick={() => openPopover('to')}
          className={`w-full px-2.5 py-1.5 rounded border text-left transition-colors flex items-center justify-between ${
            isOpen && selectingType === 'to'
              ? 'border-border-strong bg-bg-raised text-text-primary'
              : 'border-border-subtle hover:border-border-strong bg-bg-app text-text-secondary hover:text-text-primary'
          }`}
        >
          <div className="flex items-center space-x-2">
            <span className="text-[10px] uppercase font-semibold text-text-tertiary w-10">To</span>
            <span className="font-medium text-text-primary tabular-nums">
              {range.toDate || maxObsDate || 'End Date'}
            </span>
          </div>
          <span className="text-[10px] text-text-secondary tabular-nums">
            {range.toTime} UTC
          </span>
        </button>
      </div>

      {/* Observation count feedback */}
      <div className="flex items-center justify-between text-[10px] text-text-tertiary tabular-nums px-0.5">
        <span>Range Matching:</span>
        <span className={filteredCount === 0 ? 'text-science-warning font-semibold' : 'text-text-primary font-medium'}>
          {filteredCount} / {totalCount} exposures
        </span>
      </div>

      {/* Shadcn-Style Floating Popover with Backdrop */}
      {isOpen && (
        <>
          {/* Dimmed backdrop to catch clicks outside and dismiss cleanly */}
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] transition-opacity"
            onClick={() => setIsOpen(false)}
          />

          {/* Floating Popover Dialog (Side-by-Side: Calendar + Isolated Apple Time Column) */}
          <div
            className="fixed z-50 w-[425px] p-4 rounded-lg bg-bg-surface border border-border-strong shadow-[0_20px_50px_rgba(0,0,0,0.85)] space-y-3.5 select-none animate-in fade-in zoom-in-95 duration-100"
            style={{
              top: `${popoverCoords.top}px`,
              left: `${popoverCoords.left}px`,
            }}
          >
            {/* Popover Header */}
            <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
              <div className="flex items-center space-x-2 text-[12px] font-semibold text-text-primary">
                <Calendar size={14} className="text-text-secondary" />
                <span>
                  Select {selectingType === 'from' ? 'Start (From)' : 'End (To)'} — UTC
                </span>
              </div>
              <div className="flex items-center space-x-1.5">
                <button
                  type="button"
                  onClick={() => setSelectingType(selectingType === 'from' ? 'to' : 'from')}
                  className="text-[10px] px-2 py-0.5 rounded bg-bg-raised border border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors cursor-pointer"
                >
                  Switch to {selectingType === 'from' ? 'To' : 'From'}
                </button>
                <button
                  type="button"
                  aria-label="Close calendar"
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-bg-raised transition-colors cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Side-by-Side: Calendar (Left) & Isolated Time (Right) */}
            <div className="flex divide-x divide-border-subtle gap-3.5">
              {/* Left Pane: Calendar */}
              <div className="w-[245px] space-y-3 shrink-0">
                {/* Month / Year Navigation */}
                <div className="flex items-center justify-between text-[12px] px-1">
                  <button
                    type="button"
                    aria-label="Previous month"
                    onClick={handlePrevMonth}
                    className="p-1 hover:bg-bg-raised rounded text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <span className="font-semibold text-text-primary">
                    {MONTH_NAMES[currentMonth]} {currentYear}
                  </span>
                  <button
                    type="button"
                    aria-label="Next month"
                    onClick={handleNextMonth}
                    className="p-1 hover:bg-bg-raised rounded text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>

                {/* Days of Week Header */}
                <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-text-tertiary">
                  {DAYS_OF_WEEK.map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                </div>

                {/* Calendar Day Grid */}
                <div className="grid grid-cols-7 gap-1 text-[11px]">
                  {/* Empty offset days for start of month */}
                  {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                    <span key={`empty-${i}`} className="h-7 w-7" />
                  ))}

                  {/* Days in Month */}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const dayNum = i + 1;
                    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                    const hasObs = availableDatesSet.has(dateStr);

                    const isStart = range.fromDate === dateStr;
                    const isEnd = range.toDate === dateStr;
                    const inRange = Boolean(
                      range.fromDate &&
                      range.toDate &&
                      dateStr >= range.fromDate &&
                      dateStr <= range.toDate
                    );

                    return (
                      <button
                        key={dateStr}
                        type="button"
                        disabled={!hasObs}
                        onClick={() => handleSelectDate(dateStr)}
                        className={`h-7 w-7 rounded flex flex-col items-center justify-center relative transition-colors tabular-nums ${
                          isStart || isEnd
                            ? 'bg-white text-black font-bold z-10'
                            : inRange
                            ? 'bg-bg-raised text-text-primary border border-border-strong'
                            : hasObs
                            ? 'text-text-primary hover:bg-bg-hover hover:border hover:border-border-subtle cursor-pointer'
                            : 'text-text-tertiary opacity-25 cursor-not-allowed select-none'
                        }`}
                        title={hasObs ? `${dateStr} (SPHEREx Observation)` : `${dateStr} (No coverage)`}
                      >
                        <span>{dayNum}</span>
                        {hasObs && !isStart && !isEnd && (
                          <span className="w-1 h-1 rounded-full bg-white/70 absolute bottom-0.5" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right Pane: Isolated Apple-Style Active Time Selector */}
              <div className="pl-3.5 w-[145px] flex flex-col justify-between shrink-0 space-y-2">
                <div>
                  <div className="flex items-center space-x-1.5 text-[11px] font-semibold text-text-primary mb-1 pb-1.5 border-b border-border-subtle">
                    <Clock size={12} className="text-text-secondary" />
                    <span>Time (UTC)</span>
                  </div>

                  {/* Current Active Time Readout Banner */}
                  <div className="text-center py-1 mb-1 text-[13px] font-bold text-text-primary tabular-nums tracking-wider bg-bg-app border border-border-subtle rounded">
                    {activeTime}
                  </div>

                  {/* Single Apple Drum Picker for Active Target */}
                  <AppleTimePicker
                    value={activeTime}
                    onChange={handleActiveTimeChange}
                  />
                </div>

                {/* Quick Presets */}
                <div className="space-y-1 pt-1.5 border-t border-border-subtle">
                  <span className="block text-[9px] uppercase tracking-wider text-text-tertiary font-semibold text-center">
                    Presets
                  </span>
                  <div className="grid grid-cols-3 gap-1 text-[10px] tabular-nums">
                    <button
                      type="button"
                      onClick={() => handleApplyPreset('00:00')}
                      className={`py-0.5 px-1 rounded border transition-colors cursor-pointer text-center ${
                        activeTime === '00:00'
                          ? 'border-border-strong bg-bg-raised text-text-primary font-semibold'
                          : 'border-border-subtle bg-bg-app text-text-secondary hover:text-text-primary hover:border-border-strong'
                      }`}
                      title="00:00 UTC (Start of day)"
                    >
                      00:00
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyPreset('12:00')}
                      className={`py-0.5 px-1 rounded border transition-colors cursor-pointer text-center ${
                        activeTime === '12:00'
                          ? 'border-border-strong bg-bg-raised text-text-primary font-semibold'
                          : 'border-border-subtle bg-bg-app text-text-secondary hover:text-text-primary hover:border-border-strong'
                      }`}
                      title="12:00 UTC (Noon)"
                    >
                      12:00
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyPreset('23:59')}
                      className={`py-0.5 px-1 rounded border transition-colors cursor-pointer text-center ${
                        activeTime === '23:59'
                          ? 'border-border-strong bg-bg-raised text-text-primary font-semibold'
                          : 'border-border-subtle bg-bg-app text-text-secondary hover:text-text-primary hover:border-border-strong'
                      }`}
                      title="23:59 UTC (End of day)"
                    >
                      23:59
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Footer */}
            <div className="border-t border-border-subtle pt-2.5 flex items-center justify-between">
              <button
                type="button"
                onClick={onReset}
                className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
              >
                Reset to All
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-3 py-1 bg-white text-black text-[11px] font-semibold rounded hover:bg-neutral-200 transition-colors cursor-pointer"
              >
                Apply Range
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
