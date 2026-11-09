export interface HostFilterValue {
  min?: number;
  max?: number;
  option?: unknown;
}

export interface HostFilterItem {
  id?: string;
  disabled?: boolean;
  value?: HostFilterValue;
  poexdCategory?: string;
  poexdBindingId?: string;
  [key: string]: unknown;
}

export interface HostFilterGroup {
  filters?: HostFilterItem[];
  [key: string]: unknown;
}

export interface HostQueryState {
  stats?: HostFilterGroup[];
  status?: { option?: string };
  [key: string]: unknown;
}

export interface HostResultBatch {
  id: string;
  result: string[];
  items?: Record<string, unknown>;
  total: number;
  inexact?: boolean;
  [key: string]: unknown;
}

export interface HostSearchObject {
  localId: string;
  id?: string;
  type: string;
  live: boolean;
  status: string | boolean;
  realm: 'pc' | 'poe2';
  league: string;
  results: HostResultBatch[];
  total: number;
  inexact: boolean;
  collapse: boolean;
  dirty: boolean;
  unreadHits: number;
  [key: string]: unknown;
}

export interface HostTransientState {
  searches?: HostSearchObject[];
  search?: {
    active?: HostSearchObject | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface HostVuexState {
  query?: HostQueryState;
  persistent?: HostQueryState;
  transient?: HostTransientState;
  [key: string]: unknown;
}

export interface HostVuexStore {
  state?: HostVuexState;
  _withCommit: (fn: () => void) => void;
  commit: (type: string, payload: unknown) => void;
  subscribe?: (fn: (mutation: unknown, state: unknown) => void) => () => void;
  [key: string]: unknown;
}

export interface HostStaticData {
  knownStatsFlat?: Record<string, { id: string; text: string; type: string }>;
  [key: string]: unknown;
}

export interface HostVueInstance {
  $store?: HostVuexStore;
  $children?: HostVueInstance[];
  _data?: {
    static_?: HostStaticData;
    static?: HostStaticData;
    [key: string]: unknown;
  };
  static?: HostStaticData;
  static_?: HostStaticData;
  config?: {
    globalProperties?: {
      $store?: HostVuexStore;
    };
  };
  [key: string]: unknown;
}

declare global {
  interface Window {
    __poexdInterceptorInstalled?: boolean;
    __poexdUpdateNonce?: (newNonce: string) => void;
  }
  interface History {
    __poexdHistoryPatched?: boolean;
  }
}
