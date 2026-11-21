/**
 * The bookkeeping behind the admin section's *Undo* bar, apart from React so
 * it can be tested. One offer shows at a time. When an offer goes without
 * *Undo* (it timed out, a newer one replaced it, or the admin left the
 * section), its change stands and `onExpire` runs, exactly once. Only the
 * offer still showing can close: a late answer from an older bar can't hide
 * a newer one.
 */

export interface Offer {
  id: number;
  text: string;
  /** Answers an error message, or null when undone. */
  undo?: () => Promise<string | null>;
  /** The change stands (for *Replace photo*: the old photo can go). */
  onExpire?: () => void;
}

export class UndoOffers {
  private current: Offer | null = null;

  get shown(): Offer | null {
    return this.current;
  }

  show(offer: Offer): void {
    const last = this.current;
    this.current = offer;
    last?.onExpire?.();
  }

  /** Offer `id` went: timed out (`expired`) or undone. Says whether it was still the one showing. */
  close(id: number, expired: boolean): boolean {
    const offer = this.current;
    if (offer?.id !== id) return false;
    this.current = null;
    if (expired) offer.onExpire?.();
    return true;
  }

  leave(): void {
    const offer = this.current;
    this.current = null;
    offer?.onExpire?.();
  }
}
