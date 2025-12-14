import {
  Injectable,
  inject,
  signal,
  computed,
  DestroyRef,
  effect,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { filter, map, shareReplay } from 'rxjs/operators';
import {
  GeneralWebSocketService,
  WebSocketEventType,
} from './general-websocket.service';
import { InvitationResponseDTO } from '../models';

@Injectable({
  providedIn: 'root',
})
export class InvitationWebSocketService {
  private generalWs = inject(GeneralWebSocketService);
  private destroyRef = inject(DestroyRef);

  readonly newInvitations = signal<InvitationResponseDTO[]>([]);
  readonly invitationResponses = signal<InvitationResponseDTO[]>([]);

  readonly newInvitations$ = this.generalWs.events$.pipe(
    filter((event) => event.type === WebSocketEventType.INVITATION_NEW),
    map((event) => event.data as InvitationResponseDTO),
    shareReplay(1),
    takeUntilDestroyed(this.destroyRef)
  );

  readonly invitationResponses$ = this.generalWs.events$.pipe(
    filter((event) => event.type === WebSocketEventType.INVITATION_RESPONSE),
    map((event) => event.data as InvitationResponseDTO),
    shareReplay(1),
    takeUntilDestroyed(this.destroyRef)
  );

  readonly latestNewInvitation = toSignal(this.newInvitations$, {
    initialValue: null,
  });
  readonly latestInvitationResponse = toSignal(this.invitationResponses$, {
    initialValue: null,
  });

  readonly invitationCount = computed(() => this.newInvitations().length);
  readonly hasNewInvitations = computed(() => this.newInvitations().length > 0);
  readonly isConnected = computed(() => this.generalWs.isConnected());

  constructor() {
    this.setupAutoSubscriptions();
  }

  private setupAutoSubscriptions(): void {
    effect(() => {
      const sub1 = this.newInvitations$.subscribe((invitation) => {
        this.newInvitations.update((invitations) => {
          const exists = invitations.some((inv) => inv.id === invitation.id);
          return exists ? invitations : [...invitations, invitation];
        });
      });

      const sub2 = this.invitationResponses$.subscribe((response) => {
        this.invitationResponses.update((responses) => {
          const exists = responses.some((res) => res.id === response.id);
          return exists ? responses : [...responses, response];
        });
      });

      return () => {
        sub1.unsubscribe();
        sub2.unsubscribe();
      };
    });
  }

  clearNewInvitations(): void {
    this.newInvitations.set([]);
  }

  clearInvitationResponses(): void {
    this.invitationResponses.set([]);
  }

  removeInvitation(invitationId: number): void {
    this.newInvitations.update((invitations) =>
      invitations.filter((inv) => inv.id !== invitationId)
    );
  }

  markInvitationAsRead(invitationId: number): void {
    this.newInvitations.update((invitations) =>
      invitations.filter((inv) => inv.id !== invitationId)
    );
  }

  clearAll(): void {
    this.clearNewInvitations();
    this.clearInvitationResponses();
  }
}
