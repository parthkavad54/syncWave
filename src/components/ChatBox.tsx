import React, { useState, useEffect, useRef } from "react";
import { Send } from "lucide-react";
import { ChatMessage } from "../lib/types";

interface ChatBoxProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  currentUserId: string;
}

export default function ChatBox({ messages, onSendMessage, currentUserId }: ChatBoxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const [lastReadCount, setLastReadCount] = useState(0);

  const unreadCount = isOpen ? 0 : Math.max(0, messages.length - lastReadCount);

  useEffect(() => {
    if (isOpen) {
      setLastReadCount(messages.length);
      if (endOfMessagesRef.current) {
        endOfMessagesRef.current.scrollIntoView({ behavior: "smooth" });
      }
    }
  }, [messages.length, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      onSendMessage(inputText.trim());
      setInputText("");
    }
  };

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-[100] w-14 h-14 rounded-full bg-party-violet text-white shadow-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        {!isOpen && unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-ping"></span>
        )}
      </button>

      {/* Chat Overlay */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-[100] w-80 sm:w-96 h-[400px] max-h-[60vh] glass flex flex-col rounded-2xl overflow-hidden animate-in slide-in-from-bottom-5 bg-[var(--theme-bg)]" >
          <div className="p-4 border-b border-[var(--theme-glass-border)] flex justify-between items-center bg-[var(--theme-glass-bg)]" >
            <h3 className="font-bold text-lg">Party Chat</h3>
            <button onClick={() => setIsOpen(false)} className="opacity-50 hover:opacity-100">✕</button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 ? (
              <p className="text-center text-sm opacity-50 mt-10">No messages yet. Be the first to say hi!</p>
            ) : (
              messages.map((msg, idx) => {
                const isMe = msg.userId === currentUserId;
                return (
                  <div key={msg.id || idx} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                    <span className="text-[10px] opacity-50 mb-1 ml-1">{msg.name}</span>
                    <div className={`px-4 py-2 rounded-2xl max-w-[85%] text-sm ${isMe ? 'bg-party-violet text-white rounded-br-sm' : 'rounded-bl-sm bg-[var(--theme-glass-bg)] border border-[var(--theme-glass-border)]'}`} >
                      {msg.text}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={endOfMessagesRef} />
          </div>

          <form onSubmit={handleSubmit} className="p-3 border-t border-[var(--theme-glass-border)] flex gap-2 bg-[var(--theme-glass-bg)]" >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 border rounded-full px-4 py-2 text-sm focus:outline-none focus:border-party-violet bg-[var(--theme-glass-bg)] border-[var(--theme-glass-border)] text-theme"
              
            />
            <button type="submit" disabled={!inputText.trim()} className="p-2 rounded-full bg-party-violet disabled:opacity-50 text-white">
              <Send size={18} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
