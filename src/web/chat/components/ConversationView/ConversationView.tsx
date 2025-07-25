import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { MessageList } from '../MessageList/MessageList';
import { Composer } from '@/web/common/components/Composer';
import { ConversationHeader } from '../ConversationHeader/ConversationHeader';
import { api } from '../../services/api';
import { useStreaming, useConversationMessages } from '../../hooks';
import type { ChatMessage, ConversationDetailsResponse, ConversationMessage, ConversationSummary } from '../../types';
import styles from './ConversationView.module.css';

export function ConversationView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string>('Conversation');
  const [isPermissionDecisionLoading, setIsPermissionDecisionLoading] = useState(false);
  const [conversationSummary, setConversationSummary] = useState<ConversationSummary | null>(null);

  // Use shared conversation messages hook
  const {
    messages,
    toolResults,
    currentPermissionRequest,
    childrenMessages,
    expandedTasks,
    clearMessages,
    addMessage,
    setAllMessages,
    handleStreamMessage,
    toggleTaskExpanded,
    clearPermissionRequest,
    setPermissionRequest,
  } = useConversationMessages({
    onResult: (newSessionId) => {
      // Navigate to the new session page if session changed
      if (newSessionId && newSessionId !== sessionId) {
        navigate(`/c/${newSessionId}`);
      }
    },
    onError: (err) => {
      setError(err);
      setStreamingId(null);
    },
    onClosed: () => {
      setStreamingId(null);
    },
  });

  // Clear navigation state to prevent issues on refresh
  useEffect(() => {
    const state = location.state;
    
    if (state) {
      // Clear the state to prevent issues on refresh
      window.history.replaceState({}, document.title);
    }
  }, [location]);

  // Clear streaming when navigating away or sessionId changes
  useEffect(() => {
    // Clear streamingId when sessionId changes
    setStreamingId(null);
    
    return () => {
      // Clear streaming when navigating away
      setStreamingId(null);
    };
  }, [sessionId]);

  // Load conversation history
  useEffect(() => {
    const loadConversation = async () => {
      if (!sessionId) return;
      
      setIsLoading(true);
      setError(null);

      try {
        const details = await api.getConversationDetails(sessionId);
        const chatMessages = convertToChatlMessages(details);
        
        // Always load fresh messages from backend
        setAllMessages(chatMessages);
        
        // Set conversation title from first user message
        const firstUserMessage = chatMessages.find(msg => msg.type === 'user');
        if (firstUserMessage && typeof firstUserMessage.content === 'string') {
          setConversationTitle(firstUserMessage.content.slice(0, 100));
        }
        
        // Check if this conversation has an active stream
        const conversationsResponse = await api.getConversations({ limit: 100 });
        const currentConversation = conversationsResponse.conversations.find(
          conv => conv.sessionId === sessionId
        );
        
        if (currentConversation) {
          setConversationSummary(currentConversation);
          
          if (currentConversation.status === 'ongoing' && currentConversation.streamingId) {
            // Active stream, check for existing pending permissions
            setStreamingId(currentConversation.streamingId);
            
            try {
              const { permissions } = await api.getPermissions({ 
                streamingId: currentConversation.streamingId, 
                status: 'pending' 
              });
              
              if (permissions.length > 0) {
                // Take the most recent pending permission (by timestamp)
                const mostRecentPermission = permissions.reduce((latest, current) => 
                  new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest
                );
                
                setPermissionRequest(mostRecentPermission);
              }
            } catch (permissionError) {
              // Don't break conversation loading if permission fetching fails
              console.warn('[ConversationView] Failed to fetch existing permissions:', permissionError);
            }
          }
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load conversation');
      } finally {
        setIsLoading(false);
      }
    };

    loadConversation();
  }, [sessionId, setAllMessages]);

  const { isConnected, disconnect } = useStreaming(streamingId, {
    onMessage: handleStreamMessage,
    onError: (err) => {
      setError(err.message);
      setStreamingId(null);
    },
  });

  const handleSendMessage = async (message: string, workingDirectory?: string, model?: string, permissionMode?: string) => {
    if (!sessionId) return;

    setError(null);

    try {
      const response = await api.resumeConversation({
        sessionId,
        message,
      });

      // Navigate immediately to the new session
      navigate(`/c/${response.sessionId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to send message');
    }
  };

  const handleStop = async () => {
    if (!streamingId) return;

    try {
      // Call the API to stop the conversation
      await api.stopConversation(streamingId);
      
      // Disconnect the streaming connection
      disconnect();
      
      // Clear the streaming ID
      setStreamingId(null);
      
      // Streaming has stopped
    } catch (err: any) {
      console.error('Failed to stop conversation:', err);
      setError(err.message || 'Failed to stop conversation');
    }
  };

  const handlePermissionDecision = async (requestId: string, action: 'approve' | 'deny') => {
    if (isPermissionDecisionLoading) return;

    setIsPermissionDecisionLoading(true);
    try {
      await api.sendPermissionDecision(requestId, { action });
      // Clear the permission request after successful decision
      clearPermissionRequest();
    } catch (err: any) {
      console.error('Failed to send permission decision:', err);
      setError(err.message || 'Failed to send permission decision');
    } finally {
      setIsPermissionDecisionLoading(false);
    }
  };


  return (
    <div className={styles.container}>
      <ConversationHeader 
        title={conversationTitle}
        sessionId={sessionId}
        subtitle={conversationSummary ? {
          date: new Date(conversationSummary.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          repo: conversationSummary.projectPath.split('/').pop() || 'project',
          commitSHA: conversationSummary.sessionInfo.initial_commit_head,
          changes: conversationSummary.toolMetrics ? {
            additions: conversationSummary.toolMetrics.linesAdded,
            deletions: conversationSummary.toolMetrics.linesRemoved
          } : undefined
        } : undefined}
      />
      
      {error && (
        <div className={styles.error}>
          {error}
        </div>
      )}

      <MessageList 
        messages={messages}
        toolResults={toolResults}
        childrenMessages={childrenMessages}
        expandedTasks={expandedTasks}
        onToggleTaskExpanded={toggleTaskExpanded}
        isLoading={isLoading}
        isStreaming={!!streamingId}
      />

      <div className={styles.composerWrapper}>
        <Composer
          onSubmit={handleSendMessage}
          onStop={handleStop}
          onPermissionDecision={handlePermissionDecision}
          isLoading={isConnected || isPermissionDecisionLoading}
          placeholder="Continue the conversation..."
          permissionRequest={currentPermissionRequest}
          showPermissionUI={true}
          showStopButton={true}
          enableFileAutocomplete={true}
          workingDirectory={conversationSummary?.projectPath}
          onFetchFileSystem={async (directory) => {
            const response = await api.listDirectory({
              path: directory,
              recursive: true,
              respectGitignore: true,
            });
            return response.entries;
          }}
        />
      </div>

    </div>
  );
}

// Helper function to convert API response to chat messages
function convertToChatlMessages(details: ConversationDetailsResponse): ChatMessage[] {
  // Create a map for quick parent message lookup
  const messageMap = new Map<string, ConversationMessage>();
  details.messages.forEach(msg => messageMap.set(msg.uuid, msg));

  return details.messages
    .filter(msg => !msg.isSidechain) // Filter out sidechain messages
    .map(msg => {
      // Extract content from the message structure
      let content = msg.message;
      
      // Handle Anthropic message format
      if (typeof msg.message === 'object' && 'content' in msg.message) {
        content = msg.message.content;
      }
      
      return {
        id: msg.uuid,
        messageId: msg.uuid, // For historical messages, use UUID as messageId
        type: msg.type as 'user' | 'assistant' | 'system',
        content: content,
        timestamp: msg.timestamp,
        workingDirectory: msg.cwd, // Add working directory from backend message
      };
    });
}