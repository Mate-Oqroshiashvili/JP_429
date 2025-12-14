import { Injectable, inject, DestroyRef, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { GeneralWebSocketService } from './general-websocket.service';
import { Store } from '@ngxs/store';
import { InvitationActions } from '../store/actions';
import { InvitationWebSocketService } from './invitation-web-socket.service';

@Injectable({
  providedIn: 'root',
})
export class WebSocketInitService {
  private generalWs = inject(GeneralWebSocketService);
  private invitationWs = inject(InvitationWebSocketService);
  private store = inject(Store);
  private destroyRef = inject(DestroyRef);

  private readonly isInitialized = signal(false);
  private currentUserId: number | null = null;

  initialize(userId: number): Promise<void> {
    if (this.isInitialized() && this.currentUserId === userId) {
      console.log('WebSocket already initialized for this user');
      return Promise.resolve();
    }

    const token = localStorage.getItem('access_token');
    if (!token) {
      console.error('No access token found for WebSocket connection');
      return Promise.reject(new Error('No access token'));
    }

    return this.generalWs
      .connect(token)
      .then(() => {
        console.log('WebSocket initialized successfully');
        this.currentUserId = userId;
        this.isInitialized.set(true);

        this.generalWs.subscribeToUserQueue(userId);
        this.generalWs.subscribeToUserStatus();

        this.setupAllHandlers();
      })
      .catch((error) => {
        console.error('Failed to initialize WebSocket:', error);
        this.isInitialized.set(false);
        throw error;
      });
  }

  disconnect(): void {
    this.generalWs.disconnect();
    this.isInitialized.set(false);
    this.currentUserId = null;
  }

  reconnect(): Promise<void> {
    if (!this.currentUserId) {
      return Promise.reject(new Error('No user ID available for reconnection'));
    }
    this.disconnect();
    return this.initialize(this.currentUserId);
  }

  getConnectionStatus(): boolean {
    return this.isInitialized();
  }

  private setupAllHandlers(): void {
    this.setupInvitationHandlers();
    this.setupConnectionMonitoring();
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

  private setupConnectionMonitoring(): void {
    this.generalWs.connectionStatus$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((isConnected) => {
        if (!isConnected && this.isInitialized()) {
          console.warn('WebSocket connection lost');
          this.isInitialized.set(false);
        } else if (isConnected && !this.isInitialized()) {
          console.log('WebSocket connection restored');
          this.isInitialized.set(true);
        }
      });
  }
}
