import { Injectable } from '@angular/core';
import { Store } from '@ngxs/store';
import { Subject, Observable } from 'rxjs';
import { CommentResponseDTO } from '../models/comment';
import { environment } from '@codeme/shared/environment';
import { Client, IMessage, StompSubscription } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { CommentActions } from '../store';

@Injectable({
  providedIn: 'root',
})
export class CommentWebSocketService {
  private client: Client | null = null;
  private readonly connectionStatus$ = new Subject<boolean>();
  private subscribedPosts = new Set<number>();
  private subscribedComments = new Set<number>();
  private subscriptions = new Map<string, StompSubscription>();
  private pendingSubscriptions: Array<() => void> = [];
  private connectionPromise: Promise<void> | null = null;

  constructor(private store: Store) {}

  connect(token: string): Promise<void> {
    if (this.client?.active) {
      return Promise.resolve();
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      this.client = new Client({
        webSocketFactory: () => new SockJS(`${environment.socketUrl}/ws`),
        connectHeaders: {
          Authorization: `Bearer ${token}`,
        },
        reconnectDelay: 5000,
        heartbeatIncoming: 10000,
        heartbeatOutgoing: 10000,
        onConnect: () => {
          console.log('Comment WebSocket connected');
          this.connectionStatus$.next(true);
          this.connectionPromise = null;

          this.pendingSubscriptions.forEach((fn) => fn());
          this.pendingSubscriptions = [];

          resolve();
        },
        onStompError: (frame) => {
          console.error('Comment WebSocket STOMP error:', frame);
          this.connectionStatus$.next(false);
          this.connectionPromise = null;
          reject(frame);
        },
        onWebSocketClose: () => {
          console.log('Comment WebSocket closed');
          this.connectionStatus$.next(false);
          this.connectionPromise = null;
        },
        onWebSocketError: (error) => {
          console.error('Comment WebSocket error:', error);
          this.connectionStatus$.next(false);
          this.connectionPromise = null;
          reject(error);
        },
      });

      this.client.activate();
    });

    return this.connectionPromise;
  }

  disconnect(): void {
    if (this.client?.active) {
      this.subscriptions.forEach((sub) => sub.unsubscribe());
      this.subscriptions.clear();
      this.subscribedPosts.clear();
      this.subscribedComments.clear();
      this.client.deactivate();
      this.connectionStatus$.next(false);
      this.connectionPromise = null;
      console.log('Comment WebSocket disconnected');
    }
  }

  subscribeToPostComments(postId: number): void {
    if (!this.client?.active) {
      console.warn(
        'Comment WebSocket not connected. Subscription will be pending.'
      );
      this.pendingSubscriptions.push(() =>
        this.subscribeToPostComments(postId)
      );
      return;
    }

    if (this.subscribedPosts.has(postId)) {
      console.log(`Already subscribed to post ${postId} comments`);
      return;
    }

    console.log(`Subscribing to post ${postId} comments`);
    this.subscribedPosts.add(postId);

    const newCommentsDest = `/topic/post/${postId}/comments/new`;
    if (!this.subscriptions.has(newCommentsDest)) {
      const sub = this.client.subscribe(
        newCommentsDest,
        (message: IMessage) => {
          console.log('Received new comment via WebSocket:', message.body);
          const comment = JSON.parse(message.body) as CommentResponseDTO;
          if (!comment.parentCommentId) {
            this.store.dispatch(new CommentActions.AddCommentSuccess(comment));
          }
        }
      );
      this.subscriptions.set(newCommentsDest, sub);
      console.log(`Subscribed to ${newCommentsDest}`);
    }

    const updateCommentsDest = `/topic/post/${postId}/comments/update`;
    if (!this.subscriptions.has(updateCommentsDest)) {
      const sub = this.client.subscribe(
        updateCommentsDest,
        (message: IMessage) => {
          console.log('Received comment update via WebSocket:', message.body);
          const comment = JSON.parse(message.body) as CommentResponseDTO;
          this.store.dispatch(new CommentActions.UpdateCommentSuccess(comment));
        }
      );
      this.subscriptions.set(updateCommentsDest, sub);
      console.log(`Subscribed to ${updateCommentsDest}`);
    }

    const deleteCommentsDest = `/topic/post/${postId}/comments/delete`;
    if (!this.subscriptions.has(deleteCommentsDest)) {
      const sub = this.client.subscribe(
        deleteCommentsDest,
        (message: IMessage) => {
          console.log('Received comment delete via WebSocket:', message.body);
          const commentId = JSON.parse(message.body) as number;
          this.store.dispatch(
            new CommentActions.DeleteCommentSuccess(commentId)
          );
        }
      );
      this.subscriptions.set(deleteCommentsDest, sub);
      console.log(`Subscribed to ${deleteCommentsDest}`);
    }
  }

  subscribeToCommentReplies(commentId: number): void {
    if (!this.client?.active) {
      console.warn(
        'Comment WebSocket not connected. Reply subscription will be pending.'
      );
      this.pendingSubscriptions.push(() =>
        this.subscribeToCommentReplies(commentId)
      );
      return;
    }

    if (this.subscribedComments.has(commentId)) {
      console.log(`Already subscribed to comment ${commentId} replies`);
      return;
    }

    console.log(`Subscribing to comment ${commentId} replies`);
    this.subscribedComments.add(commentId);

    const newRepliesDest = `/topic/comment/${commentId}/replies/new`;
    if (!this.subscriptions.has(newRepliesDest)) {
      const sub = this.client.subscribe(newRepliesDest, (message: IMessage) => {
        console.log('Received new reply via WebSocket:', message.body);
        const reply = JSON.parse(message.body) as CommentResponseDTO;
        this.store.dispatch(new CommentActions.AddCommentSuccess(reply));
      });
      this.subscriptions.set(newRepliesDest, sub);
      console.log(`Subscribed to ${newRepliesDest}`);
    }

    const updateRepliesDest = `/topic/comment/${commentId}/replies/update`;
    if (!this.subscriptions.has(updateRepliesDest)) {
      const sub = this.client.subscribe(
        updateRepliesDest,
        (message: IMessage) => {
          console.log('Received reply update via WebSocket:', message.body);
          const reply = JSON.parse(message.body) as CommentResponseDTO;
          this.store.dispatch(new CommentActions.UpdateCommentSuccess(reply));
        }
      );
      this.subscriptions.set(updateRepliesDest, sub);
      console.log(`Subscribed to ${updateRepliesDest}`);
    }

    const deleteRepliesDest = `/topic/comment/${commentId}/replies/delete`;
    if (!this.subscriptions.has(deleteRepliesDest)) {
      const sub = this.client.subscribe(
        deleteRepliesDest,
        (message: IMessage) => {
          console.log('Received reply delete via WebSocket:', message.body);
          const replyId = JSON.parse(message.body) as number;
          this.store.dispatch(new CommentActions.DeleteCommentSuccess(replyId));
        }
      );
      this.subscriptions.set(deleteRepliesDest, sub);
      console.log(`Subscribed to ${deleteRepliesDest}`);
    }
  }

  unsubscribeFromPostComments(postId: number): void {
    const destinations = [
      `/topic/post/${postId}/comments/new`,
      `/topic/post/${postId}/comments/update`,
      `/topic/post/${postId}/comments/delete`,
    ];

    destinations.forEach((dest) => {
      const subscription = this.subscriptions.get(dest);
      if (subscription) {
        subscription.unsubscribe();
        this.subscriptions.delete(dest);
        console.log(`Unsubscribed from ${dest}`);
      }
    });

    this.subscribedPosts.delete(postId);
  }

  unsubscribeFromCommentReplies(commentId: number): void {
    const destinations = [
      `/topic/comment/${commentId}/replies/new`,
      `/topic/comment/${commentId}/replies/update`,
      `/topic/comment/${commentId}/replies/delete`,
    ];

    destinations.forEach((dest) => {
      const subscription = this.subscriptions.get(dest);
      if (subscription) {
        subscription.unsubscribe();
        this.subscriptions.delete(dest);
        console.log(`Unsubscribed from ${dest}`);
      }
    });

    this.subscribedComments.delete(commentId);
  }

  getConnectionStatus(): Observable<boolean> {
    return this.connectionStatus$.asObservable();
  }

  isConnected(): boolean {
    return this.client?.active ?? false;
  }
}
