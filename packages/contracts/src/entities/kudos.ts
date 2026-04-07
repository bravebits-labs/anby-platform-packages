export interface AnbyKudos {
  id: string;
  senderId: string;
  recipientIds: string[];
  message: string;
  category: 'teamwork' | 'innovation' | 'helpfulness' | 'problem_solving' | 'leadership' | 'mentorship' | 'customer_focus' | 'above_and_beyond';
}
