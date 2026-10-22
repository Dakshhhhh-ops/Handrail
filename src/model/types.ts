export interface Card {
  id: string;
  title: string;
  notes: string;
  /** Due date as YYYY-MM-DD, or null. */
  due: string | null;
  assignee: string | null;
  /** Name of the person who last changed this card, if known. */
  lastEditedBy: string | null;
  updatedAt: number;
  /** Who last wrote each part of the card, when known (from the shared document). */
  fieldBy?: Partial<Record<'title' | 'notes' | 'due' | 'assignee' | 'place' | 'alive', string | null>>;
}

export interface Column {
  id: string;
  title: string;
  cardIds: string[];
}

export interface Board {
  id: string;
  title: string;
  columns: Column[];
  cards: Record<string, Card>;
  updatedAt: number;
}

export interface CardLocation {
  column: Column;
  columnIndex: number;
  index: number;
}
