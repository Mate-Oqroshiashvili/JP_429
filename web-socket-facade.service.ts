import { Injectable, inject } from '@angular/core';
import { InvitationWebSocketService } from './invitation-web-socket.service';
import { InvitationResponseDTO } from '../models';
import { Observable } from 'rxjs';
import { WebSocketManager } from './web-socket-manager.service';

@Injectable({
  providedIn: 'root',
})
export class WebSocketFacade {
  private manager = inject(WebSocketManager);
  private invitationWs = inject(InvitationWebSocketService);

  readonly isConnected = this.manager.isConnected;
  readonly isConnecting = this.manager.isConnecting;
  readonly canReconnect = this.manager.canReconnect;

  readonly invitationCount = this.invitationWs.invitationCount;
  readonly hasNewInvitations = this.invitationWs.hasNewInvitations;
  readonly newInvitations = this.invitationWs.newInvitations.asReadonly();
  readonly latestInvitation = this.invitationWs.latestNewInvitation;

  readonly newInvitations$: Observable<InvitationResponseDTO> =
    this.invitationWs.newInvitations$;

  async connect(userId: number): Promise<void> {
    return this.manager.initialize(userId);
  }

  disconnect(): void {
    this.manager.disconnect();
  }

  async reconnect(): Promise<void> {
    return this.manager.reconnect();
  }

  subscribeToPost(postId: number): void {
    this.manager.subscribeToPost(postId);
  }

  unsubscribeFromPost(postId: number): void {
    this.manager.unsubscribeFromPost(postId);
  }

  subscribeToConversation(conversationId: number): void {
    this.manager.subscribeToConversation(conversationId);
  }

  unsubscribeFromConversation(conversationId: number): void {
    this.manager.unsubscribeFromConversation(conversationId);
  }

  sendTypingIndicator(conversationId: number, isTyping: boolean): void {
    this.manager.sendTypingIndicator(conversationId, isTyping);
  }

  clearInvitations(): void {
    this.invitationWs.clearNewInvitations();
  }

  markInvitationAsRead(invitationId: number): void {
    this.invitationWs.markInvitationAsRead(invitationId);
  }
}
