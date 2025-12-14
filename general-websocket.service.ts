import {
  Injectable,
  inject,
  DestroyRef,
  signal,
  computed,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Client, IMessage, StompSubscription } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { BehaviorSubject, Subject } from 'rxjs';
import { ENVIRONMENT, Environment } from '@codeme/shared/environment';
import {
  InvitationResponseDTO,
  CommentResponseDTO,
  MessageResponseDTO,
  StatusChangeEvent,
} from '../models';

export enum WebSocketEventType {
  INVITATION_NEW = 'INVITATION_NEW',
  INVITATION_RESPONSE = 'INVITATION_RESPONSE',
  COMMENT_NEW = 'COMMENT_NEW',
  COMMENT_UPDATE = 'COMMENT_UPDATE',
  COMMENT_DELETE = 'COMMENT_DELETE',
  REPLY_NEW = 'REPLY_NEW',
  REPLY_UPDATE = 'REPLY_UPDATE',
  REPLY_DELETE = 'REPLY_DELETE',
  MESSAGE_NEW = 'MESSAGE_NEW',
  MESSAGE_UPDATE = 'MESSAGE_UPDATE',
  MESSAGE_DELETE = 'MESSAGE_DELETE',
  USER_STATUS_CHANGE = 'USER_STATUS_CHANGE',
  TYPING_INDICATOR = 'TYPING_INDICATOR',
}

export interface WebSocketEvent<T = any> {
  type: WebSocketEventType;
  data: T;
  conversationId?: number;
  postId?: number;
  commentId?: number;
  timestamp: number;
}

export interface TypingIndicatorData {
  userId: number;
  username: string;
  conversationId: number;
  isTyping: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class GeneralWebSocketService {
  private env = inject<Environment>(ENVIRONMENT);
  private destroyRef = inject(DestroyRef);

  private client: Client | null = null;
  private subscriptions = new Map<string, StompSubscription>();
  private pendingSubscriptions: Array<() => void> = [];
  private connectionPromise: Promise<void> | null = null;
  private heartbeatInterval: number | null = null;

  private eventSubject = new Subject<WebSocketEvent>();
  private connectionStatusSubject = new BehaviorSubject<boolean>(false);

  readonly isConnected = signal(false);
  readonly events$ = this.eventSubject.asObservable();
  readonly connectionStatus$ = this.connectionStatusSubject.asObservable();

  readonly invitations$ = computed(() =>
    this.events$.pipe(takeUntilDestroyed(this.destroyRef))
  );

  connect(token: string): Promise<void> {
    if (this.client?.active) {
      return Promise.resolve();
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      const wsUrl = `${this.env.baseUrl.replace('/api', '')}/ws`;

      this.client = new Client({
        webSocketFactory: () => new SockJS(wsUrl),
        connectHeaders: {
          Authorization: `Bearer ${token}`,
        },
        reconnectDelay: 5000,
        heartbeatIncoming: 10000,
        heartbeatOutgoing: 10000,
        onConnect: () => {
          console.log('General WebSocket connected');
          this.isConnected.set(true);
          this.connectionStatusSubject.next(true);
          this.connectionPromise = null;

          this.pendingSubscriptions.forEach((fn) => fn());
          this.pendingSubscriptions = [];

          this.startHeartbeat();
          resolve();
        },
        onStompError: (frame) => {
          console.error('General WebSocket STOMP error:', frame);
          this.isConnected.set(false);
          this.connectionStatusSubject.next(false);
          this.connectionPromise = null;
          reject(frame);
        },
        onWebSocketClose: () => {
          console.log('General WebSocket closed');
          this.isConnected.set(false);
          this.connectionStatusSubject.next(false);
          this.connectionPromise = null;
          this.stopHeartbeat();
        },
        onWebSocketError: (error) => {
          console.error('General WebSocket error:', error);
          this.isConnected.set(false);
          this.connectionStatusSubject.next(false);
          this.connectionPromise = null;
          reject(error);
        },
      });

      this.client.activate();
    });

    return this.connectionPromise;
  }

  disconnect(): void {
    this.stopHeartbeat();

    if (this.client?.active) {
      this.subscriptions.forEach((sub) => sub.unsubscribe());
      this.subscriptions.clear();
      this.client.deactivate();
      this.isConnected.set(false);
      this.connectionStatusSubject.next(false);
      this.connectionPromise = null;
      console.log('General WebSocket disconnected');
    }
  }

  subscribeToUserQueue(userId: number): void {
    this.subscribeToDestination(
      `/user/${userId}/queue/invitations`,
      (message) => {
        const invitation = JSON.parse(message.body) as InvitationResponseDTO;
        this.emitEvent({
          type: WebSocketEventType.INVITATION_NEW,
          data: invitation,
          timestamp: Date.now(),
        });
      }
    );

    this.subscribeToDestination(
      `/user/${userId}/queue/invitations/response`,
      (message) => {
        const invitation = JSON.parse(message.body) as InvitationResponseDTO;
        this.emitEvent({
          type: WebSocketEventType.INVITATION_RESPONSE,
          data: invitation,
          timestamp: Date.now(),
        });
      }
    );

    this.subscribeToDestination(`/user/${userId}/queue/messages`, (message) => {
      const msg = JSON.parse(message.body) as MessageResponseDTO;
      this.emitEvent({
        type: WebSocketEventType.MESSAGE_NEW,
        data: msg,
        conversationId: msg.conversationId,
        timestamp: Date.now(),
      });
    });

    this.subscribeToDestination(`/user/${userId}/queue/status`, (message) => {
      const statusEvent = JSON.parse(message.body) as StatusChangeEvent;
      this.emitEvent({
        type: WebSocketEventType.USER_STATUS_CHANGE,
        data: statusEvent,
        timestamp: Date.now(),
      });
    });
  }

  subscribeToPostComments(postId: number): void {
    this.subscribeToDestination(
      `/topic/post/${postId}/comments/new`,
      (message) => {
        const comment = JSON.parse(message.body) as CommentResponseDTO;
        this.emitEvent({
          type: WebSocketEventType.COMMENT_NEW,
          data: comment,
          postId,
          timestamp: Date.now(),
        });
      }
    );

    this.subscribeToDestination(
      `/topic/post/${postId}/comments/update`,
      (message) => {
        const comment = JSON.parse(message.body) as CommentResponseDTO;
        this.emitEvent({
          type: WebSocketEventType.COMMENT_UPDATE,
          data: comment,
          postId,
          timestamp: Date.now(),
        });
      }
    );

    this.subscribeToDestination(
      `/topic/post/${postId}/comments/delete`,
      (message) => {
        const data = JSON.parse(message.body);
        this.emitEvent({
          type: WebSocketEventType.COMMENT_DELETE,
          data: data.commentId,
          postId,
          timestamp: Date.now(),
        });
      }
    );
  }

  subscribeToCommentReplies(commentId: number): void {
    this.subscribeToDestination(
      `/topic/comment/${commentId}/replies/new`,
      (message) => {
        const reply = JSON.parse(message.body) as CommentResponseDTO;
        this.emitEvent({
          type: WebSocketEventType.REPLY_NEW,
          data: reply,
          commentId,
          timestamp: Date.now(),
        });
      }
    );

    this.subscribeToDestination(
      `/topic/comment/${commentId}/replies/update`,
      (message) => {
        const reply = JSON.parse(message.body) as CommentResponseDTO;
        this.emitEvent({
          type: WebSocketEventType.REPLY_UPDATE,
          data: reply,
          commentId,
          timestamp: Date.now(),
        });
      }
    );

    this.subscribeToDestination(
      `/topic/comment/${commentId}/replies/delete`,
      (message) => {
        const data = JSON.parse(message.body);
        this.emitEvent({
          type: WebSocketEventType.REPLY_DELETE,
          data: data.replyId,
          commentId,
          timestamp: Date.now(),
        });
      }
    );
  }

  subscribeToConversation(conversationId: number): void {
    this.subscribeToDestination(
      `/topic/conversation.${conversationId}.message`,
      (message) => {
        const msg = JSON.parse(message.body) as MessageResponseDTO;
        this.emitEvent({
          type: WebSocketEventType.MESSAGE_NEW,
          data: msg,
          conversationId,
          timestamp: Date.now(),
        });
      }
    );

    this.subscribeToDestination(
      `/topic/conversation.${conversationId}.update`,
      (message) => {
        const msg = JSON.parse(message.body) as MessageResponseDTO;
        this.emitEvent({
          type: WebSocketEventType.MESSAGE_UPDATE,
          data: msg,
          conversationId,
          timestamp: Date.now(),
        });
      }
    );

    this.subscribeToDestination(
      `/topic/conversation.${conversationId}.delete`,
      (message) => {
        const data = JSON.parse(message.body);
        this.emitEvent({
          type: WebSocketEventType.MESSAGE_DELETE,
          data: data.messageId,
          conversationId,
          timestamp: Date.now(),
        });
      }
    );

    this.subscribeToDestination(
      `/topic/conversation.${conversationId}.typing`,
      (message) => {
        const data = JSON.parse(message.body) as TypingIndicatorData;
        this.emitEvent({
          type: WebSocketEventType.TYPING_INDICATOR,
          data,
          conversationId,
          timestamp: Date.now(),
        });
      }
    );
  }

  subscribeToUserStatus(): void {
    this.subscribeToDestination(`/topic/user-status`, (message) => {
      const statusEvent = JSON.parse(message.body) as StatusChangeEvent;
      this.emitEvent({
        type: WebSocketEventType.USER_STATUS_CHANGE,
        data: statusEvent,
        timestamp: Date.now(),
      });
    });
  }

  unsubscribeFromPostComments(postId: number): void {
    this.unsubscribeFromDestinations([
      `/topic/post/${postId}/comments/new`,
      `/topic/post/${postId}/comments/update`,
      `/topic/post/${postId}/comments/delete`,
    ]);
  }

  unsubscribeFromCommentReplies(commentId: number): void {
    this.unsubscribeFromDestinations([
      `/topic/comment/${commentId}/replies/new`,
      `/topic/comment/${commentId}/replies/update`,
      `/topic/comment/${commentId}/replies/delete`,
    ]);
  }

  unsubscribeFromConversation(conversationId: number): void {
    this.unsubscribeFromDestinations([
      `/topic/conversation.${conversationId}.message`,
      `/topic/conversation.${conversationId}.update`,
      `/topic/conversation.${conversationId}.delete`,
      `/topic/conversation.${conversationId}.typing`,
    ]);
  }

  sendTypingIndicator(conversationId: number, isTyping: boolean): void {
    if (!this.client?.active) return;

    this.client.publish({
      destination: `/app/conversation/${conversationId}/typing`,
      body: JSON.stringify({ isTyping }),
    });
  }

  sendHeartbeat(): void {
    if (!this.client?.active) return;

    this.client.publish({
      destination: '/app/status/heartbeat',
      body: JSON.stringify({}),
    });
  }

  private subscribeToDestination(
    destination: string,
    handler: (message: IMessage) => void
  ): void {
    if (!this.client?.active) {
      console.warn('WebSocket not connected. Subscription will be pending.');
      this.pendingSubscriptions.push(() =>
        this.subscribeToDestination(destination, handler)
      );
      return;
    }

    if (this.subscriptions.has(destination)) {
      console.log(`Already subscribed to ${destination}`);
      return;
    }

    const subscription = this.client.subscribe(destination, handler);
    this.subscriptions.set(destination, subscription);
    console.log(`Subscribed to ${destination}`);
  }

  private unsubscribeFromDestinations(destinations: string[]): void {
    destinations.forEach((dest) => {
      const subscription = this.subscriptions.get(dest);
      if (subscription) {
        subscription.unsubscribe();
        this.subscriptions.delete(dest);
        console.log(`Unsubscribed from ${dest}`);
      }
    });
  }

  private emitEvent(event: WebSocketEvent): void {
    this.eventSubject.next(event);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}
