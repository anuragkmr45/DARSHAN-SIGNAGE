import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { type ScheduleQuickPresetId } from "@/lib/scheduleQuickPresets";

interface StepScheduleDetailsProps {
  scheduleName: string;
  scheduleDescription: string;
  timezone: string;
  startAt: string;
  endAt: string;
  priority: number;
  validationErrors?: string[];
  isCheckingAvailability?: boolean;
  hasSelectedTargets?: boolean;
  onApplyQuickPreset?: (preset: ScheduleQuickPresetId) => void;
  onUpdate: (updates: Partial<{
    scheduleName: string;
    scheduleDescription: string;
    timezone: string;
    startAt: string;
    endAt: string;
    priority: number;
  }>) => void;
}

const priorityOptions = [
  { value: "0", label: "Normal", description: "Standard priority" },
  { value: "1", label: "High", description: "Takes precedence over normal" },
  { value: "2", label: "Urgent", description: "Highest priority level" },
];

export function StepScheduleDetails({
  scheduleName,
  scheduleDescription,
  timezone,
  startAt,
  endAt,
  priority,
  validationErrors,
  isCheckingAvailability,
  hasSelectedTargets,
  onApplyQuickPreset,
  onUpdate,
}: StepScheduleDetailsProps) {
  const currentTimezone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const timezoneOptions = Array.from(
    new Set([
      currentTimezone,
      "UTC",
      "Asia/Kolkata",
      "Asia/Dubai",
      "Europe/London",
      "Europe/Berlin",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "Australia/Sydney",
    ]),
  );

  const quickPresets: Array<{ id: ScheduleQuickPresetId; label: string }> = [
    { id: "today", label: "Today" },
    { id: "tomorrow", label: "Tomorrow" },
    { id: "this_week", label: "This Week" },
    { id: "this_month", label: "This Month" },
  ];

  const minDate = new Date();
  minDate.setSeconds(0, 0);
  minDate.setMinutes(minDate.getMinutes() + 1);
  const minStartAt = `${minDate.getFullYear()}-${String(minDate.getMonth() + 1).padStart(2, "0")}-${String(
    minDate.getDate(),
  ).padStart(2, "0")}T${String(minDate.getHours()).padStart(2, "0")}:${String(minDate.getMinutes()).padStart(2, "0")}`;
  const minEndAt = startAt || minStartAt;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Schedule Details</h2>
        <p className="text-sm text-muted-foreground">
          Set the name, timing, and priority for your schedule
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column - Basic info */}
        <div className="space-y-6">
          <Card className="p-4 space-y-4">
            <h3 className="font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Basic Information
            </h3>

            <div className="space-y-2">
              <Label htmlFor="schedule-name">Schedule Name *</Label>
              <Input
                id="schedule-name"
                value={scheduleName}
                onChange={(e) => onUpdate({ scheduleName: e.target.value })}
                placeholder="e.g., Q1 Marketing Campaign"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="schedule-desc">Description</Label>
              <Textarea
                id="schedule-desc"
                value={scheduleDescription}
                onChange={(e) => onUpdate({ scheduleDescription: e.target.value })}
                placeholder="Describe what this schedule is for..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={priority.toString()}
                onValueChange={(val) => onUpdate({ priority: parseInt(val) })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  {priorityOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex flex-col">
                        <span>{opt.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {opt.description}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Audit Timezone</Label>
              <Select value={timezone} onValueChange={(value) => onUpdate({ timezone: value })}>
                <SelectTrigger aria-label="Schedule timezone">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {timezoneOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Stored for audit and operator visibility. Playback still executes against UTC timestamps.
              </p>
            </div>
          </Card>
        </div>

        {/* Right column - Date/Time */}
        <div className="space-y-6">
          <Card className="p-4 space-y-4">
            <h3 className="font-medium flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-primary" />
              Schedule Timing
            </h3>

            <div className="space-y-2">
              <Label htmlFor="start-at">Start Date & Time *</Label>
              <Input
                id="start-at"
                type="datetime-local"
                value={startAt}
                onChange={(e) => onUpdate({ startAt: e.target.value })}
                min={minStartAt}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="end-at">End Date & Time *</Label>
              <Input
                id="end-at"
                type="datetime-local"
                value={endAt}
                onChange={(e) => onUpdate({ endAt: e.target.value })}
                min={minEndAt}
              />
            </div>

            {isCheckingAvailability && (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Checking selected screens and groups for schedule conflicts...
              </div>
            )}

            {validationErrors && validationErrors.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <p className="font-medium">Schedule timing needs attention</p>
                <ul className="mt-2 list-disc pl-5 space-y-1">
                  {validationErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            )}

            {startAt && endAt && (
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-sm font-medium">Duration</p>
                <p className="text-sm text-muted-foreground">
                  {(() => {
                    const start = new Date(startAt);
                    const end = new Date(endAt);
                    const diffMs = end.getTime() - start.getTime();
                    if (diffMs < 0) return "Invalid range";
                    const hours = Math.floor(diffMs / (1000 * 60 * 60));
                    const minutes = Math.floor(diffMs / (1000 * 60));
                    const days = Math.floor(hours / 24);
                    const remainingHours = hours % 24;
                    if (days > 0) {
                      return `${days} day(s)${remainingHours > 0 ? `, ${remainingHours} hour(s)` : ""}`;
                    }
                    if (hours === 0) {
                      return `${minutes} minute(s)`;
                    }
                    return `${hours} hour(s)`;
                  })()}
                </p>
              </div>
            )}
          </Card>

          {/* Quick presets */}
          <Card className="p-4 space-y-3">
            <h3 className="font-medium text-sm">Quick Presets</h3>
            <p className="text-xs text-muted-foreground">
              Fills the first free slot available on the selected screens/groups inside the chosen range.
            </p>
            <div className="flex flex-wrap gap-2">
              {quickPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onApplyQuickPreset?.(preset.id)}
                  disabled={!hasSelectedTargets || isCheckingAvailability}
                  className="px-3 py-1 text-sm border rounded-full hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {!hasSelectedTargets && (
              <p className="text-xs text-muted-foreground">
                Select at least one screen or group to use quick presets.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
