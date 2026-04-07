export interface AnbyMeeting {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  attendeeIds: string[];
  summary?: string;
  actionItems?: string[];
}
