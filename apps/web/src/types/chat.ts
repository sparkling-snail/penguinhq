export interface ChatMessage {
  id: string;
  channel: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  content: string;
  createdAt: string;
}

export interface ChatChannel {
  id: string;
  label: string;
  description: string;
}
