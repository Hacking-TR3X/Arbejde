/** One snackbar at a time, with an optional action such as "Fortryd". */
export interface SnackbarMessage {
  id: number;
  text: string;
  action?: { label: string; run: () => void | Promise<void> };
}

class Snackbar {
  current = $state<SnackbarMessage | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  show(text: string, action?: SnackbarMessage['action'], ms = action ? 6000 : 3000): void {
    if (this.timer) clearTimeout(this.timer);
    const id = ++this.seq;
    this.current = action ? { id, text, action } : { id, text };
    this.timer = setTimeout(() => {
      if (this.current?.id === id) this.current = null;
    }, ms);
  }

  dismiss(): void {
    if (this.timer) clearTimeout(this.timer);
    this.current = null;
  }

  async runAction(): Promise<void> {
    const action = this.current?.action;
    this.dismiss();
    if (action) await action.run();
  }
}

export const snackbar = new Snackbar();
