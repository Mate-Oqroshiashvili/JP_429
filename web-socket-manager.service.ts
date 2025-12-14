import {
  Injectable,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngxs/store';
import { GeneralWebSocketService } from './general-websocket.service';
import { InvitationWebSocketService } from './invitation-web-socket.service';
import { InvitationActions } from '../store/actions';
import { distinctUntilChanged } from 'rxjs/operators';

export enum WebSocketStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR',
}

@Injectable({
  providedIn: 'root',
})
export class WebSocketManager {
  private generalWs = inject(GeneralWebSocketService);
  private invitationWs = inject(InvitationWebSocketService);
  private store = inject(Store);
  private destroyRef = inject(DestroyRef);

  private readonly status = signal<WebSocketStatus>(
    WebSocketStatus.DISCONNECTED
  );
  private readonly currentUserId = signal<number | null>(null);
  private readonly reconnectAttempts = signal(0);
  private readonly maxReconnectAttempts = 5;
  private reconnectTimeout: any = null;

  readonly isConnected = computed(
    () => this.status() === WebSocketStatus.CONNECTED
  );
  readonly isConnecting = computed(
    () =>
      this.status() === WebSocketStatus.CONNECTING ||
      this.status() === WebSocketStatus.RECONNECTING
  );
  readonly canReconnect = computed(
    () => this.reconnectAttempts() < this.maxReconnectAttempts
  );

  constructor() {
    this.setupConnectionMonitoring();
  }

  async initialize(userId: number): Promise<void> {
    if (this.isConnected() && this.currentUserId() === userId) {
      console.log('WebSocket already initialized for this user');
      return;
    }

    const token = localStorage.getItem('access_token');
    if (!token) {
      this.status.set(WebSocketStatus.ERROR);
      throw new Error('No access token found');
    }

    this.status.set(WebSocketStatus.CONNECTING);
    this.currentUserId.set(userId);

    try {
      await this.generalWs.connect(token);

      this.generalWs.subscribeToUserQueue(userId);
      this.generalWs.subscribeToUserStatus();

      this.setupEventHandlers();

      this.status.set(WebSocketStatus.CONNECTED);
      this.reconnectAttempts.set(0);

      console.log('WebSocket initialized successfully for user:', userId);
    } catch (error) {
      console.error('Failed to initialize WebSocket:', error);
      this.status.set(WebSocketStatus.ERROR);
      this.handleConnectionError();
      throw error;
    }
  }

  disconnect(): void {
    this.clearReconnectTimeout();
    this.generalWs.disconnect();
    this.status.set(WebSocketStatus.DISCONNECTED);
    this.currentUserId.set(null);
    this.reconnectAttempts.set(0);
  }

  async reconnect(): Promise<void> {
    const userId = this.currentUserId();
    if (!userId) {
      throw new Error('No user ID available for reconnection');
    }

    if (!this.canReconnect()) {
      console.error('Max reconnection attempts reached');
      this.status.set(WebSocketStatus.ERROR);
      return;
    }

    this.status.set(WebSocketStatus.RECONNECTING);
    this.reconnectAttempts.update((count) => count + 1);

    try {
      this.disconnect();
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * this.reconnectAttempts())
      );
      await this.initialize(userId);
    } catch (error) {
      console.error('Reconnection failed:', error);
      this.scheduleReconnect();
    }
  }

  subscribeToPost(postId: number): void {
    if (!this.isConnected()) {
      console.warn('Cannot subscribe to post: WebSocket not connected');
      return;
    }
    this.generalWs.subscribeToPostComments(postId);
  }

  unsubscribeFromPost(postId: number): void {
    this.generalWs.unsubscribeFromPostComments(postId);
  }

  subscribeToConversation(conversationId: number): void {
    if (!this.isConnected()) {
      console.warn('Cannot subscribe to conversation: WebSocket not connected');
      return;
    }
    this.generalWs.subscribeToConversation(conversationId);
  }

  unsubscribeFromConversation(conversationId: number): void {
    this.generalWs.unsubscribeFromConversation(conversationId);
  }

  sendTypingIndicator(conversationId: number, isTyping: boolean): void {
    if (!this.isConnected()) return;
    this.generalWs.sendTypingIndicator(conversationId, isTyping);
  }

  private setupConnectionMonitoring(): void {
    this.generalWs.connectionStatus$
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((isConnected) => {
        if (!isConnected && this.status() === WebSocketStatus.CONNECTED) {
          console.warn('WebSocket connection lost');
          this.handleConnectionLost();
        }
      });
  }

  private setupEventHandlers(): void {
    this.setupInvitationHandlers();
  }

  private setupInvitationHandlers(): void {
    this.invitationWs.newInvitations$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((invitation) => {
        this.store.dispatch(
          new InvitationActions.HandleWebSocketInvitation(invitation)
        );
      });

    this.invitationWs.invitationResponses$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((response) => {
        this.store.dispatch(
          new InvitationActions.HandleWebSocketInvitationResponse(response)
        );
      });
  }

  private handleConnectionLost(): void {
    this.status.set(WebSocketStatus.DISCONNECTED);
    this.scheduleReconnect();
  }

  private handleConnectionError(): void {
    if (this.canReconnect()) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimeout();

    if (!this.canReconnect()) {
      console.error('Max reconnection attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts()), 30000);
    console.log(`Scheduling reconnect in ${delay}ms`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnect().catch(console.error);
    }, delay);
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
}
