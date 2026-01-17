import { useState } from 'react'
import { fetchServerSentEvents, useChat } from '@tanstack/ai-react'

import './Chat.css'

interface ChatProps {
  projectPath?: string
}

export default function Chat({ projectPath }: ChatProps) {
  const [input, setInput] = useState('')

  const { messages, sendMessage, isLoading, error } = useChat({
    connection: fetchServerSentEvents('/api/chat'),
    body: projectPath ? { projectPath } : undefined,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim() && !isLoading) {
      sendMessage(input)
      setInput('')
    }
  }

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty-state">
            <p>Start a conversation by typing a message below.</p>
          </div>
        )}
        {messages.map(message => (
          <div key={message.id} className={`chat-message chat-message-${message.role}`}>
            <div className="chat-message-role">{message.role === 'user' ? 'You' : 'Assistant'}</div>
            <div className="chat-message-content">
              {message.parts.map((part, idx) => {
                if (part.type === 'text') {
                  return (
                    <div key={idx} className="chat-message-text">
                      {part.content}
                    </div>
                  )
                }
                return null
              })}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="chat-message chat-message-assistant">
            <div className="chat-message-role">Assistant</div>
            <div className="chat-message-content">
              <div className="chat-loading-indicator">Thinking...</div>
            </div>
          </div>
        )}
        {error && (
          <div className="chat-error">
            <p>Error: {error.message}</p>
          </div>
        )}
      </div>
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type your message..."
          disabled={isLoading}
        />
        <button type="submit" className="chat-send-button" disabled={isLoading || !input.trim()}>
          {isLoading ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  )
}
