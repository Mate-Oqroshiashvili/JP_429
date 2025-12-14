import { Injectable } from '@angular/core';
import { Client, IMessage, StompSubscription } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { BehaviorSubject } from 'rxjs';
import { environment } from '@codeme/shared/environment';

export interface WebSocketMessage {
  type: 'MESSAGE' | 'UPDATE' | 'DELETE' | 'TYPING' | 'STATUS';
  conversationId?: number;
  data: any;
}

@Injectable({
  providedIn: 'root',
})
export class WebSocketService {
  private client: Client | null = null;
  private connected$ = new BehaviorSubject<boolean>(false);
  private subscriptions = new Map<string, StompSubscription>();
  private messageSubject = new BehaviorSubject<WebSocketMessage | null>(null);

  public message$ = this.messageSubject.asObservable();
  public isConnected$ = this.connected$.asObservable();

  connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.client?.active) {
        resolve();
        return;
      }

      this.client = new Client({
        webSocketFactory: () => new SockJS(`${environment.socketUrl}/ws`),
        connectHeaders: {
          Authorization: `Bearer ${token}`,
        },
        debug: (str) => {
          // console.log('STOMP: ' + str);
        },
        reconnectDelay: 5000,
        heartbeatIncoming: 4000,
        heartbeatOutgoing: 4000,
        onConnect: () => {
          console.log('WebSocket connected');
          this.connected$.next(true);
          resolve();
        },
        onStompError: (frame) => {
          console.error('STOMP error:', frame);
          this.connected$.next(false);
          reject(frame);
        },
        onWebSocketClose: () => {
          console.log('WebSocket closed');
          this.connected$.next(false);
        },
        onWebSocketError: (error) => {
          console.error('WebSocket error:', error);
          this.connected$.next(false);
          reject(error);
        },
      });

      this.client.activate();
    });
  }

  disconnect(): void {
    if (this.client?.active) {
      this.subscriptions.forEach((sub) => sub.unsubscribe());
      this.subscriptions.clear();

      this.client.deactivate();
      this.connected$.next(false);
    }
  }

  subscribeToConversation(conversationId: number): void {
    if (!this.client?.active) {
      console.error('WebSocket not connected');
      return;
    }

    const topics = [
      {
        destination: `/topic/conversation.${conversationId}.message`,
        type: 'MESSAGE' as const,
      },
      {
        destination: `/topic/conversation.${conversationId}.update`,
        type: 'UPDATE' as const,
      },
      {
        destination: `/topic/conversation.${conversationId}.delete`,
        type: 'DELETE' as const,
      },
      {
        destination: `/topic/conversation.${conversationId}.typing`,
        type: 'TYPING' as const,
      },
    ];

    topics.forEach(({ destination, type }) => {
      if (!this.subscriptions.has(destination)) {
        const subscription = this.client!.subscribe(
          destination,
          (message: IMessage) => {
            this.messageSubject.next({
              type,
              conversationId,
              data: JSON.parse(message.body),
            });
          }
        );
        this.subscriptions.set(destination, subscription);
      }
    });
  }

  unsubscribeFromConversation(conversationId: number): void {
    const topics = [
      `/topic/conversation.${conversationId}.message`,
      `/topic/conversation.${conversationId}.update`,
      `/topic/conversation.${conversationId}.delete`,
      `/topic/conversation.${conversationId}.typing`,
    ];

    topics.forEach((destination) => {
      const subscription = this.subscriptions.get(destination);
      if (subscription) {
        subscription.unsubscribe();
        this.subscriptions.delete(destination);
      }
    });
  }

  subscribeToPersonalMessages(userId: number): void {
    if (!this.client?.active) return;

    const destination = `/user/queue/messages`;

    if (!this.subscriptions.has(destination)) {
      const subscription = this.client.subscribe(
        destination,
        (message: IMessage) => {
          this.messageSubject.next({
            type: 'MESSAGE',
            data: JSON.parse(message.body),
          });
        }
      );
      this.subscriptions.set(destination, subscription);
    }
  }

  sendTypingIndicator(conversationId: number, isTyping: boolean): void {
    if (!this.client?.active) return;

    this.client.publish({
      destination: `/app/conversation/${conversationId}/typing`,
      body: JSON.stringify({ isTyping }),
    });
  }

  sendMessage(conversationId: number, content: string): void {
    if (!this.client?.active) return;

    this.client.publish({
      destination: `/app/conversation/${conversationId}/send`,
      body: JSON.stringify({ content }),
    });
  }
}
