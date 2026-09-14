import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import '@material/web/dialog/dialog.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/select/outlined-select.js';
import '@material/web/select/select-option.js';
import '@material/web/button/text-button.js';
import '@material/web/button/filled-button.js';
import type { MdDialog } from '@material/web/dialog/dialog.js';
import type { MdOutlinedTextField } from '@material/web/textfield/outlined-text-field.js';
import type { TaskList } from '../types';

/** Input shape submitted to the controller's addTask. */
export interface AddTaskInput {
  taskListId: string;
  title: string;
  due?: string;
}

/**
 * The "Add task" dialog: a Material dialog with a required title field, a list
 * picker (shown only when more than one list is included), and an optional
 * native date input. It owns its own open/in-flight state; the host calls
 * {@link show} to open it. On submit it awaits the injected {@link onSubmit}
 * (which wraps `controller.addTask`); on success it closes and clears, on
 * failure it stays open (the controller has already surfaced a toast).
 */
@customElement('add-task-dialog')
export class AddTaskDialog extends LitElement {
  static styles = css`
    form {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: min(80vw, 320px);
    }
    md-outlined-text-field,
    md-outlined-select {
      width: 100%;
    }
    label.date {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 0.8rem;
      color: var(--app-on-surface-muted);
    }
    input[type='date'] {
      appearance: none;
      font: inherit;
      font-size: 0.95rem;
      color: var(--app-on-surface);
      background: var(--app-surface);
      border: 1px solid var(--app-border);
      border-radius: 8px;
      padding: 12px;
      color-scheme: light dark;
    }
    input[type='date']:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: -1px;
    }
  `;

  /** The lists offered in the picker (host passes only included lists). */
  @property({ attribute: false }) lists: TaskList[] = [];
  /** Async submit handler (wraps controller.addTask). */
  @property({ attribute: false }) onSubmit?: (input: AddTaskInput) => Promise<void>;

  @state() private open = false;
  @state() private taskTitle = '';
  @state() private selectedListId = '';
  @state() private due = '';
  @state() private submitting = false;

  @query('md-dialog') private dialog?: MdDialog;
  @query('md-outlined-text-field') private titleField?: MdOutlinedTextField;

  /** Open the dialog with a fresh form. */
  show(): void {
    this.taskTitle = '';
    this.due = '';
    this.selectedListId = this.lists[0]?.id ?? '';
    this.submitting = false;
    this.open = true;
  }

  private canSubmit(): boolean {
    return this.taskTitle.trim().length > 0 && !this.submitting && this.lists.length > 0;
  }

  private reset(): void {
    this.taskTitle = '';
    this.due = '';
    this.submitting = false;
  }

  private close(): void {
    this.open = false;
    this.reset();
  }

  private onClosed(): void {
    // Sync our state when the dialog closes for any reason (Esc, scrim, action).
    if (this.open) this.open = false;
    this.reset();
  }

  private async submit(): Promise<void> {
    const title = this.taskTitle.trim();
    const listId = this.selectedListId || this.lists[0]?.id;
    if (!title || this.submitting || !listId || !this.onSubmit) return;
    this.submitting = true;
    try {
      await this.onSubmit({
        taskListId: listId,
        title,
        ...(this.due ? { due: this.due } : {}),
      });
      this.close();
    } catch {
      // Keep the dialog open; the controller already surfaced an error toast.
      this.submitting = false;
    }
  }

  private onFormSubmit(e: Event): void {
    e.preventDefault();
    if (this.canSubmit()) void this.submit();
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has('open') && this.open) {
      // Autofocus the title field once the dialog has opened.
      void this.dialog?.updateComplete.then(() => this.titleField?.focus());
    }
  }

  render() {
    const showPicker = this.lists.length > 1;
    return html`
      <md-dialog ?open=${this.open} @closed=${() => this.onClosed()}>
        <div slot="headline">Add task</div>
        <form slot="content" id="add-task-form" @submit=${(e: Event) => this.onFormSubmit(e)}>
          <md-outlined-text-field
            label="Title"
            required
            .value=${this.taskTitle}
            @input=${(e: Event) => (this.taskTitle = (e.target as MdOutlinedTextField).value)}
          ></md-outlined-text-field>

          ${showPicker
            ? html`<md-outlined-select
                label="List"
                .value=${this.selectedListId}
                @change=${(e: Event) =>
                  (this.selectedListId = (e.target as HTMLSelectElement).value)}
              >
                ${this.lists.map(
                  (l) => html`<md-select-option
                    value=${l.id}
                    ?selected=${l.id === this.selectedListId}
                    >${l.title}</md-select-option
                  >`,
                )}
              </md-outlined-select>`
            : nothing}

          <label class="date">
            Due date (optional)
            <input
              type="date"
              aria-label="Due date"
              .value=${this.due}
              @input=${(e: Event) => (this.due = (e.target as HTMLInputElement).value)}
            />
          </label>
          <button type="submit" hidden aria-hidden="true"></button>
        </form>
        <div slot="actions">
          <md-text-button @click=${() => this.close()}>Cancel</md-text-button>
          <md-filled-button ?disabled=${!this.canSubmit()} @click=${() => void this.submit()}>
            Add
          </md-filled-button>
        </div>
      </md-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'add-task-dialog': AddTaskDialog;
  }
}
