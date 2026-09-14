import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import '@material/web/textfield/outlined-text-field.js';
import '@material/web/select/outlined-select.js';
import '@material/web/select/select-option.js';
import '@material/web/button/filled-button.js';
import type { MdOutlinedTextField } from '@material/web/textfield/outlined-text-field.js';
import type { TaskList } from '../types';
import { buildDueOptions } from '../logic/dueOptions';
import type { DueOption } from '../logic/dueOptions';
import { back, navigate } from '../app/router';

/** Input shape submitted to the controller's addTask. */
export interface AddTaskInput {
  taskListId: string;
  title: string;
  due?: string;
}

/**
 * The full-viewport "Add task" screen (replaces the old modal dialog). It fills
 * the viewport, respects safe-area insets, and lays out so the common form fits
 * without scrolling on a typical phone. It owns its transient form state; the
 * host mounts it for the `#/add` route and passes the user's lists and an
 * `onSubmit` (which wraps `controller.addTask`). On success it navigates back to
 * the list; on failure it stays put (the controller has already toasted).
 *
 * Due is chosen from selectable chips — "No date" (default), the same date
 * options as the snooze menu, and "Pick a date" (which reveals an inline native
 * date input for an arbitrary date) — never a bare always-on date picker.
 */
@customElement('add-task-screen')
export class AddTaskScreen extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 30;
      background: var(--app-bg);
      color: var(--app-on-surface);
      /* Fast, subtle entrance; disabled under reduced-motion below. */
      animation: screen-in 0.15s cubic-bezier(0.2, 0.7, 0.3, 1) both;
    }
    @keyframes screen-in {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    .wrap {
      max-width: var(--app-max-width);
      margin: 0 auto;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
    }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 8px;
      padding-top: max(12px, env(safe-area-inset-top, 0px));
      border-bottom: 1px solid var(--app-border);
      background: var(--app-header-bg);
    }
    header h1 {
      flex: 1;
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .iconbtn {
      appearance: none;
      border: none;
      background: transparent;
      color: var(--app-on-surface-muted);
      width: 40px;
      height: 40px;
      border-radius: 50%;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .iconbtn:hover {
      background: color-mix(in srgb, var(--app-on-surface) 8%, transparent);
    }
    .iconbtn:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: -2px;
    }
    .iconbtn svg {
      width: 24px;
      height: 24px;
      fill: currentColor;
    }
    form {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
      padding: 20px 16px;
      padding-left: max(16px, env(safe-area-inset-left, 0px));
      padding-right: max(16px, env(safe-area-inset-right, 0px));
    }
    md-outlined-text-field,
    md-outlined-select {
      width: 100%;
    }
    .field-label {
      display: block;
      font-size: 0.78rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--app-on-surface-muted);
      margin-bottom: 8px;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chip {
      appearance: none;
      border: 1px solid var(--app-border);
      background: var(--app-surface);
      color: var(--app-on-surface);
      border-radius: 999px;
      padding: 8px 14px;
      font: inherit;
      font-size: 0.85rem;
      cursor: pointer;
      line-height: 1.1;
    }
    .chip:hover {
      background: color-mix(in srgb, var(--app-on-surface) 6%, var(--app-surface));
    }
    .chip[aria-pressed='true'] {
      background: color-mix(in srgb, var(--app-accent) 16%, transparent);
      border-color: var(--app-accent);
      color: var(--app-accent);
      font-weight: 600;
    }
    .chip:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: 2px;
    }
    input[type='date'] {
      margin-top: 12px;
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
    footer {
      padding: 12px 16px;
      padding-bottom: max(12px, calc(12px + env(safe-area-inset-bottom, 0px)));
      border-top: 1px solid var(--app-border);
      background: var(--app-header-bg);
    }
    md-filled-button {
      width: 100%;
    }
    @media (prefers-reduced-motion: reduce) {
      :host {
        animation: none;
      }
    }
  `;

  /**
   * The lists offered in the picker — all the user's lists in Google order, so
   * `lists[0]` is the Google default list and becomes the pre-selected default.
   */
  @property({ attribute: false }) lists: TaskList[] = [];
  /** Async submit handler (wraps controller.addTask). */
  @property({ attribute: false }) onSubmit?: (input: AddTaskInput) => Promise<void>;

  @state() private taskTitle = '';
  @state() private selectedListId = '';
  /** The selected Due option key ('none' by default). */
  @state() private dueKey = 'none';
  /** The date chosen via the "Pick a date" inline input. */
  @state() private pickedDate = '';
  @state() private submitting = false;

  /** Due options, computed once per mount from "today". */
  private dueOptions: DueOption[] = buildDueOptions(new Date());

  @query('md-outlined-text-field') private titleField?: MdOutlinedTextField;
  @query('input[type="date"]') private dateInput?: HTMLInputElement;

  connectedCallback(): void {
    super.connectedCallback();
    // A fresh mount is a fresh form; recompute due options relative to now.
    this.taskTitle = '';
    this.selectedListId = this.lists[0]?.id ?? '';
    this.dueKey = 'none';
    this.pickedDate = '';
    this.submitting = false;
    this.dueOptions = buildDueOptions(new Date());
  }

  firstUpdated(): void {
    // Autofocus the title field on entry.
    void this.updateComplete.then(() => this.titleField?.focus());
  }

  updated(changed: Map<string, unknown>): void {
    if (this.selectedListId === '' && this.lists.length > 0) {
      this.selectedListId = this.lists[0].id;
    }
    // Focus the inline date input the moment "Pick a date" is chosen.
    if (changed.has('dueKey') && this.dueKey === 'pick') {
      void this.updateComplete.then(() => this.dateInput?.focus());
    }
  }

  /** The RFC3339 due to submit for the current selection, or undefined. */
  private resolvedDue(): string | undefined {
    if (this.dueKey === 'none') return undefined;
    if (this.dueKey === 'pick') return this.pickedDate || undefined;
    const opt = this.dueOptions.find((o) => o.key === this.dueKey);
    return opt?.date ?? undefined;
  }

  private canSubmit(): boolean {
    return this.taskTitle.trim().length > 0 && !this.submitting && this.lists.length > 0;
  }

  private cancel(): void {
    back();
  }

  private async submit(): Promise<void> {
    const title = this.taskTitle.trim();
    const listId = this.selectedListId || this.lists[0]?.id;
    if (!title || this.submitting || !listId || !this.onSubmit) return;
    this.submitting = true;
    const due = this.resolvedDue();
    try {
      await this.onSubmit({ taskListId: listId, title, ...(due ? { due } : {}) });
      navigate('list');
    } catch {
      // Stay on the screen; the controller already surfaced an error toast.
      this.submitting = false;
    }
  }

  private onFormSubmit(e: Event): void {
    e.preventDefault();
    if (this.canSubmit()) void this.submit();
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.cancel();
    }
  }

  render() {
    const showPicker = this.lists.length > 1;
    return html`
      <div class="wrap" @keydown=${(e: KeyboardEvent) => this.onKeydown(e)}>
        <header>
          <button class="iconbtn" aria-label="Back" @click=${() => this.cancel()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z" />
            </svg>
          </button>
          <h1>Add task</h1>
        </header>

        <form id="add-task-form" @submit=${(e: Event) => this.onFormSubmit(e)}>
          <md-outlined-text-field
            label="Title"
            required
            .value=${this.taskTitle}
            @input=${(e: Event) => (this.taskTitle = (e.target as MdOutlinedTextField).value)}
          ></md-outlined-text-field>

          <div>
            <span class="field-label" id="due-label">Due</span>
            <div class="chips" role="group" aria-labelledby="due-label">
              ${this.dueOptions.map(
                (opt) => html`
                  <button
                    type="button"
                    class="chip"
                    aria-pressed=${this.dueKey === opt.key}
                    @click=${() => (this.dueKey = opt.key)}
                  >
                    ${opt.label}
                  </button>
                `,
              )}
            </div>
            ${this.dueKey === 'pick'
              ? html`<input
                  type="date"
                  aria-label="Pick a due date"
                  .value=${this.pickedDate}
                  @input=${(e: Event) =>
                    (this.pickedDate = (e.target as HTMLInputElement).value)}
                />`
              : nothing}
          </div>

          ${showPicker
            ? html`<div>
                <span class="field-label" id="list-label">List</span>
                <md-outlined-select
                  aria-labelledby="list-label"
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
                </md-outlined-select>
              </div>`
            : nothing}
          <button type="submit" hidden aria-hidden="true"></button>
        </form>

        <footer>
          <md-filled-button
            ?disabled=${!this.canSubmit()}
            @click=${() => void this.submit()}
          >
            Add
          </md-filled-button>
        </footer>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'add-task-screen': AddTaskScreen;
  }
}
