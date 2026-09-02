/**
 * Microsoft 365 APIs available to Gadgets.
 *
 * Three independent resource types, each with its own session:
 *
 * - `OutlookMailSession` — a mailbox, optionally narrowed to one folder or one search.
 * - `OutlookCalendarSession` — a single calendar.
 * - `SharePointDocumentSession` — one file, or one folder and its descendants.
 *
 * A binding gives access to exactly one of these. Which one you have is shown by the
 * binding's type.
 */

/** A lazily-paged list. Call `next()` until it returns `null`. */
export interface Cursor<T> {
  /** The next page of results, or `null` once the list is exhausted. */
  next(): Promise<T[] | null>;
}

// =======================================================================================
// Outlook mail
// =======================================================================================

/** A person on an email. */
export interface EmailAddress {
  /** Display name, when the sender provided one. */
  name?: string;
  /** SMTP address, e.g. "someone@example.com". */
  address: string;
}

/** A well-known mailbox folder. Other folders are addressed by name. */
export type WellKnownFolder =
  | "inbox"
  | "archive"
  | "drafts"
  | "sentitems"
  | "deleteditems"
  | "junkemail";

/** Summary of a mail conversation, as returned when listing. */
export interface MailThreadSummary {
  /** Stable id for this conversation. Pass to `getThread()`. */
  id: string;
  /** Subject of the most recent message, or "" when the conversation has none. */
  subject: string;
  /** Everyone who has sent a message in this conversation. */
  participants: EmailAddress[];
  /** First ~200 characters of the most recent message body, as plain text. */
  preview: string;
  /** When the most recent message arrived. */
  lastReceivedAt: Date;
  /** Number of messages in the conversation. */
  messageCount: number;
  /** True when any message in the conversation is unread. */
  hasUnread: boolean;
  /** True when any message carries a file attachment. */
  hasAttachments: boolean;
}

/** A single message within a conversation. */
export interface MailMessage {
  /** Stable id for this message. */
  id: string;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  /** When the message arrived (or was sent, for messages you sent). */
  receivedAt: Date;
  /** Message body converted to Markdown. */
  body: string;
  /** True when this message is unread. */
  unread: boolean;
  /** File attachments. Use `getAttachment()` to read one. */
  attachments: MailAttachmentInfo[];
}

/** Metadata for one attachment. */
export interface MailAttachmentInfo {
  id: string;
  filename: string;
  /** MIME type reported by the sender, e.g. "application/pdf". */
  contentType: string;
  /** Size in bytes. */
  size: number;
}

/**
 * A message to draft.
 *
 * This creates a draft in the mailbox's Drafts folder. It does not send anything -- the
 * mailbox owner reviews and sends it themselves from Outlook.
 */
export interface DraftMail {
  to: string[];
  cc?: string[];
  subject: string;
  /** Body as Markdown. Converted to HTML in the draft. */
  body: string;
}

/** One mail conversation. */
export interface MailThread {
  /** Metadata for this conversation, without fetching every message body. */
  summary(): Promise<MailThreadSummary>;

  /**
   * Every message in the conversation, oldest first.
   *
   * Capped at the 100 most recent messages for very long conversations.
   */
  messages(): Promise<MailMessage[]>;

  /** Read one attachment's bytes. Throws if `attachmentId` is not on this conversation. */
  getAttachment(messageId: string, attachmentId: string): Promise<ArrayBuffer>;

  /** Move the conversation to the Archive folder. */
  archive(): Promise<void>;

  /** Move the conversation to Deleted Items. */
  delete(): Promise<void>;

  /** Mark every message in the conversation read. */
  markRead(): Promise<void>;

  /** Mark every message in the conversation unread. */
  markUnread(): Promise<void>;

  /** Move the conversation to a named folder. Throws if the folder does not exist. */
  moveTo(folder: string): Promise<void>;

  /**
   * Draft a reply to the most recent message in the conversation.
   *
   * Creates a draft in the Drafts folder; does not send it. The mailbox owner sends it
   * themselves from Outlook.
   *
   * @param body Markdown. Converted to HTML.
   * @param replyAll When true, includes everyone on the original. Defaults to sender only.
   */
  draftReply(body: string, replyAll?: boolean): Promise<void>;

  /**
   * Draft a forward of the most recent message to new recipients, with an optional note.
   *
   * Creates a draft in the Drafts folder; does not send it.
   */
  draftForward(to: string[], body?: string): Promise<void>;
}

/**
 * An Outlook mailbox.
 *
 * The binding may be narrowed to one folder or one search query. When it is, every
 * method here sees only conversations inside that scope — `list()` will not return
 * anything outside it, and `getThread()` throws for an id outside it.
 */
export interface OutlookMailSession {
  /** The signed-in mailbox owner's address. */
  address(): Promise<string>;

  /**
   * Conversations in this mailbox, most recently active first.
   *
   * @param options.folder Restrict to one folder. Ignored when the binding is already
   *   folder-scoped.
   * @param options.unreadOnly Only conversations with at least one unread message.
   * @param options.query Free-text search over subject, sender, and body.
   */
  list(options?: {
    folder?: WellKnownFolder | string;
    unreadOnly?: boolean;
    query?: string;
  }): Promise<Cursor<MailThreadSummary>>;

  /** One conversation by id. Throws if it does not exist or is outside this binding's scope. */
  getThread(id: string): Promise<MailThread>;

  /** Names of the folders in this mailbox. */
  listFolders(): Promise<string[]>;

  /**
   * Draft a new message.
   *
   * Creates a draft in the Drafts folder. It does not send anything -- the mailbox owner
   * reviews and sends it themselves from Outlook.
   */
  createDraft(message: DraftMail): Promise<void>;
}

// =======================================================================================
// SharePoint
// =======================================================================================

/** Metadata for a file or folder within the connected SharePoint resource. */
export interface SharePointItemMetadata {
  /** Stable Microsoft Graph item id. */
  id: string;
  name: string;
  kind: "file" | "folder";
  /** Current browser URL. This may change when the item is renamed or moved. */
  webUrl: string;
  /** Size in bytes. Folders normally report zero. */
  size: number;
  /** Version identifier, when available. */
  eTag?: string;
  /** MIME type for a file, when available. */
  mimeType?: string;
  modifiedAt: string;
  modifiedBy?: string;
}

/** One page of SharePoint items. Pass `cursor` back unchanged to continue. */
export interface SharePointItemPage {
  items: SharePointItemMetadata[];
  /** Opaque continuation value. Omitted on the last page. */
  cursor?: string;
}

/** One SharePoint file, or one folder and the files and folders beneath it. */
export interface SharePointDocumentSession {
  /** Metadata for the bound file or folder. */
  metadata(): Promise<SharePointItemMetadata>;

  /** Direct children of the bound folder. Throws when the bound item is a file. */
  listChildren(options?: { cursor?: string; limit?: number }): Promise<SharePointItemPage>;

  /** Search beneath the bound folder. Throws when the bound item is a file. */
  search(query: string, options?: { cursor?: string; limit?: number }): Promise<SharePointItemPage>;

  /**
   * Open a file or folder beneath this folder using an item id returned by `listChildren()` or
   * `search()`. The returned item can be read or browsed according to its kind.
   *
   * Throws when this item is a file or when `itemId` is not a descendant of this binding.
   */
  open(itemId: string): Promise<SharePointDocumentSession>;

  /**
   * Read raw bytes from the bound file. Throws when the bound item is a folder.
   *
   * Files may be at most 50 MB, and one call returns at most 5 MB. Use `offset` and
   * `length` to read a larger file in bounded chunks.
   */
  read(options?: { offset?: number; length?: number }): Promise<ArrayBuffer>;
}

// =======================================================================================
// Outlook calendar
// =======================================================================================

/** Someone invited to an event. */
export interface EventAttendee {
  name?: string;
  address: string;
  /** Whether they have accepted. `"none"` when they have not responded. */
  response: "accepted" | "declined" | "tentative" | "none";
  /** True when their attendance is optional. */
  optional: boolean;
}

/** A calendar event. */
export interface CalendarEvent {
  /** Stable id for this event. */
  id: string;
  subject: string;
  /** Event body converted to Markdown. Empty string when there is none. */
  body: string;
  start: Date;
  end: Date;
  /** True for an all-day event; `start` and `end` are then midnight-aligned. */
  allDay: boolean;
  /** Free-text location, e.g. "Room 12" or a Teams join URL. Empty when unset. */
  location: string;
  organizer: EventAttendee;
  attendees: EventAttendee[];
  /** True when this event repeats. Individual occurrences are returned expanded. */
  recurring: boolean;
  /** How the organizer marked the time. */
  showAs: "free" | "tentative" | "busy" | "oof";
}

/** An event to create. */
export interface NewCalendarEvent {
  subject: string;
  start: Date;
  end: Date;
  /** Body as Markdown. */
  body?: string;
  location?: string;
  /** Addresses to invite. They will receive an invitation. */
  attendees?: string[];
  /** Defaults to false. When true, `start` and `end` are treated as dates. */
  allDay?: boolean;
}

/** Fields that can be changed on an existing event. Omitted fields are left alone. */
export interface CalendarEventUpdate {
  subject?: string;
  start?: Date;
  end?: Date;
  body?: string;
  location?: string;
}

/** A window of time with nothing scheduled in it. */
export interface FreeSlot {
  start: Date;
  end: Date;
}

/** A single Outlook calendar. */
export interface OutlookCalendarSession {
  /** The calendar's display name. */
  name(): Promise<string>;

  /** The signed-in calendar owner's address. */
  address(): Promise<string>;

  /**
   * Events overlapping `[from, to)`, earliest first.
   *
   * Recurring events are expanded into individual occurrences within the range.
   */
  list(from: Date, to: Date): Promise<Cursor<CalendarEvent>>;

  /** One event by id. Throws if it does not exist on this calendar. */
  getEvent(id: string): Promise<CalendarEvent>;

  /**
   * Gaps of at least `minimumMinutes` between `from` and `to` with nothing scheduled.
   *
   * Considers only this calendar. Does not check other attendees' availability.
   */
  findFreeTime(from: Date, to: Date, minimumMinutes: number): Promise<FreeSlot[]>;

  /** Create an event. Invitations are sent to any `attendees`. */
  createEvent(event: NewCalendarEvent): Promise<void>;

  /** Change an existing event. Attendees are notified of time or subject changes. */
  updateEvent(id: string, changes: CalendarEventUpdate): Promise<void>;

  /** Cancel an event. Attendees are notified. */
  deleteEvent(id: string): Promise<void>;

  /** Respond to an invitation on this calendar. */
  respondToEvent(id: string, response: "accept" | "decline" | "tentative"): Promise<void>;
}
